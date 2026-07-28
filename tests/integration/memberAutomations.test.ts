/**
 * Membership automation data layer against a REAL local Postgres (migration
 * 075). Mocks cannot prove the parts that matter here:
 *
 *   • email_log's UNIQUE (recipient, kind, period_key) — THE idempotency
 *     claim the member-automations edge fn relies on (insert-then-send).
 *   • the write fences: anon/authenticated cannot touch email_log or
 *     automation_settings (writes are service-role / RPC only).
 *   • admin_set_automation_kind — the is_admin() gate, the toggle, the
 *     audit row, and the unknown-kind rejection.
 *   • admin_email_log — the gate and the {rows, total, summary} shape.
 *   • customer_profiles.marketing_opt_out — CUSTOMER-writable through the
 *     own-row policy while the 043/049 guard trigger still pins tier
 *     (the opt-out column must NOT have joined the pinned set).
 *
 * Follows memberWritePaths' admin-auth fixture pattern. Requires a LOCAL
 * `supabase start` stack; see tests/integration/env.ts for the guard. NEVER
 * point this at production — it creates and deletes auth users and log rows.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('member automations suite');

describe.skipIf(!canRun)('membership automation data layer (real DB, migration 075)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;    // signed in as an active admin — the RPC caller
  let customer: SupabaseClient; // signed in as a plain member — proves the fences
  let adminUserId = '';
  let customerUserId = '';
  const claimRecipient = `auto-claim-${runId}@example.test`;

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Admin fixture (mirrors memberWritePaths: is_admin() authorizes by an
    // active admin_users row for the CALLING auth user — the service key
    // alone is not an admin).
    const adminEmail = `admin-auto-${runId}@example.test`;
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

    // Customer fixture — a signed-in plain member with an own profile row.
    const customerEmail = `member-auto-${runId}@example.test`;
    const customerPw = `Member-${runId}-Aa1!`;
    const created = await service.auth.admin.createUser({
      email: customerEmail, password: customerPw, email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    customerUserId = created.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: customerUserId, full_name: 'Automation Member', tier: 'member', status: 'active' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);
    customer = anonClient();
    const signIn = await customer.auth.signInWithPassword({ email: customerEmail, password: customerPw });
    if (signIn.error) throw new Error(`customer sign-in failed: ${signIn.error.message}`);
  });

  afterAll(async () => {
    await service.from('email_log').delete().like('recipient', `%${runId}@example.test`);
    // Leave the seeded settings as this suite found them: everything OFF.
    await service.from('automation_settings').update({ enabled: false, updated_by: null }).eq('kind', 'welcome');
    if (customerUserId) {
      await service.from('customer_profiles').delete().eq('user_id', customerUserId);
      await service.auth.admin.deleteUser(customerUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  // ── email_log: the idempotency claim ──────────────────────────────────────

  test('email_log UNIQUE (recipient, kind, period_key) rejects a second claim', async () => {
    const first = await service.from('email_log').insert({
      user_id: customerUserId, recipient: claimRecipient, kind: 'welcome', period_key: 'wc-once',
    });
    expect(first.error).toBeNull();

    const second = await service.from('email_log').insert({
      user_id: customerUserId, recipient: claimRecipient, kind: 'welcome', period_key: 'wc-once',
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe('23505'); // unique_violation — the claim held

    // A different period_key is a NEW claim and inserts cleanly.
    const nextPeriod = await service.from('email_log').insert({
      user_id: customerUserId, recipient: claimRecipient, kind: 'reward_ready', period_key: 'rr-1',
    });
    expect(nextPeriod.error).toBeNull();
  });

  test('anon and authenticated customers cannot write email_log', async () => {
    const anonInsert = await anon.from('email_log').insert({
      recipient: `anon-${runId}@example.test`, kind: 'welcome', period_key: 'wc-once',
    });
    expect(anonInsert.error).not.toBeNull();

    const customerInsert = await customer.from('email_log').insert({
      recipient: `cust-${runId}@example.test`, kind: 'welcome', period_key: 'wc-once',
    });
    expect(customerInsert.error).not.toBeNull();
  });

  test('a plain customer reads NO email_log rows (admin-only select)', async () => {
    const res = await customer.from('email_log').select('id').eq('recipient', claimRecipient);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(0);
  });

  // ── automation_settings: seeded dark, write-fenced ────────────────────────

  test('the five kinds are seeded and a customer cannot flip them', async () => {
    const seeded = await service.from('automation_settings').select('kind, enabled').order('kind');
    expect(seeded.error).toBeNull();
    const kinds = (seeded.data ?? []).map((r) => (r as { kind: string }).kind);
    for (const k of ['reward_ready', 'invite_followup', 'winback', 'discount_expiry', 'welcome']) {
      expect(kinds).toContain(k);
    }

    const customerFlip = await customer
      .from('automation_settings')
      .update({ enabled: true })
      .eq('kind', 'welcome');
    expect(customerFlip.error).not.toBeNull();

    const after = await service.from('automation_settings').select('enabled').eq('kind', 'welcome').single();
    expect((after.data as { enabled: boolean }).enabled).toBe(false);
  });

  // ── admin_set_automation_kind ─────────────────────────────────────────────

  test('admin_set_automation_kind is revoked from anon', async () => {
    const res = await anon.rpc('admin_set_automation_kind', { p_kind: 'welcome', p_enabled: true });
    expect(res.error).not.toBeNull();
  });

  test('admin toggles a kind on, audit row lands, unknown kind rejects', async () => {
    const on = await admin.rpc('admin_set_automation_kind', { p_kind: 'welcome', p_enabled: true });
    expect(on.error).toBeNull();
    expect(on.data).toMatchObject({ kind: 'welcome', enabled: true });

    const row = await service.from('automation_settings').select('enabled, updated_by').eq('kind', 'welcome').single();
    expect((row.data as { enabled: boolean; updated_by: string }).enabled).toBe(true);
    expect((row.data as { enabled: boolean; updated_by: string }).updated_by).toBe(adminUserId);

    const audit = await service
      .from('audit_log')
      .select('action, entity_id')
      .eq('action', 'automation.kind_toggled')
      .eq('entity_id', 'welcome');
    expect(audit.error).toBeNull();
    expect((audit.data ?? []).length).toBeGreaterThan(0);

    const off = await admin.rpc('admin_set_automation_kind', { p_kind: 'welcome', p_enabled: false });
    expect(off.error).toBeNull();
    expect(off.data).toMatchObject({ kind: 'welcome', enabled: false });

    const bogus = await admin.rpc('admin_set_automation_kind', { p_kind: 'not-a-kind', p_enabled: true });
    expect(bogus.error).not.toBeNull();
  });

  // ── admin_email_log ───────────────────────────────────────────────────────

  test('admin_email_log is gated (anon rejected) and returns rows + per-kind summary', async () => {
    const anonRes = await anon.rpc('admin_email_log', { p_limit: 10, p_offset: 0 });
    expect(anonRes.error).not.toBeNull();

    const res = await admin.rpc('admin_email_log', { p_limit: 100, p_offset: 0 });
    expect(res.error).toBeNull();
    const payload = res.data as {
      rows: Array<{ recipient: string; kind: string; periodKey: string; sentIso: string }>;
      total: number;
      summary: Record<string, number>;
    };
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(payload.total).toBeGreaterThanOrEqual(2);
    // The two claims this suite inserted are counted per kind.
    expect(payload.summary.welcome).toBeGreaterThanOrEqual(1);
    expect(payload.summary.reward_ready).toBeGreaterThanOrEqual(1);
    const mine = payload.rows.find((r) => r.recipient === claimRecipient && r.kind === 'welcome');
    expect(mine).toBeTruthy();
    expect(mine?.periodKey).toBe('wc-once');
  });

  // ── marketing_opt_out: customer-writable, guard regression ────────────────

  test('a customer updates own marketing_opt_out while tier stays pinned', async () => {
    // One update that flips the opt-out AND tries to escalate tier: the
    // opt-out must land, the tier must silently pin to its old value (043/049
    // guard) — proving marketing_opt_out did NOT join the pinned set.
    const res = await customer
      .from('customer_profiles')
      .update({ marketing_opt_out: true, tier: 'pro' })
      .eq('user_id', customerUserId)
      .select('marketing_opt_out, tier')
      .single();
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ marketing_opt_out: true, tier: 'member' });

    // And back off again — it is a real switch, not a one-way latch.
    const back = await customer
      .from('customer_profiles')
      .update({ marketing_opt_out: false })
      .eq('user_id', customerUserId)
      .select('marketing_opt_out')
      .single();
    expect(back.error).toBeNull();
    expect((back.data as { marketing_opt_out: boolean }).marketing_opt_out).toBe(false);
  });

  test('anon cannot write marketing_opt_out at all', async () => {
    const res = await anon
      .from('customer_profiles')
      .update({ marketing_opt_out: true })
      .eq('user_id', customerUserId)
      .select('user_id');
    // RLS: anon matches no rows (or is rejected outright) — nothing changes.
    expect(res.data ?? []).toHaveLength(0);

    const check = await service
      .from('customer_profiles')
      .select('marketing_opt_out')
      .eq('user_id', customerUserId)
      .single();
    expect((check.data as { marketing_opt_out: boolean }).marketing_opt_out).toBe(false);
  });
});
