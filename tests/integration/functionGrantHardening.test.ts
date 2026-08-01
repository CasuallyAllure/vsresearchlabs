/**
 * Function EXECUTE grant hardening (migration 079) against a REAL local
 * Postgres — the routine-level companion to viewGrantHardening.test.ts. Like
 * that suite this cannot be written with mocks: every claim is about
 * PostgreSQL ACLs and what PostgREST will actually let an anonymous key call.
 *
 * The bug it locks down: `public` carries a schema-level ALTER DEFAULT
 * PRIVILEGES granting EXECUTE on every new FUNCTION to anon/authenticated (CI's
 * hosted-parity bootstrap spells it out), on top of PostgreSQL's own built-in
 * `EXECUTE TO PUBLIC` default for routines. Every `security definer` RPC in
 * this repo was therefore locked down only because its author remembered an
 * explicit `revoke execute` — the same per-author diligence step that was
 * forgotten five times on the three views 078 had to repair. Pre-079 the audit
 * found 70 of the 80 public routines on this branch anon/authenticated-callable,
 * including _apply_order_stock (unguarded direct writes to product_variant_stock),
 * log_audit (unguarded INSERT into audit_log) and mark_receipt_sent (its guard
 * is `auth.uid() is not null and not is_admin()`, which a NULL-uid anon caller
 * walks straight through).
 *
 * Migration 079 cannot fix this prospectively on its own: ALTER DEFAULT
 * PRIVILEGES merges with — and so can only ADD to — PostgreSQL's built-in
 * defaults, meaning the baseline `EXECUTE TO PUBLIC` for functions is not
 * removable that way (verified on PG 17.6). THIS TEST IS THE PROSPECTIVE GUARD.
 * The allowlist below is the whole point: any future migration that adds a
 * routine and forgets to revoke shows up here by name and fails CI, and any
 * deliberate addition to the browser-callable surface requires editing this
 * list on purpose.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts.
 * NEVER point this at production.
 */
import { describe, expect, test } from 'vitest';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('function grant hardening suite');

/** Postgres insufficient_privilege — the shape a stripped grant produces. */
const PERMISSION_DENIED = '42501';

/**
 * Reachable without a session BY DESIGN. Narrowing any of these breaks the
 * storefront: the three order-lookup RPCs are the token/ZIP-gated tracking
 * design (the buyer has no account), validate_coupon prices guest carts, and
 * is_admin is referenced by ~40 RLS policies whose expressions are evaluated
 * with the CALLING role's privileges — revoking it from anon would turn every
 * anon-visible table into a permission error.
 */
const ANON_CALLABLE = [
  'confirm_order_shipping',
  'get_order_by_token',
  'is_admin',
  'lookup_order',
  'validate_coupon',
];

/**
 * Signed-in surface only. The admin entries are all `if not is_admin() then
 * raise` inside the body — `authenticated` is as narrow as an ACL can express,
 * the guard is the real fence. The get_my_* / redeem_reward / link_my_orders
 * entries self-scope by auth.uid(), which is NULL for anon.
 */
const AUTHENTICATED_ONLY = [
  'adjust_stock',
  'admin_adjust_reward_points',
  'admin_apply_coupon',
  'admin_clear_coupon',
  'admin_clear_coupons',
  'admin_create_order',
  // 081 prepared carts. All three are `if not is_admin() then raise` bodies.
  // admin_create_prepared_cart mints a link token and returns the plaintext
  // ONCE; admin_prepared_carts is the ONLY read path to prepared_carts (the
  // tables carry no grants at all) and structurally omits token_hash. None of
  // the three may ever move to ANON_CALLABLE — the token is emailed to a
  // member's inbox, so an anonymous caller must not be able to mint, list or
  // kill one.
  'admin_create_prepared_cart',
  // 083 conversion. Writes a REAL ORDER against money already collected
  // off-site, stamps the cart converted and revokes its link in one
  // transaction. is_admin()-gated body; `authenticated` is as narrow as the ACL
  // gets. It must NEVER move to ANON_CALLABLE — an anonymous caller able to
  // reach it could mint orders and spend other members' prepared carts.
  'admin_convert_prepared_cart',
  'admin_deactivate_customer_discount',
  'admin_email_log',
  'admin_invitable_guests',
  'admin_log_member_invite',
  'admin_member_activity',
  'admin_member_attention',
  'admin_member_invites',
  'admin_member_referrals',
  'admin_member_roster',
  'admin_member_spend_distribution',
  'admin_member_stats',
  'admin_member_vouchers',
  'admin_prepared_carts',
  'admin_remove_coupon',
  'admin_revoke_prepared_cart',
  'admin_set_automation_kind',
  'admin_set_customer_discount',
  'admin_set_profile_flags',
  'admin_upsert_coupon',
  'admin_void_voucher',
  'cancel_order',
  // 082 prepared-cart claim. The MEMBER's own redemption, so unlike 081's three
  // admin routines it is not is_admin()-gated — its fence is `token_hash =
  // sha256($1) and user_id = auth.uid()` in the body. `authenticated` is
  // therefore load-bearing here, not merely narrow: an anon caller has no
  // auth.uid(), so an anon grant would make a leaked emailed link redeemable by
  // whoever holds it, which is the exact property the owner binding exists to
  // deny. It must NEVER move to ANON_CALLABLE.
  //
  // 082's other routine, prepared_cart_email_payload, returns a member's email
  // address and is granted to NOBODY — the send-prepared-cart edge function
  // reaches it through service_role's default grant, the same arrangement 075
  // uses for automation_candidates — so it correctly appears in neither list.
  'claim_prepared_cart',
  'clear_order_flag',
  'confirm_order_fulfilled',
  'create_order_from_inquiry',
  'delete_order',
  'get_my_order',
  'get_my_referral_code',
  'get_my_reward_summary',
  'import_inventory',
  'link_my_orders',
  'mark_order_delivered',
  'mark_order_invoiced',
  'mark_order_paid',
  'mark_product_deleted',
  'redeem_reward',
  'restore_product',
  'revert_order_status',
  'save_order_lines',
  'seed_stock_row',
  'set_b2g1_promo',
  'set_bogo_promo',
  'set_customer_notes',
  'set_customer_status',
  'set_order_shipping',
  'set_order_tracking',
  'set_product_hidden',
  'set_product_price',
  'set_product_video',
  'set_variant_hidden',
];

/**
 * Routines that exist on SOME branches but not necessarily this one, so their
 * presence must be tolerated without being required. Tolerated ≠ unaudited:
 * the grantee list is still asserted exactly if the routine is present.
 *
 *   admin_set_product_flag — arrives with migration 077 (early-access product
 *   flags). It is is_admin()-guarded and correctly scoped to `authenticated`
 *   as created, so 079 does not touch it. WHEN 077 MERGES, move this entry
 *   into AUTHENTICATED_ONLY and delete this block.
 */
const PENDING_MERGE: Record<string, string[]> = {
  admin_set_product_flag: ['authenticated'],
};

/** name -> sorted grantees. Overloads collapse onto one name, and their
 *  grantees union, so a leaked overload still changes the expected value. */
function expectedGrants(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const fn of ANON_CALLABLE) out[fn] = ['anon', 'authenticated'];
  for (const fn of AUTHENTICATED_ONLY) out[fn] = ['authenticated'];
  return out;
}

type GrantRow = { function_name: string; arguments: string; grantee: string };

async function actualGrants(): Promise<{ map: Record<string, string[]>; rows: GrantRow[] }> {
  const { data, error } = await serviceClient().rpc('admin_audit_public_function_grants');
  expect(error).toBeNull();
  const rows = (data ?? []) as GrantRow[];
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    const seen = map[row.function_name] ?? [];
    if (!seen.includes(row.grantee)) map[row.function_name] = [...seen, row.grantee].sort();
    else map[row.function_name] = seen;
  }
  return { map, rows };
}

describe.skipIf(!canRun)('public function grant hardening (real DB, migration 079)', () => {
  // ── The allowlist: the assertion that catches every future leak ───────────

  test('no public routine outside the allowlist is anon- or authenticated-callable', async () => {
    const { map } = await actualGrants();
    const allowed = { ...expectedGrants(), ...PENDING_MERGE };
    // Rendered as "name -> grantees" strings so a failure names the offending
    // routine and who can call it, not just a set-size mismatch.
    const unexpected = Object.entries(map)
      .filter(([fn, grantees]) => JSON.stringify(allowed[fn]) !== JSON.stringify(grantees))
      .map(([fn, grantees]) => `${fn} -> ${grantees.join(',')}`)
      .sort();
    expect(unexpected).toEqual([]);
  });

  test('every allowlisted routine still holds exactly the grants it needs', async () => {
    // The other direction: catches a revoke that went too far and silently
    // took the admin console, the portal or the storefront dark.
    const { map } = await actualGrants();
    const expected = expectedGrants();
    const wrong = Object.entries(expected)
      .filter(([fn, grantees]) => JSON.stringify(map[fn]) !== JSON.stringify(grantees))
      .map(([fn, grantees]) => `${fn}: expected ${grantees.join(',')} — got ${(map[fn] ?? ['<none>']).join(',')}`)
      .sort();
    expect(wrong).toEqual([]);
  });

  test('no public routine grants EXECUTE to PUBLIC', async () => {
    // PUBLIC contains anon, so a PUBLIC grant is anonymous reachability under
    // another name — and it survives a `revoke … from anon`, which makes it the
    // easy one to miss.
    const { rows } = await actualGrants();
    expect(rows.filter((r) => r.grantee === 'PUBLIC')).toEqual([]);
  });

  test('the audit function is service-role only', async () => {
    const anonCall = await anonClient().rpc('admin_audit_public_function_grants');
    expect(anonCall.error).not.toBeNull();
  });

  // ── Live behaviour: the storefront still works signed out ────────────────

  test('anon can still call the token-gated order-lookup RPCs', async () => {
    const anon = anonClient();
    const lookup = await anon.rpc('lookup_order', { p_identifier: 'VSR-000000', p_zip: '00000' });
    expect(lookup.error).toBeNull();
    const byToken = await anon.rpc('get_order_by_token', { p_token: 'not-a-real-token' });
    expect(byToken.error).toBeNull();
  });

  test('anon can still price a coupon and resolve is_admin', async () => {
    const anon = anonClient();
    const coupon = await anon.rpc('validate_coupon', { p_code: 'NOT-A-CODE', p_subtotal_cents: 1000 });
    expect(coupon.error).toBeNull();
    expect((coupon.data as { valid?: boolean } | null)?.valid).toBe(false);
    // is_admin backs ~40 RLS policies; anon must be able to evaluate it.
    const admin = await anon.rpc('is_admin');
    expect(admin.error).toBeNull();
    expect(admin.data).toBe(false);
  });

  // ── Live behaviour: the routines 079 closed are hard-denied ──────────────

  test('anon cannot call _apply_order_stock (unguarded inventory writes)', async () => {
    const { error } = await anonClient().rpc('_apply_order_stock', {
      p_sku: 'pwn', p_product_name: 'pwn', p_quantity: 1, p_deduct: false,
      p_reason: 'manual_adjustment', p_order_id: null, p_admin: null, p_notes: null,
    });
    expect(error).not.toBeNull();
  });

  test('anon cannot forge audit_log rows through log_audit', async () => {
    const { error } = await anonClient().rpc('log_audit', {
      p_action: 'pwn', p_entity_type: 'order', p_entity_id: 'x', p_summary: 'forged',
      p_before_value: null, p_after_value: null, p_context: null,
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('anon cannot stamp receipts through mark_receipt_sent', async () => {
    // Its body guard passes for a NULL-uid caller by design (the service-role
    // edge function relies on that), so the grant was the only fence.
    const { error } = await anonClient().rpc('mark_receipt_sent', {
      p_order_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('anon cannot use coupon_combinability_reason as a coupon oracle', async () => {
    const { error } = await anonClient().rpc('coupon_combinability_reason', { p_candidate: 'ANY' });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});
