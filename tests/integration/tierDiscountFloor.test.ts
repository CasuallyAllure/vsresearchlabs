/**
 * Tier-aware account-discount floor against a REAL local Postgres (migration
 * 074, layered on 045/069): effective_customer_discount(p_user_id) reads the
 * caller's customer_profiles.tier and floors at 15% for 'member', 20% for
 * 'pro'. An admin-assigned customer_discounts rule that meets or beats the
 * CALLER'S tier floor is honored verbatim; below it, the tier floor replaces
 * it. No profile row → {found:false}.
 *
 * Mocks cannot prove the parts that matter here: the SQL CASE/CTE resolution
 * over real rows, the signup trigger materializing the profile, and that the
 * function stays EXECUTE-revoked from anon/authenticated (service-role only —
 * place-order is the sole caller, unlike the admin_* RPCs which are called as
 * a signed-in admin). This suite drives it through the service-role client and
 * proves the revocation with the anon client.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for the
 * guard. NEVER point this at production — it creates and deletes auth users,
 * profiles and discount rules.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('tier discount floor suite');

interface DiscountResult {
  found: boolean;
  scope?: string;
  percent?: number;
  label?: string;
  discount_id?: string | null;
}

describe.skipIf(!canRun)('effective_customer_discount tier floor (real DB, migration 074)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let memberUserId = '';
  let proUserId = '';
  let bareUserId = ''; // auth user with NO customer_profiles row

  /** Resolve the entitlement via the service client (the only legal caller). */
  async function resolve(userId: string): Promise<DiscountResult> {
    const res = await service.rpc('effective_customer_discount', { p_user_id: userId });
    expect(res.error).toBeNull();
    return res.data as DiscountResult;
  }

  /** Replace the pro user's lifetime rule with a single active one. */
  async function setProRule(percent: number, label: string): Promise<void> {
    await service.from('customer_discounts').delete().eq('user_id', proUserId);
    const ins = await service.from('customer_discounts').insert({
      user_id: proUserId, scope: 'lifetime', percent, label, active: true,
    });
    if (ins.error) throw new Error(`discount insert failed: ${ins.error.message}`);
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // full_name in user_metadata fires the 028/043 signup trigger, which
    // materializes the customer_profiles row (tier defaults to 'member').
    async function createAccountHolder(email: string): Promise<string> {
      const created = await service.auth.admin.createUser({
        email,
        password: `pw-${runId}-Aa1!`,
        email_confirm: true,
        user_metadata: { full_name: 'Tier Floor Fixture' },
      });
      if (created.error || !created.data.user) {
        throw new Error(`createUser failed: ${created.error?.message}`);
      }
      const id = created.data.user.id;
      const profile = await service
        .from('customer_profiles')
        .select('user_id')
        .eq('user_id', id)
        .maybeSingle();
      if (profile.error || !profile.data) throw new Error('signup trigger did not create a profile');
      return id;
    }

    memberUserId = await createAccountHolder(`tier-member-${runId}@example.test`);
    proUserId = await createAccountHolder(`tier-pro-${runId}@example.test`);

    // Promote the second fixture to 'pro' — service-role direct update passes
    // the 043/049 guard trigger (auth.uid() is null for service calls).
    const up = await service
      .from('customer_profiles')
      .update({ tier: 'pro' })
      .eq('user_id', proUserId)
      .select('tier')
      .single();
    if (up.error || (up.data as { tier: string }).tier !== 'pro') {
      throw new Error(`pro promotion failed: ${up.error?.message}`);
    }

    // No full_name metadata → trigger skips → auth user with no profile row.
    const bare = await service.auth.admin.createUser({
      email: `tier-bare-${runId}@example.test`,
      password: `pw-${runId}-Aa1!`,
      email_confirm: true,
    });
    if (bare.error || !bare.data.user) throw new Error(`bare createUser failed: ${bare.error?.message}`);
    bareUserId = bare.data.user.id;
  });

  afterAll(async () => {
    // Deleting the auth users cascades customer_profiles / customer_discounts.
    for (const id of [memberUserId, proUserId, bareUserId]) {
      if (id) await service.auth.admin.deleteUser(id);
    }
  });

  test('(a) member tier with no rules gets the 15% floor', async () => {
    const result = await resolve(memberUserId);
    expect(result).toMatchObject({
      found: true,
      scope: 'lifetime',
      percent: 15,
      label: 'Account-holder 15%',
      discount_id: null,
    });
  });

  test('(b) pro tier with no rules gets the 20% floor', async () => {
    const result = await resolve(proUserId);
    expect(result).toMatchObject({
      found: true,
      scope: 'lifetime',
      percent: 20,
      label: 'Pro member 20%',
      discount_id: null,
    });
  });

  test('(c) pro with an active assigned 22% rule keeps it verbatim', async () => {
    await setProRule(22, 'Founding pro 22%');
    const result = await resolve(proUserId);
    expect(result).toMatchObject({
      found: true,
      scope: 'lifetime',
      percent: 22,
      label: 'Founding pro 22%',
    });
    expect(result.discount_id).toBeTruthy();
  });

  test('(d) pro with an assigned 10% rule is floored to 20%', async () => {
    await setProRule(10, 'Legacy 10%');
    const result = await resolve(proUserId);
    expect(result).toMatchObject({
      found: true,
      scope: 'lifetime',
      percent: 20,
      label: 'Pro member 20%',
      discount_id: null,
    });
  });

  test('(e) auth user with no profile row resolves to {found:false}', async () => {
    const result = await resolve(bareUserId);
    expect(result).toEqual({ found: false });
  });

  test('(f) anon cannot execute the function at all (revoked)', async () => {
    const res = await anon.rpc('effective_customer_discount', { p_user_id: memberUserId });
    expect(res.error).not.toBeNull();
  });
});
