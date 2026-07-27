/**
 * Member management write paths against a REAL local Postgres (migrations
 * 043/044/045/049). These are the three RPCs the shared accountPanels call from
 * both the customer-detail page and /admin/members:
 *
 *   • admin_set_profile_flags       — atomic tier/status/account_type/
 *                                     business_name/free_shipping update.
 *   • admin_adjust_reward_points    — appends a signed reward_ledger row (never
 *                                     mutates a balance) with a mandatory note.
 *   • admin_set_customer_discount   — upserts the active rule for a scope; the
 *   • admin_deactivate_customer_discount — soft-off is proven too.
 *
 * Mocks cannot prove the parts that matter here: the SECURITY DEFINER admin
 * gate, the ledger append semantics, and that these are revoked from anon.
 * This suite drives the real rows through a service-role client for fixtures
 * and an anon client to prove the gate.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for the
 * guard. NEVER point this at production — it creates and deletes auth users,
 * profiles, ledger rows and discounts.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('member write-paths suite');

interface RewardRow { kind: string; points: number; note: string | null }

describe.skipIf(!canRun)('member management write paths (real DB, migrations 043–045/049)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient; // signed in as an active admin — the RPC caller
  let userId = '';
  let adminUserId = '';
  const email = `member-wp-${runId}@example.test`;

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // The write RPCs gate on is_admin(), which authorizes by an active row in
    // admin_users for the CALLING auth user. The service-role key bypasses RLS
    // but is NOT an admin user, so it cannot (and must not) call these — the
    // real admin console calls them as a signed-in admin, and so does this
    // suite. Mirrors tests/integration/membershipAdminSurface.test.ts.
    const adminEmail = `admin-wp-${runId}@example.test`;
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

    // The member being managed — a real auth user (FK target for
    // customer_profiles / reward_ledger / customer_discounts).
    const created = await service.auth.admin.createUser({
      email,
      password: `pw-${runId}-Aa1!`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    userId = created.data.user.id;

    // The signup trigger (028/043) may already have materialized a profile row;
    // upsert so the suite owns a known starting state regardless.
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: userId, full_name: 'Write-Path Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);
  });

  afterAll(async () => {
    if (userId) {
      await service.from('customer_discounts').delete().eq('user_id', userId);
      await service.from('reward_ledger').delete().eq('user_id', userId);
      await service.from('customer_profiles').delete().eq('user_id', userId);
      await service.auth.admin.deleteUser(userId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  // ── admin_set_profile_flags ───────────────────────────────────────────────

  test('admin_set_profile_flags updates the row atomically', async () => {
    const res = await admin.rpc('admin_set_profile_flags', {
      p_user_id: userId,
      p_tier: 'pro',
      p_status: 'active',
      p_account_type: 'business',
      p_business_name: 'Meridian Bioscience LLC',
      p_free_shipping: true,
    });
    expect(res.error).toBeNull();

    const row = await service
      .from('customer_profiles')
      .select('tier, status, account_type, business_name, free_shipping')
      .eq('user_id', userId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      tier: 'pro',
      account_type: 'business',
      business_name: 'Meridian Bioscience LLC',
      free_shipping: true,
    });
  });

  test('admin_set_profile_flags is revoked from anon', async () => {
    const res = await anon.rpc('admin_set_profile_flags', {
      p_user_id: userId,
      p_tier: 'member',
      p_status: 'active',
      p_account_type: 'individual',
      p_business_name: null,
      p_free_shipping: false,
    });
    expect(res.error).not.toBeNull();
  });

  // ── admin_adjust_reward_points ────────────────────────────────────────────

  test('admin_adjust_reward_points appends signed ledger rows (never mutates a balance)', async () => {
    const credit = await admin.rpc('admin_adjust_reward_points', {
      p_user_id: userId, p_points: 120, p_note: 'Goodwill credit',
    });
    expect(credit.error).toBeNull();

    const debit = await admin.rpc('admin_adjust_reward_points', {
      p_user_id: userId, p_points: -20, p_note: 'Correction',
    });
    expect(debit.error).toBeNull();

    const ledger = await service
      .from('reward_ledger')
      .select('kind, points, note')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    expect(ledger.error).toBeNull();
    const rows = (ledger.data ?? []) as RewardRow[];
    // Two distinct rows — the debit did not overwrite the credit.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ points: 120, note: 'Goodwill credit' });
    expect(rows[1]).toMatchObject({ points: -20, note: 'Correction' });
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(100);
  });

  test('admin_adjust_reward_points is revoked from anon', async () => {
    const res = await anon.rpc('admin_adjust_reward_points', {
      p_user_id: userId, p_points: 999, p_note: 'anon should not pass',
    });
    expect(res.error).not.toBeNull();
  });

  // ── admin_set_customer_discount / _deactivate ─────────────────────────────

  test('admin_set_customer_discount sets one active rule per scope, then deactivate soft-offs it', async () => {
    const set = await admin.rpc('admin_set_customer_discount', {
      p_user_id: userId, p_scope: 'lifetime', p_percent: 12.5, p_label: 'Lifetime 12.5%', p_expires_at: null,
    });
    expect(set.error).toBeNull();

    const active = await service
      .from('customer_discounts')
      .select('id, percent, label, active')
      .eq('user_id', userId)
      .eq('scope', 'lifetime')
      .eq('active', true);
    expect(active.error).toBeNull();
    expect(active.data).toHaveLength(1);
    const rule = (active.data ?? [])[0] as { id: string; percent: number; active: boolean };
    expect(rule.percent).toBeCloseTo(12.5, 2);

    // Replacing the active lifetime rule must not leave two active at once.
    const replace = await admin.rpc('admin_set_customer_discount', {
      p_user_id: userId, p_scope: 'lifetime', p_percent: 15, p_label: 'Lifetime 15%', p_expires_at: null,
    });
    expect(replace.error).toBeNull();
    const afterReplace = await service
      .from('customer_discounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('scope', 'lifetime')
      .eq('active', true);
    expect(afterReplace.count).toBe(1);

    // Deactivate the current active rule.
    const current = await service
      .from('customer_discounts')
      .select('id')
      .eq('user_id', userId)
      .eq('scope', 'lifetime')
      .eq('active', true)
      .single();
    const off = await admin.rpc('admin_deactivate_customer_discount', { p_id: (current.data as { id: string }).id });
    expect(off.error).toBeNull();

    const afterOff = await service
      .from('customer_discounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('scope', 'lifetime')
      .eq('active', true);
    expect(afterOff.count).toBe(0);
  });

  test('admin_set_customer_discount is revoked from anon', async () => {
    const res = await anon.rpc('admin_set_customer_discount', {
      p_user_id: userId, p_scope: 'lifetime', p_percent: 50, p_label: 'anon', p_expires_at: null,
    });
    expect(res.error).not.toBeNull();
  });
});
