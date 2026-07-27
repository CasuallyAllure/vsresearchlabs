/**
 * Membership Phase 2 write/read surface (migration 073) against a REAL local
 * Postgres. Proves:
 *   • admin_void_voucher — active-only, appends a compensating +points refund
 *     (append-only, never mutates a balance), audits, refuses non-active and
 *     empty-reason, and is revoked from anon;
 *   • admin_member_vouchers / admin_member_invites — admin-gated read surfaces
 *     with correct status/funnel summaries;
 *   • admin_invitable_guests — includes a guest with banked points and no
 *     account, and EXCLUDES an existing member.
 *
 * Guarded like every integration suite (tests/integration/env.ts): only runs
 * against a loopback `supabase start` stack, never production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('member vouchers/invites suite');

describe.skipIf(!canRun)('member vouchers + invites (real DB, migration 073)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;

  let adminUserId = '';
  let memberUserId = '';
  let memberCustomerId = '';
  let voucherId = '';
  const cleanupOrderIds: string[] = [];

  const memberEmail = `mv-member-${runId}@example.test`;
  const guestEmail = `mv-guest-${runId}@example.test`;

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Admin caller (is_admin() authorizes on admin_users, not service-role).
    const adminEmail = `mv-admin-${runId}@example.test`;
    const adminPw = `Admin-${runId}-Aa1!`;
    const adminCreated = await service.auth.admin.createUser({ email: adminEmail, password: adminPw, email_confirm: true });
    if (adminCreated.error || !adminCreated.data.user) throw new Error(`admin createUser: ${adminCreated.error?.message}`);
    adminUserId = adminCreated.data.user.id;
    const adminRow = await service.from('admin_users').insert({ user_id: adminUserId, email: adminEmail, active: true });
    if (adminRow.error) throw new Error(`admin_users insert: ${adminRow.error.message}`);
    admin = anonClient();
    const signIn = await admin.auth.signInWithPassword({ email: adminEmail, password: adminPw });
    if (signIn.error) throw new Error(`admin sign-in: ${signIn.error.message}`);

    // Member: CRM customer + auth user (trigger links customer_id).
    const cust = await service.from('customers').insert({
      contact_key: memberEmail.toLowerCase(), display_name: `Member ${runId}`, contact: memberEmail, status: 'active',
    }).select('id').single();
    if (cust.error || !cust.data) throw new Error(`customers insert: ${cust.error?.message}`);
    memberCustomerId = cust.data.id as string;

    const memberUser = await service.auth.admin.createUser({
      email: memberEmail, password: `Member-${runId}!`, email_confirm: true,
      user_metadata: { full_name: `Member ${runId}` },
    });
    if (memberUser.error || !memberUser.data.user) throw new Error(`member createUser: ${memberUser.error?.message}`);
    memberUserId = memberUser.data.user.id;

    // A paid member order (spend; also makes the member ineligible for invite).
    const memberOrder = await service.from('orders').insert({
      order_number: `MV-MEMBER-${runId}`, buyer_name: `Member ${runId}`, buyer_contact: memberEmail,
      user_id: memberUserId, status: 'paid', invoice_amount_cents: 30_000, paid_at: new Date().toISOString(),
    }).select('id').single();
    if (memberOrder.error || !memberOrder.data) throw new Error(`member order: ${memberOrder.error?.message}`);
    cleanupOrderIds.push(memberOrder.data.id as string);

    // A guest paid order — no account for guestEmail → invitable.
    const guestOrder = await service.from('orders').insert({
      order_number: `MV-GUEST-${runId}`, buyer_name: `Guest ${runId}`, buyer_contact: guestEmail,
      status: 'paid', invoice_amount_cents: 15_000, paid_at: new Date().toISOString(),
    }).select('id').single();
    if (guestOrder.error || !guestOrder.data) throw new Error(`guest order: ${guestOrder.error?.message}`);
    cleanupOrderIds.push(guestOrder.data.id as string);

    // A redemption that produced an active voucher: +300 adjustment, −300 spend
    // (balance 0), and the active voucher itself.
    const seedLedger = await service.from('reward_ledger').insert([
      { user_id: memberUserId, kind: 'adjustment', points: 300, note: `seed ${runId}` },
      { user_id: memberUserId, kind: 'redemption', points: -300, note: `redeemed ${runId}` },
    ]);
    if (seedLedger.error) throw new Error(`ledger seed: ${seedLedger.error.message}`);
    const voucher = await service.from('reward_vouchers').insert({
      user_id: memberUserId, reward_kind: 'item_percent', percent: 40, points_spent: 300, status: 'active',
    }).select('id').single();
    if (voucher.error || !voucher.data) throw new Error(`voucher insert: ${voucher.error?.message}`);
    voucherId = voucher.data.id as string;

    // A logged invite (funnel fixture) via the service-role logger.
    const inv = await service.rpc('record_member_invite', { p_email: `mv-invitee-${runId}@example.test`, p_points: 120, p_channel: 'email' });
    if (inv.error) throw new Error(`record_member_invite: ${inv.error.message}`);
  }, 60_000);

  afterAll(async () => {
    if (!canRun) return;
    await service.from('member_invites').delete().eq('email', `mv-invitee-${runId}@example.test`);
    if (cleanupOrderIds.length) await service.from('orders').delete().in('id', cleanupOrderIds);
    if (memberCustomerId) await service.from('customers').delete().eq('id', memberCustomerId);
    if (memberUserId) await service.auth.admin.deleteUser(memberUserId); // cascades vouchers + ledger
    if (adminUserId) await service.auth.admin.deleteUser(adminUserId);
  }, 60_000);

  test('anon cannot call any Phase 2 admin function', async () => {
    expect((await anon.rpc('admin_member_vouchers', { p_status: 'all' })).error).toBeTruthy();
    expect((await anon.rpc('admin_void_voucher', { p_voucher_id: voucherId, p_reason: 'x' })).error).toBeTruthy();
    expect((await anon.rpc('admin_member_invites', { p_filter: 'all' })).error).toBeTruthy();
    expect((await anon.rpc('admin_invitable_guests', {})).error).toBeTruthy();
  });

  test('admin_member_vouchers lists the active voucher with a status summary', async () => {
    const res = await admin.rpc('admin_member_vouchers', { p_status: 'all', p_limit: 200, p_offset: 0 });
    expect(res.error).toBeNull();
    const data = res.data as { rows: Array<{ id: string; status: string; pointsSpent: number }>; summary: { active: number; outstandingPoints: number } };
    const row = data.rows.find((r) => r.id === voucherId);
    expect(row, 'seeded voucher appears').toBeTruthy();
    expect(row!.status).toBe('active');
    expect(data.summary.active).toBeGreaterThanOrEqual(1);
    expect(data.summary.outstandingPoints).toBeGreaterThanOrEqual(300);
  });

  test('admin_void_voucher voids active + appends a +300 refund (append-only), audited', async () => {
    const before = await service.from('reward_ledger').select('points').eq('user_id', memberUserId);
    const beforeBalance = (before.data ?? []).reduce((s, r) => s + (r.points as number), 0);

    const res = await admin.rpc('admin_void_voucher', { p_voucher_id: voucherId, p_refund_points: true, p_reason: 'issued in error' });
    expect(res.error).toBeNull();
    expect((res.data as { ok: boolean; refunded_points: number }).refunded_points).toBe(300);

    // Voucher flipped to void with bookkeeping.
    const v = await service.from('reward_vouchers').select('status, voided_at, void_reason').eq('id', voucherId).single();
    expect(v.data!.status).toBe('void');
    expect(v.data!.voided_at).not.toBeNull();
    expect(v.data!.void_reason).toBe('issued in error');

    // A NEW +300 adjustment row exists (never an edit of an existing row).
    const refunds = await service.from('reward_ledger').select('points, note, kind')
      .eq('user_id', memberUserId).eq('kind', 'adjustment').eq('points', 300);
    expect((refunds.data ?? []).some((r) => String(r.note).startsWith('Refund on voucher void'))).toBe(true);

    // Balance rose by exactly the refund.
    const after = await service.from('reward_ledger').select('points').eq('user_id', memberUserId);
    const afterBalance = (after.data ?? []).reduce((s, r) => s + (r.points as number), 0);
    expect(afterBalance - beforeBalance).toBe(300);

    // Audit row written.
    const audit = await service.from('audit_log').select('action').eq('action', 'reward.voucher_voided').eq('entity_id', memberUserId);
    expect((audit.data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test('admin_void_voucher refuses a non-active voucher and an empty reason', async () => {
    // Already voided above → not active.
    const again = await admin.rpc('admin_void_voucher', { p_voucher_id: voucherId, p_refund_points: false, p_reason: 'again' });
    expect(again.error).toBeTruthy();
    expect(again.error!.message).toMatch(/only active/i);

    // Empty reason rejected regardless.
    const noReason = await admin.rpc('admin_void_voucher', { p_voucher_id: voucherId, p_refund_points: false, p_reason: '   ' });
    expect(noReason.error).toBeTruthy();
    expect(noReason.error!.message).toMatch(/reason is required/i);
  });

  test('admin_member_invites returns the funnel + the logged invite', async () => {
    const res = await admin.rpc('admin_member_invites', { p_filter: 'all', p_limit: 200, p_offset: 0 });
    expect(res.error).toBeNull();
    const data = res.data as { rows: Array<{ email: string }>; summary: { sent: number; outstanding: number } };
    expect(data.rows.some((r) => r.email === `mv-invitee-${runId}@example.test`)).toBe(true);
    expect(data.summary.sent).toBeGreaterThanOrEqual(1);
  });

  test('admin_invitable_guests includes the guest and excludes the member', async () => {
    const res = await admin.rpc('admin_invitable_guests', { p_limit: 1000 });
    expect(res.error).toBeNull();
    const rows = (res.data as { rows: Array<{ contact: string; points: number }> }).rows;
    const guest = rows.find((r) => r.contact.toLowerCase() === guestEmail.toLowerCase());
    expect(guest, 'guest with banked points and no account is invitable').toBeTruthy();
    expect(guest!.points).toBe(150); // floor(15000/100)
    // The member has an account → never invitable.
    expect(rows.some((r) => r.contact.toLowerCase() === memberEmail.toLowerCase())).toBe(false);
  });
});
