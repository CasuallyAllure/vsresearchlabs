/**
 * Prepared carts (migration 081) against a REAL local Postgres.
 *
 * Mocks cannot prove any of what matters here, because every claim is about
 * PostgreSQL ACLs, RLS and what PostgREST will actually hand an unauthenticated
 * or merely-signed-in browser:
 *
 *   • THE GATE. `admin_create_prepared_cart` / `admin_revoke_prepared_cart` /
 *     `admin_prepared_carts` are is_admin()-gated SECURITY DEFINER routines
 *     granted only to `authenticated`. Both halves are proven: anon is denied
 *     at the ACL, and a plain signed-in customer — who HOLDS the grant — is
 *     denied by the body guard. The second case is the one a mock always gets
 *     wrong, and it is the realistic attacker: every member of this store is
 *     `authenticated`.
 *   • THE TABLES ARE UNREACHABLE. 081 revokes all and grants nothing back, so
 *     neither anon nor a signed-in member can select from `prepared_carts` or
 *     `prepared_cart_lines` at all. That, plus `admin_prepared_carts`'s
 *     explicit column list, is what makes "the token hash is never exposed" a
 *     structural fact rather than a promise.
 *   • THE TOKEN IS HASHED. What lands in the row is the SHA-256 of what the RPC
 *     returned — asserted against Node's own crypto, not against the database's
 *     opinion of itself.
 *   • NO MONEY IS STORED. The lines table has no price column and the RPC
 *     refuses a line carrying one, because place-order fails closed on any
 *     client-supplied price: a stored price makes the order unplaceable, not
 *     discounted.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts.
 * NEVER point this at production — it creates and deletes auth users, profiles,
 * prepared carts and audit rows.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('prepared carts suite');

const ADMIN_ONLY = /Unauthorized: admin role required/i;

interface CreatedCart { cart_id: string; token: string; expires_at: string }
interface CartSummary {
  id: string;
  status: string;
  coupon_code: string | null;
  note: string | null;
  claimed_at: string | null;
  revoked_at: string | null;
  lines: Array<{ sku: string; dose: string; quantity: number }>;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe.skipIf(!canRun)('prepared carts (real DB, migration 081)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;   // signed in as an active admin — the intended caller
  let member: SupabaseClient;  // signed in as a PLAIN customer — holds the grant, fails the guard
  let memberUserId = '';
  let adminUserId = '';
  const createdCartIds: string[] = [];

  async function createCart(lines: unknown, coupon: string | null = null, note: string | null = null) {
    const res = await admin.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId, p_lines: lines, p_coupon_code: coupon, p_note: note,
    });
    if (!res.error && res.data) createdCartIds.push((res.data as CreatedCart).cart_id);
    return res;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // The RPCs authorize by an active admin_users row for the CALLING auth
    // user. The service-role key bypasses RLS but is not an admin user, so it
    // cannot (and must not) call them — the admin console calls them as a
    // signed-in admin, and so does this suite (mirrors memberWritePaths).
    const adminEmail = `admin-pc-${runId}@example.test`;
    const adminPw = `Admin-${runId}-Aa1!`;
    const adminCreated = await service.auth.admin.createUser({
      email: adminEmail, password: adminPw, email_confirm: true,
    });
    if (adminCreated.error || !adminCreated.data.user) throw new Error(`admin createUser failed: ${adminCreated.error?.message}`);
    adminUserId = adminCreated.data.user.id;
    const adminRow = await service.from('admin_users').insert({ user_id: adminUserId, email: adminEmail, active: true });
    if (adminRow.error) throw new Error(`admin_users insert failed: ${adminRow.error.message}`);
    admin = anonClient();
    const adminSignIn = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPw });
    if (adminSignIn.error) throw new Error(`admin sign-in failed: ${adminSignIn.error.message}`);

    // The member the carts are built for — and, signed in, the non-admin
    // attacker in the negative tests below.
    const memberEmail = `member-pc-${runId}@example.test`;
    const memberPw = `Member-${runId}-Aa1!`;
    const memberCreated = await service.auth.admin.createUser({
      email: memberEmail, password: memberPw, email_confirm: true,
    });
    if (memberCreated.error || !memberCreated.data.user) throw new Error(`member createUser failed: ${memberCreated.error?.message}`);
    memberUserId = memberCreated.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: memberUserId, full_name: 'Prepared Cart Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);

    member = anonClient();
    const memberSignIn = await member.auth.signInWithPassword({ email: memberEmail, password: memberPw });
    if (memberSignIn.error) throw new Error(`member sign-in failed: ${memberSignIn.error.message}`);
  });

  afterAll(async () => {
    if (memberUserId) {
      await service.from('prepared_carts').delete().eq('user_id', memberUserId);
      await service.from('audit_log').delete().eq('entity_id', memberUserId);
      await service.from('customer_profiles').delete().eq('user_id', memberUserId);
      await service.auth.admin.deleteUser(memberUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  /* ── Creation: shape, token hashing, audit ──────────────────────────────── */

  test('admin_create_prepared_cart stores (sku, dose, quantity) lines and returns a token once', async () => {
    const res = await createCart([
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
      { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1 },
    ]);
    expect(res.error).toBeNull();

    const created = res.data as CreatedCart;
    expect(created.cart_id).toMatch(/^[0-9a-f-]{36}$/);
    // Two concatenated UUIDv4s with the dashes stripped — 019's token pattern.
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    // 14-day default expiry, as a column default.
    const days = (new Date(created.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    const lines = await service
      .from('prepared_cart_lines')
      .select('sku, dose, quantity, position')
      .eq('cart_id', created.cart_id)
      .order('position');
    expect(lines.error).toBeNull();
    expect(lines.data).toEqual([
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2, position: 0 },
      { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1, position: 1 },
    ]);
  });

  test('only the SHA-256 digest of the token is persisted — the plaintext is not in the row', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const row = await service
      .from('prepared_carts')
      .select('*')
      .eq('id', created.cart_id)
      .single();
    expect(row.error).toBeNull();

    const stored = row.data as Record<string, unknown>;
    expect(stored.token_hash).toBe(sha256Hex(created.token));
    expect(stored.token_hash).not.toBe(created.token);
    // Nothing anywhere in the row replays into a working link.
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(Object.keys(stored)).not.toContain('token');
  });

  test('the lines table stores no money at all', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const line = await service
      .from('prepared_cart_lines')
      .select('*')
      .eq('cart_id', created.cart_id)
      .limit(1)
      .single();
    expect(line.error).toBeNull();

    const priceish = Object.keys(line.data as object).filter((k) => /price|cents|amount|total|discount/i.test(k));
    expect(priceish).toEqual([]);
  });

  test('a coupon code is normalized and stored as a CODE, and the note is kept', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], '  spring20 ', '  For the Tuesday run  ');
    const created = res.data as CreatedCart;

    const row = await service
      .from('prepared_carts')
      .select('coupon_code, note, created_by, claimed_at, revoked_at')
      .eq('id', created.cart_id)
      .single();
    expect(row.data).toMatchObject({
      coupon_code: 'SPRING20',
      note: 'For the Tuesday run',
      created_by: adminUserId,
      claimed_at: null,
      revoked_at: null,
    });
  });

  test('blank coupon and note collapse to null rather than empty strings', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], '   ', '   ');
    const created = res.data as CreatedCart;

    const row = await service.from('prepared_carts').select('coupon_code, note').eq('id', created.cart_id).single();
    expect(row.data).toMatchObject({ coupon_code: null, note: null });
  });

  test('the same (sku, dose) twice in one payload sums instead of creating two lines', async () => {
    const res = await createCart([
      { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 2 },
      { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 3 },
    ]);
    const created = res.data as CreatedCart;

    const lines = await service.from('prepared_cart_lines').select('sku, dose, quantity').eq('cart_id', created.cart_id);
    expect(lines.data).toEqual([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 5 }]);
  });

  test('a single-config line stores dose as the empty string, never null', async () => {
    const res = await createCart([{ sku: 'VSR-LE-MIX', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const line = await service.from('prepared_cart_lines').select('dose').eq('cart_id', created.cart_id).single();
    expect(line.data).toEqual({ dose: '' });
  });

  test('creation writes an audit_log row naming the member', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], 'SPRING20');
    const created = res.data as CreatedCart;

    const audit = await service
      .from('audit_log')
      .select('action, entity_type, entity_id, actor_id, after_value')
      .eq('action', 'member.prepared_cart.created')
      .eq('entity_id', memberUserId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit.error).toBeNull();
    expect(audit.data).toMatchObject({ entity_type: 'customer', actor_id: adminUserId });
    expect((audit.data as { after_value: Record<string, unknown> }).after_value).toMatchObject({
      cart_id: created.cart_id, lines: 1, coupon_code: 'SPRING20',
    });
  });

  /* ── Creation: what it refuses ──────────────────────────────────────────── */

  test('an empty line array is refused', async () => {
    expect((await createCart([])).error?.message).toMatch(/at least one line/i);
  });

  test('a null line payload is refused', async () => {
    expect((await createCart(null)).error?.message).toMatch(/at least one line/i);
  });

  test('a non-array line payload is refused', async () => {
    expect((await createCart({ sku: 'VSR-RS-BPC', quantity: 1 })).error?.message).toMatch(/at least one line/i);
  });

  test('a line missing a sku is refused', async () => {
    expect((await createCart([{ dose: '5mg', quantity: 1 }])).error?.message).toMatch(/missing a sku/i);
  });

  test('a non-positive quantity is refused', async () => {
    expect((await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 0 }])).error?.message)
      .toMatch(/quantity above zero/i);
  });

  test('a non-numeric quantity is refused', async () => {
    expect((await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 'lots' }])).error).not.toBeNull();
  });

  test.each([
    ['unit_price_cents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, unit_price_cents: 1 }],
    ['unitPriceCents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, unitPriceCents: 1 }],
    ['price_cents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, price_cents: 1 }],
    ['price', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, price: 1 }],
  ])('a line carrying %s is refused — a prepared cart is a list, not a quote', async (_key, line) => {
    // A baked-in price does not discount the order, it makes place-order refuse
    // it (409, fail-closed). A bespoke price must travel as a coupon code.
    expect((await createCart([line])).error?.message).toMatch(/must not carry a price/i);
  });

  test('a member id that is not a real auth user is refused by the FK', async () => {
    const res = await admin.rpc('admin_create_prepared_cart', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error).not.toBeNull();
  });

  /* ── Revocation ─────────────────────────────────────────────────────────── */

  test('admin_revoke_prepared_cart stamps revoked_at, and revoking twice is a calm no-op', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const first = await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ ok: true });

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).not.toBeNull();

    const second = await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ok: false, reason: 'not_found_or_already_revoked' });
  });

  test('revoking an unknown id reports not-found instead of raising', async () => {
    const res = await admin.rpc('admin_revoke_prepared_cart', { p_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'not_found_or_already_revoked' });
  });

  /* ── The admin read surface ─────────────────────────────────────────────── */

  test('admin_prepared_carts lists the member\'s carts with derived status and never leaks the hash', async () => {
    const live = (await createCart([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 }], 'SPRING20')).data as CreatedCart;
    const dead = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await admin.rpc('admin_revoke_prepared_cart', { p_id: dead.cart_id });

    const res = await admin.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 100 });
    expect(res.error).toBeNull();

    const rows = (res.data as { rows: CartSummary[] }).rows;
    const liveRow = rows.find((r) => r.id === live.cart_id);
    expect(liveRow).toMatchObject({ status: 'live', coupon_code: 'SPRING20' });
    expect(liveRow?.lines).toEqual([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 }]);
    expect(rows.find((r) => r.id === dead.cart_id)?.status).toBe('revoked');

    // The structural guarantee: the read surface has no hash column at all, and
    // no plaintext token can be reconstructed from what it returns.
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain(live.token);
    expect(Object.keys(liveRow as object)).not.toContain('token_hash');
  });

  test('admin_prepared_carts returns an empty list for a member with no carts', async () => {
    const res = await admin.rpc('admin_prepared_carts', { p_user_id: adminUserId, p_limit: 10 });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ rows: [] });
  });

  /* ── The gate: anon ─────────────────────────────────────────────────────── */

  test('anon cannot create a prepared cart', async () => {
    const res = await anon.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId,
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();
  });

  test('anon cannot read a prepared cart', async () => {
    expect((await anon.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 10 })).error).not.toBeNull();
    expect((await anon.from('prepared_carts').select('id')).error).not.toBeNull();
    expect((await anon.from('prepared_cart_lines').select('sku')).error).not.toBeNull();
  });

  test('anon cannot revoke a prepared cart', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    expect((await anon.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id })).error).not.toBeNull();

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).toBeNull();
  });

  test('anon cannot write to either table directly', async () => {
    expect((await anon.from('prepared_carts').insert({ user_id: memberUserId, token_hash: 'pwn' })).error).not.toBeNull();
    expect((await anon.from('prepared_carts').update({ revoked_at: null }).eq('user_id', memberUserId)).error).not.toBeNull();
    expect((await anon.from('prepared_carts').delete().eq('user_id', memberUserId)).error).not.toBeNull();
  });

  /* ── The gate: a PLAIN signed-in customer ───────────────────────────────── */
  // The realistic attacker. Every member of this store is `authenticated`, so
  // they HOLD the EXECUTE grant — only the is_admin() body guard stops them.

  test('a signed-in non-admin cannot create a prepared cart — not even their own', async () => {
    const res = await member.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId,
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error?.message).toMatch(ADMIN_ONLY);
  });

  test('a signed-in non-admin cannot read prepared carts — not through the RPC', async () => {
    const res = await member.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 10 });
    expect(res.error?.message).toMatch(ADMIN_ONLY);
  });

  test('a signed-in non-admin cannot read prepared carts — not through PostgREST either', async () => {
    // No table grant at all, so this is a hard permission error rather than an
    // RLS-filtered empty result: the row's existence is not even observable.
    const carts = await member.from('prepared_carts').select('id, token_hash');
    expect(carts.error).not.toBeNull();
    expect(carts.data).toBeNull();

    const lines = await member.from('prepared_cart_lines').select('sku, dose, quantity');
    expect(lines.error).not.toBeNull();
    expect(lines.data).toBeNull();
  });

  test('a signed-in non-admin cannot revoke a prepared cart', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const res = await member.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(res.error?.message).toMatch(ADMIN_ONLY);

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).toBeNull();
  });

  test('a signed-in non-admin cannot write to either table directly', async () => {
    expect((await member.from('prepared_carts').insert({ user_id: memberUserId, token_hash: 'pwn' })).error).not.toBeNull();
    expect((await member.from('prepared_carts').update({ expires_at: '2099-01-01' }).eq('user_id', memberUserId)).error).not.toBeNull();
    expect((await member.from('prepared_cart_lines').update({ quantity: 999 }).eq('sku', 'VSR-RS-BPC')).error).not.toBeNull();
    expect((await member.from('prepared_carts').delete().eq('user_id', memberUserId)).error).not.toBeNull();
  });

  test('the token hash is never reachable by any browser role', async () => {
    // Belt and braces over the individual cases above: the one column that
    // would turn a table leak into a working link is unreachable three ways.
    expect(createdCartIds.length).toBeGreaterThan(0);
    for (const client of [anon, member]) {
      const res = await client.from('prepared_carts').select('token_hash').eq('id', createdCartIds[0]);
      expect(res.error).not.toBeNull();
      expect(res.data).toBeNull();
    }
  });
});
