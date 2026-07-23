/**
 * Membership Phase 0 admin surface (migrations 070 + 071) against a REAL local
 * Postgres. Proves the server-side truth the Members control center renders:
 *
 *   • admin gating — anon cannot call any admin_member_* function (revoked
 *     from anon; is_admin() gate raises for non-admins);
 *   • admin_member_roster — a seeded member surfaces with the REAL reward-
 *     ledger balance (not the old client-side floor($paid/100) projection),
 *     real lifetime spend, computed segment, tier, and effective discount;
 *   • admin_member_stats — aggregates include our member (tolerant asserts;
 *     the scan is global so sibling fixtures coexist);
 *   • admin_member_spend_distribution — returns trailing-12mo percentiles;
 *   • record_member_invite + link_my_orders — an invite is logged and then
 *     stamped converted when the invited email signs up (funnel closes).
 *
 * Assertions use toContain / toBeGreaterThanOrEqual, never exact counts —
 * other suites' fixtures share the database.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for the
 * guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient, SUPABASE_URL, ANON_KEY } from './env';
import { createClient } from '@supabase/supabase-js';

logSkipReason('membership_admin_surface suite');

interface RosterResponse {
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

describe.skipIf(!canRun)('membership admin surface (real DB, migrations 070/071)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;

  let adminUserId = '';
  let admin: SupabaseClient; // authenticated as an active admin

  let memberUserId = '';
  let memberCustomerId = '';
  const memberEmail = `member-${runId}@example.test`;

  const inviteEmail = `invitee-${runId}@example.test`;
  let inviteUserId = '';
  const cleanupOrderIds: string[] = [];

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const c = createClient(SUPABASE_URL ?? '', ANON_KEY ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return c;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // ── Admin: create user, mark active admin, sign in ──
    const adminPw = `Admin-${runId}!`;
    const adminUser = await service.auth.admin.createUser({
      email: `admin-${runId}@example.test`,
      password: adminPw,
      email_confirm: true,
    });
    if (adminUser.error || !adminUser.data.user) throw new Error(`admin createUser: ${adminUser.error?.message}`);
    adminUserId = adminUser.data.user.id;
    const adminRow = await service.from('admin_users').insert({
      user_id: adminUserId, email: `admin-${runId}@example.test`, active: true,
    });
    if (adminRow.error) throw new Error(`admin_users insert: ${adminRow.error.message}`);
    admin = await signIn(`admin-${runId}@example.test`, adminPw);

    // ── Member: seed CRM customer FIRST so the signup trigger links customer_id ──
    const cust = await service.from('customers').insert({
      contact_key: memberEmail.toLowerCase(),
      display_name: `Member ${runId}`,
      contact: memberEmail,
      status: 'active',
    }).select('id').single();
    if (cust.error || !cust.data) throw new Error(`customers insert: ${cust.error?.message}`);
    memberCustomerId = cust.data.id as string;

    const memberPw = `Member-${runId}!`;
    const memberUser = await service.auth.admin.createUser({
      email: memberEmail,
      password: memberPw,
      email_confirm: true,
      user_metadata: { full_name: `Member ${runId}` }, // fires handle_new_customer → profile + customer_id link
    });
    if (memberUser.error || !memberUser.data.user) throw new Error(`member createUser: ${memberUser.error?.message}`);
    memberUserId = memberUser.data.user.id;

    // A paid order owned by the member ($210), and a real reward-ledger balance
    // of 350 pts (an adjustment, NOT floor($paid/100)=2 — this is the whole
    // point: the roster must show the ledger, not a projection).
    const order = await service.from('orders').insert({
      order_number: `ITEST-MB-${runId}`,
      buyer_name: `Member ${runId}`,
      buyer_contact: memberEmail,
      user_id: memberUserId,
      status: 'paid',
      invoice_amount_cents: 21_000,
      paid_at: new Date().toISOString(),
    }).select('id').single();
    if (order.error || !order.data) throw new Error(`order insert: ${order.error?.message}`);
    cleanupOrderIds.push(order.data.id as string);

    const ledger = await service.from('reward_ledger').insert({
      user_id: memberUserId, kind: 'adjustment', points: 350, note: `test balance ${runId}`,
    });
    if (ledger.error) throw new Error(`reward_ledger insert: ${ledger.error.message}`);
  }, 60_000);

  afterAll(async () => {
    if (!canRun) return;
    await service.from('member_invites').delete().in('contact_key', [inviteEmail.toLowerCase(), memberEmail.toLowerCase()]);
    if (cleanupOrderIds.length) await service.from('orders').delete().in('id', cleanupOrderIds);
    if (memberCustomerId) await service.from('customers').delete().eq('id', memberCustomerId);
    if (memberUserId) await service.auth.admin.deleteUser(memberUserId);
    if (inviteUserId) await service.auth.admin.deleteUser(inviteUserId);
    if (adminUserId) await service.auth.admin.deleteUser(adminUserId);
  }, 60_000);

  test('anon cannot call any admin_member_* function', async () => {
    const roster = await anon.rpc('admin_member_roster', { p_segment: 'all' });
    expect(roster.error).toBeTruthy();
    const stats = await anon.rpc('admin_member_stats');
    expect(stats.error).toBeTruthy();
    const dist = await anon.rpc('admin_member_spend_distribution');
    expect(dist.error).toBeTruthy();
    const activity = await anon.rpc('admin_member_activity', { p_customer_id: memberCustomerId });
    expect(activity.error).toBeTruthy();
  });

  test('roster shows the REAL reward-ledger balance, spend, tier and segment', async () => {
    const res = await admin.rpc('admin_member_roster', { p_segment: 'all', p_sort: 'points', p_limit: 200, p_offset: 0 });
    expect(res.error).toBeNull();
    const data = res.data as RosterResponse;
    const row = data.rows.find((r) => r.userId === memberUserId);
    expect(row, 'seeded member should appear in the roster').toBeTruthy();
    expect(row!.points).toBe(350);          // ledger balance, NOT floor(21000/100)=210
    expect(row!.spendCents).toBe(21_000);
    expect(row!.paidOrders).toBe(1);
    expect(row!.tier).toBe('member');
    expect(row!.segment).toBe('new');        // joined <30d, ≤1 paid order
    expect(row!.effectivePercent).toBe(15);  // the account-holder floor from effective_customer_discount()
    expect(row!.rewardReady).toBe(true);     // 350 ≥ 300, no active voucher
    expect(row!.id).toBe(memberCustomerId);  // linked → profile deep-link works
  });

  test('roster segment filter and search narrow the set', async () => {
    const bySeg = await admin.rpc('admin_member_roster', { p_segment: 'new', p_limit: 200 });
    expect(bySeg.error).toBeNull();
    expect((bySeg.data as RosterResponse).rows.some((r) => r.userId === memberUserId)).toBe(true);

    const search = await admin.rpc('admin_member_roster', { p_search: memberEmail, p_limit: 200 });
    expect(search.error).toBeNull();
    const rows = (search.data as RosterResponse).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => String(r.contact).includes(runId))).toBe(true);
  });

  test('stats aggregates include our member', async () => {
    const res = await admin.rpc('admin_member_stats');
    expect(res.error).toBeNull();
    const s = res.data as Record<string, number>;
    expect(s.membersTotal).toBeGreaterThanOrEqual(1);
    expect(s.pointsLiability).toBeGreaterThanOrEqual(350);
    expect(typeof s.memberRevenueSharePct).toBe('number');
    expect(s).toHaveProperty('generatedAt');
    expect(s).toHaveProperty('segments');
  });

  test('spend distribution returns trailing-12mo percentiles', async () => {
    const res = await admin.rpc('admin_member_spend_distribution');
    expect(res.error).toBeNull();
    const d = res.data as Record<string, unknown>;
    expect(d.basis).toBe('trailing_12_month_paid_spend_cents');
    expect(Number(d.activeSpenders)).toBeGreaterThanOrEqual(1);
    expect(d).toHaveProperty('p90');
    expect(d).toHaveProperty('suggestedVipGateCents');
  });

  test('activity timeline unions joined + order + reward events', async () => {
    const res = await admin.rpc('admin_member_activity', { p_customer_id: memberCustomerId });
    expect(res.error).toBeNull();
    const events = (res.data as { events: Array<{ kind: string }> }).events;
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('joined');
    expect(kinds).toContain('order');
    expect(kinds).toContain('reward');
  });

  test('record_member_invite logs an invite; link_my_orders stamps it converted on signup', async () => {
    // Log an invite for a guest email (service-role path, as the edge fn does).
    const rec = await service.rpc('record_member_invite', { p_email: inviteEmail, p_points: 180, p_channel: 'email' });
    expect(rec.error).toBeNull();

    const invBefore = await service
      .from('member_invites').select('id, converted_at').eq('contact_key', inviteEmail.toLowerCase());
    expect(invBefore.error).toBeNull();
    expect(invBefore.data?.length).toBe(1);
    expect(invBefore.data?.[0].converted_at).toBeNull();

    // The guest signs up with that email and runs the signup funnel.
    const pw = `Invitee-${runId}!`;
    const u = await service.auth.admin.createUser({
      email: inviteEmail, password: pw, email_confirm: true, user_metadata: { full_name: `Invitee ${runId}` },
    });
    if (u.error || !u.data.user) throw new Error(`invitee createUser: ${u.error?.message}`);
    inviteUserId = u.data.user.id;
    const invitee = await signIn(inviteEmail, pw);
    const link = await invitee.rpc('link_my_orders');
    expect(link.error).toBeNull();

    const invAfter = await service
      .from('member_invites').select('converted_at, converted_user_id').eq('contact_key', inviteEmail.toLowerCase());
    expect(invAfter.error).toBeNull();
    expect(invAfter.data?.[0].converted_at).not.toBeNull();
    expect(invAfter.data?.[0].converted_user_id).toBe(inviteUserId);
  });

  test('anon cannot call admin_log_member_invite', async () => {
    const res = await anon.rpc('admin_log_member_invite', { p_email: `x-${runId}@example.test`, p_channel: 'copy' });
    expect(res.error).toBeTruthy();
  });
});
