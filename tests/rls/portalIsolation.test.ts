/**
 * RLS / integration suite for the customer portal (migrations 043–045).
 *
 * Exercises real Postgres RLS + RPC grants through PostgREST — the only way
 * to prove the security invariants in docs/CUSTOMER_PORTAL_BLUEPRINT.md §2.2
 * and §6.2 (AC5, AC6, AC9) actually hold, since RLS cannot be unit-tested in
 * JS. Requires a LOCAL `supabase start` stack; see the header guard below for
 * how it's configured and how it skips.
 *
 * NEVER point this at a production project. As a safety net (in addition to
 * requiring all three env vars), the suite refuses to run unless
 * TEST_SUPABASE_URL resolves to a loopback host.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

function isLoopbackUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

const hasEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const canRun = hasEnv && isLoopbackUrl(SUPABASE_URL);

if (!hasEnv) {
  console.log(
    '[rls] Skipping portal RLS suite: TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / ' +
      'TEST_SUPABASE_SERVICE_ROLE_KEY are not set. Run `supabase start` locally, apply ' +
      'migrations through 045, then set those three env vars and re-run `npm run test`.',
  );
} else if (!canRun) {
  console.log(
    `[rls] Skipping portal RLS suite: TEST_SUPABASE_URL ("${SUPABASE_URL}") is not a ` +
      'loopback host. This suite only runs against a local Supabase stack — never point ' +
      'it at a hosted/production project.',
  );
}

/** Passes when either the query errored (permission denied) or returned zero
 *  rows — the two shapes "no access" can take depending on whether the table
 *  revokes the anon/authenticated grant outright or relies on RLS alone. */
function expectNoAccess<T>(res: { data: T[] | null; error: { message: string } | null }): void {
  if (res.error) {
    expect(res.error).toBeTruthy();
    return;
  }
  expect(res.data ?? []).toEqual([]);
}

function expectRpcDenied(res: { data: unknown; error: { message: string } | null }): void {
  expect(res.error).toBeTruthy();
}

describe.skipIf(!canRun)('Portal RLS isolation (migrations 043–045)', () => {
  const runId = randomUUID().slice(0, 8);
  // Constructed inside beforeAll (not here) — describe.skipIf still runs the
  // suite body during collection even when every test inside is skipped, so
  // eagerly calling createClient() here would throw when the env is unset.
  let service: SupabaseClient;

  const PASSWORD = `Rls-Test-${runId}!`;
  const emailA = `rls-a-${runId}@example.test`;
  const emailB = `rls-b-${runId}@example.test`;
  const emailAdmin = `rls-admin-${runId}@example.test`;

  let userAId = '';
  let userBId = '';
  let adminId = '';
  let orderAId = '';
  let orderBId = '';
  let orderANumber = '';
  let orderBNumber = '';

  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let clientAdmin: SupabaseClient;
  let clientAnon: SupabaseClient;

  function freshClient(): SupabaseClient {
    return createClient(SUPABASE_URL ?? '', ANON_KEY ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  beforeAll(async () => {
    service = createClient(SUPABASE_URL ?? '', SERVICE_ROLE_KEY ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Users ──────────────────────────────────────────────────────────────
    const [a, b, admin] = await Promise.all([
      service.auth.admin.createUser({
        email: emailA,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'RLS Test Customer A' },
      }),
      service.auth.admin.createUser({
        email: emailB,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'RLS Test Customer B' },
      }),
      service.auth.admin.createUser({
        email: emailAdmin,
        password: PASSWORD,
        email_confirm: true,
      }),
    ]);
    if (a.error || !a.data.user) throw new Error(`Failed to create customer A: ${a.error?.message}`);
    if (b.error || !b.data.user) throw new Error(`Failed to create customer B: ${b.error?.message}`);
    if (admin.error || !admin.data.user) throw new Error(`Failed to create admin: ${admin.error?.message}`);
    userAId = a.data.user.id;
    userBId = b.data.user.id;
    adminId = admin.data.user.id;

    const adminInsert = await service
      .from('admin_users')
      .insert({ user_id: adminId, email: emailAdmin, display_name: 'RLS Test Admin' });
    if (adminInsert.error) throw new Error(`Failed to seed admin_users: ${adminInsert.error.message}`);

    // ── Signed-in clients ─────────────────────────────────────────────────
    clientA = freshClient();
    clientB = freshClient();
    clientAdmin = freshClient();
    clientAnon = freshClient();

    const [signA, signB, signAdmin] = await Promise.all([
      clientA.auth.signInWithPassword({ email: emailA, password: PASSWORD }),
      clientB.auth.signInWithPassword({ email: emailB, password: PASSWORD }),
      clientAdmin.auth.signInWithPassword({ email: emailAdmin, password: PASSWORD }),
    ]);
    if (signA.error) throw new Error(`Customer A sign-in failed: ${signA.error.message}`);
    if (signB.error) throw new Error(`Customer B sign-in failed: ${signB.error.message}`);
    if (signAdmin.error) throw new Error(`Admin sign-in failed: ${signAdmin.error.message}`);

    // ── Orders (one per customer), owned via user_id ────────────────────────
    orderANumber = `RLS-TEST-A-${runId}`;
    orderBNumber = `RLS-TEST-B-${runId}`;

    const [orderA, orderB] = await Promise.all([
      service
        .from('orders')
        .insert({
          order_number: orderANumber,
          buyer_name: 'RLS Test Customer A',
          buyer_contact: emailA,
          user_id: userAId,
          subtotal_cents: 10_000,
          shipping_cents: 0,
          discount_cents: 500,
          invoice_amount_cents: 9_500,
        })
        .select('id')
        .single(),
      service
        .from('orders')
        .insert({
          order_number: orderBNumber,
          buyer_name: 'RLS Test Customer B',
          buyer_contact: emailB,
          user_id: userBId,
          subtotal_cents: 20_000,
          shipping_cents: 0,
          discount_cents: 0,
          invoice_amount_cents: 20_000,
        })
        .select('id')
        .single(),
    ]);
    if (orderA.error || !orderA.data) throw new Error(`Failed to seed order A: ${orderA.error?.message}`);
    if (orderB.error || !orderB.data) throw new Error(`Failed to seed order B: ${orderB.error?.message}`);
    orderAId = orderA.data.id as string;
    orderBId = orderB.data.id as string;

    const [linesA, linesB, couponsA, couponsB] = await Promise.all([
      service.from('order_lines').insert({
        order_id: orderAId, sku: 'RLS-TEST-SKU', product_name: 'RLS Test Item', quantity: 1,
        unit_price_cents: 10_000,
      }),
      service.from('order_lines').insert({
        order_id: orderBId, sku: 'RLS-TEST-SKU', product_name: 'RLS Test Item', quantity: 1,
        unit_price_cents: 20_000,
      }),
      service.from('order_coupons').insert({
        order_id: orderAId, code: 'RLSCODE', kind: 'percent', percent: 5, discount_cents: 500,
      }),
      service.from('order_coupons').insert({
        order_id: orderBId, code: 'RLSCODE', kind: 'percent', percent: 3, discount_cents: 600,
      }),
    ]);
    if (linesA.error) throw new Error(`Failed to seed order_lines A: ${linesA.error.message}`);
    if (linesB.error) throw new Error(`Failed to seed order_lines B: ${linesB.error.message}`);
    if (couponsA.error) throw new Error(`Failed to seed order_coupons A: ${couponsA.error.message}`);
    if (couponsB.error) throw new Error(`Failed to seed order_coupons B: ${couponsB.error.message}`);

    const [rewardA, rewardB, discountA, discountB] = await Promise.all([
      service.from('reward_ledger').insert({
        user_id: userAId, order_id: orderAId, kind: 'earn', points: 95, note: 'RLS test seed',
      }),
      service.from('reward_ledger').insert({
        user_id: userBId, order_id: orderBId, kind: 'earn', points: 200, note: 'RLS test seed',
      }),
      service.from('customer_discounts').insert({
        user_id: userAId, scope: 'lifetime', percent: 10, label: 'RLS Test Lifetime 10%', active: true,
      }),
      service.from('customer_discounts').insert({
        user_id: userBId, scope: 'lifetime', percent: 15, label: 'RLS Test Lifetime 15%', active: true,
      }),
    ]);
    if (rewardA.error) throw new Error(`Failed to seed reward_ledger A: ${rewardA.error.message}`);
    if (rewardB.error) throw new Error(`Failed to seed reward_ledger B: ${rewardB.error.message}`);
    if (discountA.error) throw new Error(`Failed to seed customer_discounts A: ${discountA.error.message}`);
    if (discountB.error) throw new Error(`Failed to seed customer_discounts B: ${discountB.error.message}`);
  }, 30_000);

  afterAll(async () => {
    if (!hasEnv) return;
    // orders cascade-delete order_lines + order_coupons.
    await service.from('orders').delete().in('id', [orderAId, orderBId].filter(Boolean));
    // Deleting the auth users cascades customer_profiles, reward_ledger,
    // customer_discounts, and admin_users.
    await Promise.all(
      [userAId, userBId, adminId]
        .filter(Boolean)
        .map((id) => service.auth.admin.deleteUser(id)),
    );
  }, 30_000);

  // ── AC5 / §6.2 — cross-customer order isolation ─────────────────────────
  describe('order isolation', () => {
    test('customer A sees their own order via table select', async () => {
      const res = await clientA.from('orders').select('*').eq('id', orderAId);
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
      expect(res.data?.[0].order_number).toBe(orderANumber);
    });

    test('customer A gets zero rows for customer B order via table select', async () => {
      const res = await clientA.from('orders').select('*').eq('id', orderBId);
      expectNoAccess(res);
    });

    test('customer A resolves their own order via get_my_order', async () => {
      const res = await clientA.rpc('get_my_order', { p_order_number: orderANumber });
      expect(res.error).toBeNull();
      const payload = res.data as { found: boolean; order_number?: string };
      expect(payload.found).toBe(true);
      expect(payload.order_number).toBe(orderANumber);
    });

    test('customer A gets {found:false} for customer B order via get_my_order (no oracle)', async () => {
      const res = await clientA.rpc('get_my_order', { p_order_number: orderBNumber });
      expect(res.error).toBeNull();
      const payload = res.data as { found: boolean };
      expect(payload.found).toBe(false);
    });

    test('customer A sees their own order_lines but not customer B order_lines', async () => {
      const own = await clientA.from('order_lines').select('*').eq('order_id', orderAId);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const other = await clientA.from('order_lines').select('*').eq('order_id', orderBId);
      expectNoAccess(other);
    });

    test('customer A sees their own order_coupons but not customer B order_coupons', async () => {
      const own = await clientA.from('order_coupons').select('*').eq('order_id', orderAId);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const other = await clientA.from('order_coupons').select('*').eq('order_id', orderBId);
      expectNoAccess(other);
    });
  });

  // ── reward_ledger / customer_discounts read isolation ───────────────────
  describe('reward_ledger and customer_discounts isolation', () => {
    test('customer A reads only their own reward_ledger rows', async () => {
      const res = await clientA.from('reward_ledger').select('*');
      expect(res.error).toBeNull();
      expect(res.data?.every((row) => row.user_id === userAId)).toBe(true);
      expect(res.data?.some((row) => row.user_id === userBId)).toBe(false);
    });

    test('customer A reads only their own customer_discounts rows', async () => {
      const res = await clientA.from('customer_discounts').select('*');
      expect(res.error).toBeNull();
      expect(res.data?.every((row) => row.user_id === userAId)).toBe(true);
      expect(res.data?.some((row) => row.user_id === userBId)).toBe(false);
    });
  });

  // ── AC9 — guarded profile columns are not customer-writable ─────────────
  describe('guarded customer_profiles columns', () => {
    test('customer A cannot change their own tier/status/account_type (write is pinned, not rejected)', async () => {
      const before = await clientA
        .from('customer_profiles')
        .select('tier, status, account_type')
        .eq('user_id', userAId)
        .single();
      expect(before.error).toBeNull();
      expect(before.data?.tier).toBe('member');
      expect(before.data?.status).toBe('active');
      expect(before.data?.account_type).toBe('individual');

      const write = await clientA
        .from('customer_profiles')
        .update({ tier: 'pro', status: 'suspended', account_type: 'business' })
        .eq('user_id', userAId);
      // The guard trigger pins the columns silently — it does not raise.
      expect(write.error).toBeNull();

      const after = await clientA
        .from('customer_profiles')
        .select('tier, status, account_type')
        .eq('user_id', userAId)
        .single();
      expect(after.error).toBeNull();
      expect(after.data?.tier).toBe('member');
      expect(after.data?.status).toBe('active');
      expect(after.data?.account_type).toBe('individual');
    });
  });

  // ── reward_ledger is append-only for every client role ───────────────────
  describe('reward_ledger is append-only', () => {
    test('customer A cannot insert a reward_ledger row', async () => {
      const res = await clientA
        .from('reward_ledger')
        .insert({ user_id: userAId, kind: 'adjustment', points: 1000, note: 'self-granted' });
      expect(res.error).toBeTruthy();
    });

    test('customer A cannot update their own reward_ledger row', async () => {
      const own = await service
        .from('reward_ledger')
        .select('id')
        .eq('user_id', userAId)
        .eq('kind', 'earn')
        .single();
      expect(own.error).toBeNull();

      const res = await clientA.from('reward_ledger').update({ points: 999999 }).eq('id', own.data?.id);
      expect(res.error).toBeTruthy();

      const unchanged = await service.from('reward_ledger').select('points').eq('id', own.data?.id).single();
      expect(unchanged.data?.points).toBe(95);
    });

    test('customer A cannot delete their own reward_ledger row', async () => {
      const own = await service
        .from('reward_ledger')
        .select('id')
        .eq('user_id', userAId)
        .eq('kind', 'earn')
        .single();

      const res = await clientA.from('reward_ledger').delete().eq('id', own.data?.id);
      expect(res.error).toBeTruthy();

      const stillThere = await service.from('reward_ledger').select('id').eq('id', own.data?.id).maybeSingle();
      expect(stillThere.data).not.toBeNull();
    });
  });

  // ── anon: nothing new anywhere ────────────────────────────────────────────
  describe('anon client gets nothing from the new portal surfaces', () => {
    test('anon gets no rows from orders / order_lines / order_coupons', async () => {
      expectNoAccess(await clientAnon.from('orders').select('*').eq('id', orderAId));
      expectNoAccess(await clientAnon.from('order_lines').select('*').eq('order_id', orderAId));
      expectNoAccess(await clientAnon.from('order_coupons').select('*').eq('order_id', orderAId));
    });

    test('anon gets no rows from reward_ledger / customer_discounts', async () => {
      expectNoAccess(await clientAnon.from('reward_ledger').select('*'));
      expectNoAccess(await clientAnon.from('customer_discounts').select('*'));
    });

    test('anon cannot execute get_my_order / get_my_reward_summary', async () => {
      expectRpcDenied(await clientAnon.rpc('get_my_order', { p_order_number: orderANumber }));
      expectRpcDenied(await clientAnon.rpc('get_my_reward_summary'));
    });

    test('anon cannot execute effective_customer_discount or any admin_* RPC', async () => {
      expectRpcDenied(await clientAnon.rpc('effective_customer_discount', { p_user_id: userAId }));
      expectRpcDenied(
        await clientAnon.rpc('admin_adjust_reward_points', {
          p_user_id: userAId,
          p_points: 10,
          p_note: 'anon attempt',
        }),
      );
      expectRpcDenied(
        await clientAnon.rpc('admin_set_customer_discount', {
          p_user_id: userAId,
          p_scope: 'lifetime',
          p_percent: 50,
          p_label: 'anon attempt',
        }),
      );
      expectRpcDenied(
        await clientAnon.rpc('admin_set_profile_flags', {
          p_user_id: userAId,
          p_tier: 'pro',
          p_status: 'active',
          p_account_type: 'individual',
          p_business_name: null,
        }),
      );
    });
  });

  // ── authenticated-but-not-admin: every admin RPC still rejects ───────────
  describe('a signed-in (non-admin) customer cannot call admin RPCs', () => {
    test('customer A cannot execute effective_customer_discount (service-role only)', async () => {
      expectRpcDenied(await clientA.rpc('effective_customer_discount', { p_user_id: userAId }));
    });

    test('customer A cannot execute admin_set_profile_flags on themselves', async () => {
      expectRpcDenied(
        await clientA.rpc('admin_set_profile_flags', {
          p_user_id: userAId,
          p_tier: 'pro',
          p_status: 'active',
          p_account_type: 'individual',
          p_business_name: null,
        }),
      );
    });

    test('customer A cannot execute admin_adjust_reward_points on themselves', async () => {
      expectRpcDenied(
        await clientA.rpc('admin_adjust_reward_points', {
          p_user_id: userAId,
          p_points: 10,
          p_note: 'self attempt',
        }),
      );
    });
  });

  // ── admin_adjust_reward_points — note required, balance = sum(entries) ──
  describe('admin_adjust_reward_points', () => {
    test('rejects an adjustment with no note', async () => {
      const res = await clientAdmin.rpc('admin_adjust_reward_points', {
        p_user_id: userAId,
        p_points: 10,
        p_note: '',
      });
      expect(res.error).toBeTruthy();
    });

    test('applies a noted adjustment and the balance equals the sum of all entries', async () => {
      const before = await clientA.rpc('get_my_reward_summary');
      expect(before.error).toBeNull();
      const beforeBalance = (before.data as { balance: number }).balance;

      const adjust = await clientAdmin.rpc('admin_adjust_reward_points', {
        p_user_id: userAId,
        p_points: 25,
        p_note: 'RLS test manual credit',
      });
      expect(adjust.error).toBeNull();

      const after = await clientA.rpc('get_my_reward_summary');
      expect(after.error).toBeNull();
      const payload = after.data as { balance: number; entries: Array<{ points: number }> };
      expect(payload.balance).toBe(beforeBalance + 25);

      const summedEntries = payload.entries.reduce((sum, e) => sum + e.points, 0);
      expect(payload.balance).toBe(summedEntries);
    });
  });
});
