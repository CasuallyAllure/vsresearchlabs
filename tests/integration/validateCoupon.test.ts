/**
 * validate_coupon (migrations 031 → 048 → 057) against a REAL local Postgres.
 *
 * The unit suites mock the RPC seam; this tier proves the actual function:
 * every rejection reason, the discount math as Postgres computes it
 * (round-half-away-from-zero), and the WRITE-TIME combinability resolution
 * (057) — coupon_combinability_reason is only reachable through real coupon
 * rows, so mocks cannot cover it. Runs through the ANON client where it
 * matters: validate_coupon is granted to anon (the cart's Apply button).
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('validate_coupon suite');

interface ValidateResult {
  valid: boolean;
  reason?: string;
  code?: string;
  kind?: string;
  discount_cents?: number;
  free_sku?: string | null;
  free_label?: string | null;
  exclusive?: boolean;
  combines_with_codes?: boolean;
  combines_with_promos?: boolean;
  combines_with_account?: boolean;
}

describe.skipIf(!canRun)('validate_coupon (real DB, migrations 031/048/057)', () => {
  const runId = randomUUID().slice(0, 8).toUpperCase();
  // Codes must satisfy the coupons check: upper(btrim(code)), length 3–40.
  const PCT = `VT-PCT-${runId}`; // 10% off
  const FIX = `VT-FIX-${runId}`; // $20 fixed, $10 minimum
  const FREE = `VT-FREE-${runId}`; // free item, $1 minimum
  const OFF = `VT-OFF-${runId}`; // active = false
  const FUT = `VT-FUT-${runId}`; // starts in the future
  const EXP = `VT-EXP-${runId}`; // already expired
  const MAX = `VT-MAX-${runId}`; // max_uses reached
  const ONCE = `VT-ONCE-${runId}`; // once_per_contact, already redeemed
  const EXCL = `VT-EXCL-${runId}`; // exclusive
  const NOCODES = `VT-NOCODES-${runId}`; // combines_with_codes = false
  const NOPROMO = `VT-NOPROMO-${runId}`; // combines_with_promos = false
  const NOACC = `VT-NOACC-${runId}`; // combines_with_account = false
  const PLAIN = `VT-PLAIN-${runId}`; // default flags (stacks with everything)
  const onceContact = `vt-once-${runId}@example.test`;

  let service: SupabaseClient;
  let anon: SupabaseClient;

  async function validate(
    client: SupabaseClient,
    args: Record<string, unknown>,
  ): Promise<ValidateResult> {
    const res = await client.rpc('validate_coupon', args);
    expect(res.error).toBeNull();
    return res.data as ValidateResult;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    const inserted = await service.from('coupons').insert([
      { code: PCT, kind: 'percent', percent: 10 },
      { code: FIX, kind: 'fixed', amount_cents: 2000, min_subtotal_cents: 1000 },
      {
        code: FREE, kind: 'free_item', free_sku: `VT-SKU-${runId}`,
        free_label: 'Integration Test Freebie', min_subtotal_cents: 100,
      },
      { code: OFF, kind: 'percent', percent: 10, active: false },
      { code: FUT, kind: 'percent', percent: 10, starts_at: '2099-01-01T00:00:00Z' },
      { code: EXP, kind: 'percent', percent: 10, expires_at: '2000-01-01T00:00:00Z' },
      { code: MAX, kind: 'percent', percent: 10, max_uses: 1, used_count: 1 },
      { code: ONCE, kind: 'percent', percent: 10, once_per_contact: true },
      { code: EXCL, kind: 'percent', percent: 25, exclusive: true },
      { code: NOCODES, kind: 'percent', percent: 5, combines_with_codes: false },
      { code: NOPROMO, kind: 'percent', percent: 5, combines_with_promos: false },
      { code: NOACC, kind: 'percent', percent: 5, combines_with_account: false },
      { code: PLAIN, kind: 'percent', percent: 5 },
      // defaultToNull:false — PostgREST bulk inserts take the UNION of the
      // rows' keys and fill the gaps with explicit NULLs, which violates the
      // NOT NULL DEFAULT columns (once_per_contact, min_subtotal_cents).
      // This makes missing keys use the column defaults instead.
    ], { defaultToNull: false });
    if (inserted.error) throw new Error(`Failed to seed coupons: ${inserted.error.message}`);

    // Prior redemption for the once_per_contact check (no order needed —
    // order_id is nullable on coupon_redemptions).
    const onceCoupon = await service.from('coupons').select('id').eq('code', ONCE).single();
    if (onceCoupon.error) throw new Error(`Failed to read ONCE coupon: ${onceCoupon.error.message}`);
    const redemption = await service.from('coupon_redemptions').insert({
      coupon_id: onceCoupon.data.id, code: ONCE, buyer_contact: onceContact, discount_cents: 100,
    });
    if (redemption.error) throw new Error(`Failed to seed redemption: ${redemption.error.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    // coupon_redemptions carries a coupons FK without cascade — delete it first.
    await service.from('coupon_redemptions').delete().eq('code', ONCE);
    await service.from('coupons').delete().like('code', `VT-%-${runId}`);
  }, 30_000);

  // ── Rejection reasons (each maps to one guard in the function body) ───────
  describe('rejections', () => {
    test('anon: unknown code is rejected as not valid', async () => {
      const r = await validate(anon, { p_code: `VT-NOPE-${runId}`, p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'This code is not valid.' });
    });

    test('anon: sub-3-char code is rejected before any lookup', async () => {
      const r = await validate(anon, { p_code: 'ab', p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'Enter a code.' });
    });

    test('inactive code is rejected as not valid', async () => {
      const r = await validate(anon, { p_code: OFF, p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'This code is not valid.' });
    });

    test('not-yet-started code is rejected', async () => {
      const r = await validate(anon, { p_code: FUT, p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'This code is not active yet.' });
    });

    test('expired code is rejected', async () => {
      const r = await validate(anon, { p_code: EXP, p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'This code has expired.' });
    });

    test('code at its usage limit is rejected', async () => {
      const r = await validate(anon, { p_code: MAX, p_subtotal_cents: 5000 });
      expect(r).toMatchObject({ valid: false, reason: 'This code has reached its usage limit.' });
    });

    test('subtotal below minimum is rejected (percent/fixed wording)', async () => {
      const r = await validate(anon, { p_code: FIX, p_subtotal_cents: 999 });
      expect(r).toMatchObject({
        valid: false, reason: 'Your order does not meet the minimum for this code.',
      });
    });

    test('free_item below minimum uses the add-a-product wording', async () => {
      const r = await validate(anon, { p_code: FREE, p_subtotal_cents: 0 });
      expect(r).toMatchObject({
        valid: false, reason: 'Add a product to your order to use this code.',
      });
    });

    test('once_per_contact matches prior redemption case/whitespace-insensitively', async () => {
      const r = await validate(anon, {
        p_code: ONCE, p_subtotal_cents: 5000,
        p_contact: `  ${onceContact.toUpperCase()}  `,
      });
      expect(r).toMatchObject({
        valid: false, reason: 'This code was already used with this contact.',
      });
      // Without a contact the same code still previews as valid.
      const noContact = await validate(anon, { p_code: ONCE, p_subtotal_cents: 5000 });
      expect(noContact.valid).toBe(true);
    });
  });

  // ── Discount math as Postgres computes it ─────────────────────────────────
  describe('discount math', () => {
    test('percent: round() is half-away-from-zero (12345 × 10% → 1235, not 1234)', async () => {
      const r = await validate(anon, { p_code: PCT, p_subtotal_cents: 12345 });
      expect(r.valid).toBe(true);
      expect(r.discount_cents).toBe(1235);
    });

    test('lowercase/padded input resolves to the stored uppercase code', async () => {
      const r = await validate(anon, { p_code: `  ${PCT.toLowerCase()} `, p_subtotal_cents: 1000 });
      expect(r.valid).toBe(true);
      expect(r.code).toBe(PCT);
    });

    test('fixed: discount is capped at the subtotal', async () => {
      const r = await validate(anon, { p_code: FIX, p_subtotal_cents: 1500 });
      expect(r.valid).toBe(true);
      expect(r.discount_cents).toBe(1500); // least(2000, 1500)
    });

    test('free_item: discount_cents is 0 and the free SKU/label are returned', async () => {
      const r = await validate(anon, { p_code: FREE, p_subtotal_cents: 5000 });
      expect(r.valid).toBe(true);
      expect(r.discount_cents).toBe(0);
      expect(r.free_sku).toBe(`VT-SKU-${runId}`);
      expect(r.free_label).toBe('Integration Test Freebie');
    });

    test('valid payload carries the 057 combinability flags', async () => {
      const r = await validate(anon, { p_code: EXCL, p_subtotal_cents: 5000 });
      expect(r.valid).toBe(true);
      expect(r.exclusive).toBe(true);
      expect(r.combines_with_codes).toBe(true);
      expect(r.combines_with_promos).toBe(true);
      expect(r.combines_with_account).toBe(true);
    });
  });

  // ── Write-time combinability (057) — the part mocks cannot prove ──────────
  describe('combinability resolution', () => {
    test('defaults are permissive: plain code stacks with codes + promos + account', async () => {
      const r = await validate(anon, {
        p_code: PLAIN, p_subtotal_cents: 5000,
        p_applied_codes: [PCT], p_has_reward: true, p_has_promo: true, p_has_account: true,
      });
      expect(r.valid).toBe(true);
    });

    test('exclusive candidate is rejected when any other discount is present', async () => {
      const withCode = await validate(anon, {
        p_code: EXCL, p_subtotal_cents: 5000, p_applied_codes: [PLAIN],
      });
      expect(withCode.valid).toBe(false);
      expect(withCode.reason).toContain('must be used on its own');

      const withAccount = await validate(anon, {
        p_code: EXCL, p_subtotal_cents: 5000, p_has_account: true,
      });
      expect(withAccount.valid).toBe(false);

      const withReward = await validate(anon, {
        p_code: EXCL, p_subtotal_cents: 5000, p_has_reward: true,
      });
      expect(withReward.valid).toBe(false);

      // Alone it is fine.
      const alone = await validate(anon, { p_code: EXCL, p_subtotal_cents: 5000 });
      expect(alone.valid).toBe(true);
    });

    test('an already-applied exclusive code blocks any later candidate (earlier code wins)', async () => {
      const r = await validate(anon, {
        p_code: PLAIN, p_subtotal_cents: 5000, p_applied_codes: [EXCL],
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toContain(EXCL);
    });

    test('candidate with combines_with_codes=false rejects other applied codes', async () => {
      const r = await validate(anon, {
        p_code: NOCODES, p_subtotal_cents: 5000, p_applied_codes: [PLAIN],
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toContain("can't be combined with other codes");
    });

    test('an already-applied no-codes code blocks the candidate', async () => {
      const r = await validate(anon, {
        p_code: PLAIN, p_subtotal_cents: 5000, p_applied_codes: [NOCODES],
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toContain(NOCODES);
    });

    test('combines_with_promos=false rejects under an active promo OR reward', async () => {
      const promo = await validate(anon, {
        p_code: NOPROMO, p_subtotal_cents: 5000, p_has_promo: true,
      });
      expect(promo.valid).toBe(false);
      expect(promo.reason).toContain('current promotion');

      const reward = await validate(anon, {
        p_code: NOPROMO, p_subtotal_cents: 5000, p_has_reward: true,
      });
      expect(reward.valid).toBe(false);
    });

    test('combines_with_account=false rejects only when the account discount is present', async () => {
      const withAccount = await validate(anon, {
        p_code: NOACC, p_subtotal_cents: 5000, p_has_account: true,
      });
      expect(withAccount.valid).toBe(false);
      expect(withAccount.reason).toContain('account discount');

      const without = await validate(anon, { p_code: NOACC, p_subtotal_cents: 5000 });
      expect(without.valid).toBe(true);
    });
  });
});
