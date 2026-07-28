/**
 * Member referrals (migration 076) against a REAL local Postgres.
 *
 *   • get_my_referral_code() — idempotent issue-or-fetch: two calls return the
 *     same REF- code; the issuance atomically creates the affiliates row
 *     (commission 0 — payout is reward points, not cash), the coupons row
 *     (active, percent 10, exclusive, affiliate-linked, no expiry) and the
 *     member_referral_codes mapping. Members only: an auth user WITHOUT a
 *     customer_profiles row is rejected, and anon has no execute grant.
 *   • admin_member_referrals() — is_admin()-gated (anon AND a signed-in
 *     non-admin member are rejected) and returns the issued code + summary.
 *
 * Mocks cannot prove the SECURITY DEFINER gates, the collision-safe insert or
 * the anon revocations — this suite drives the real rows. Requires a LOCAL
 * `supabase start` stack; see tests/integration/env.ts for the guard. NEVER
 * point this at production — it creates and deletes auth users, profiles,
 * affiliates and coupons.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('member referrals suite');

interface ReferralResult { code: string; percent: number; uses: number }
interface MappingRow { user_id: string; affiliate_id: string; coupon_id: string; code: string }

describe.skipIf(!canRun)('member referrals (real DB, migration 076)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let member: SupabaseClient; // signed-in member WITH a customer_profiles row
  let guest: SupabaseClient;  // signed-in auth user WITHOUT a profile row
  let admin: SupabaseClient;  // signed-in active admin
  let memberUserId = '';
  let guestUserId = '';
  let adminUserId = '';
  let issuedCode = '';
  let affiliateId = '';
  let couponId = '';
  const memberEmail = `member-ref-${runId}@example.test`;

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Admin caller — is_admin() authorizes by an active admin_users row for the
    // calling auth user (mirrors tests/integration/memberWritePaths.test.ts).
    const adminEmail = `admin-ref-${runId}@example.test`;
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

    // The member — auth user + customer_profiles row (the membership marker).
    const memberPw = `pw-${runId}-Aa1!`;
    const memberCreated = await service.auth.admin.createUser({
      email: memberEmail, password: memberPw, email_confirm: true,
    });
    if (memberCreated.error || !memberCreated.data.user) throw new Error(`member createUser failed: ${memberCreated.error?.message}`);
    memberUserId = memberCreated.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: memberUserId, full_name: 'Referral Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);
    member = anonClient();
    const memberSignIn = await member.auth.signInWithPassword({ email: memberEmail, password: memberPw });
    if (memberSignIn.error) throw new Error(`member sign-in failed: ${memberSignIn.error.message}`);

    // The guest — an auth user with NO profile row. The signup trigger
    // (028/043) may have materialized one; delete it so the gate is provable.
    const guestEmail = `guest-ref-${runId}@example.test`;
    const guestPw = `pw-g-${runId}-Aa1!`;
    const guestCreated = await service.auth.admin.createUser({
      email: guestEmail, password: guestPw, email_confirm: true,
    });
    if (guestCreated.error || !guestCreated.data.user) throw new Error(`guest createUser failed: ${guestCreated.error?.message}`);
    guestUserId = guestCreated.data.user.id;
    const del = await service.from('customer_profiles').delete().eq('user_id', guestUserId);
    if (del.error) throw new Error(`guest profile delete failed: ${del.error.message}`);
    guest = anonClient();
    const guestSignIn = await guest.auth.signInWithPassword({ email: guestEmail, password: guestPw });
    if (guestSignIn.error) throw new Error(`guest sign-in failed: ${guestSignIn.error.message}`);
  });

  afterAll(async () => {
    if (memberUserId) {
      await service.from('member_referral_codes').delete().eq('user_id', memberUserId);
      if (couponId) await service.from('coupons').delete().eq('id', couponId);
      if (affiliateId) await service.from('affiliates').delete().eq('id', affiliateId);
      await service.from('customer_profiles').delete().eq('user_id', memberUserId);
      await service.auth.admin.deleteUser(memberUserId);
    }
    if (guestUserId) await service.auth.admin.deleteUser(guestUserId);
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  // ── get_my_referral_code ──────────────────────────────────────────────────

  test('is idempotent — two calls return the same REF- code with zero uses', async () => {
    const first = await member.rpc('get_my_referral_code');
    expect(first.error).toBeNull();
    const a = first.data as ReferralResult;
    expect(a.code).toMatch(/^REF-[A-Z2-7]{6}$/);
    expect(a.percent).toBe(10);
    expect(a.uses).toBe(0);

    const second = await member.rpc('get_my_referral_code');
    expect(second.error).toBeNull();
    const b = second.data as ReferralResult;
    expect(b.code).toBe(a.code);

    issuedCode = a.code;
  });

  test('issuance created affiliate + coupon + mapping atomically', async () => {
    const mapping = await service
      .from('member_referral_codes')
      .select('user_id, affiliate_id, coupon_id, code')
      .eq('user_id', memberUserId)
      .single();
    expect(mapping.error).toBeNull();
    const row = mapping.data as MappingRow;
    expect(row.code).toBe(issuedCode);
    affiliateId = row.affiliate_id;
    couponId = row.coupon_id;

    // Coupon terms: active percent-10, affiliate-linked, exclusive (strictest
    // combinability), no expiry, commission override 0.
    const coupon = await service
      .from('coupons')
      .select('code, kind, percent, active, affiliate_id, commission_percent, exclusive, combines_with_codes, combines_with_promos, combines_with_account, expires_at')
      .eq('id', row.coupon_id)
      .single();
    expect(coupon.error).toBeNull();
    expect(coupon.data).toMatchObject({
      code: issuedCode,
      kind: 'percent',
      percent: 10,
      active: true,
      affiliate_id: row.affiliate_id,
      commission_percent: 0,
      exclusive: true,
      combines_with_codes: false,
      combines_with_promos: false,
      combines_with_account: false,
      expires_at: null,
    });

    // Affiliate: the member's identity at 0% cash commission (payout is reward
    // points via a later automation — never the 031 cash ledger).
    const affiliate = await service
      .from('affiliates')
      .select('name, contact, default_commission_percent, active')
      .eq('id', row.affiliate_id)
      .single();
    expect(affiliate.error).toBeNull();
    expect(affiliate.data).toMatchObject({
      name: 'Referral Member',
      contact: memberEmail,
      default_commission_percent: 0,
      active: true,
    });
  });

  test('an auth user without a customer_profiles row is rejected', async () => {
    const res = await guest.rpc('get_my_referral_code');
    expect(res.error).not.toBeNull();
    const none = await service
      .from('member_referral_codes')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', guestUserId);
    expect(none.count).toBe(0);
  });

  test('is revoked from anon', async () => {
    const res = await anon.rpc('get_my_referral_code');
    expect(res.error).not.toBeNull();
  });

  // ── admin_member_referrals ────────────────────────────────────────────────

  test('admin_member_referrals is rejected for anon and non-admin members', async () => {
    const anonRes = await anon.rpc('admin_member_referrals', { p_limit: 10, p_offset: 0 });
    expect(anonRes.error).not.toBeNull();

    const memberRes = await member.rpc('admin_member_referrals', { p_limit: 10, p_offset: 0 });
    expect(memberRes.error).not.toBeNull();
  });

  test('admin_member_referrals returns the issued code + summary for an admin', async () => {
    const res = await admin.rpc('admin_member_referrals', { p_limit: 200, p_offset: 0 });
    expect(res.error).toBeNull();
    const payload = res.data as {
      rows: Array<{ memberName: string | null; contact: string | null; code: string; uses: number; createdIso: string }>;
      total: number;
      summary: { codesIssued: number; totalUses: number };
    };
    const mine = payload.rows.find((r) => r.code === issuedCode);
    expect(mine).toBeTruthy();
    expect(mine).toMatchObject({ memberName: 'Referral Member', contact: memberEmail, uses: 0 });
    expect(payload.summary.codesIssued).toBeGreaterThanOrEqual(1);
    expect(payload.total).toBeGreaterThanOrEqual(1);
  });
});
