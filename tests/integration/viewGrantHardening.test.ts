/**
 * View grant hardening (migration 078) against a REAL local Postgres. This is
 * the one suite that CANNOT be written with mocks: every claim here is about
 * Postgres ACLs and view execution context, which only a real server has.
 *
 * The bug it locks down: `public` carries a schema-level ALTER DEFAULT
 * PRIVILEGES granting the FULL table privilege set to anon/authenticated on
 * every new relation, so `create view … ; grant select …` silently produced
 * views that anon could WRITE through (simple views are auto-updatable) and
 * that ran as their `postgres` owner (base-table RLS bypassed for reads too).
 * Proven pre-fix against this same stack with only the anon key: an anonymous
 * POST to public_variant_overrides returned 201 and landed price_cents = 1 in
 * product_variant_stock; an anonymous GET of customer_with_history returned
 * the whole customer table.
 *
 *   • admin_audit_public_view_write_grants() returning ZERO rows is the
 *     blanket guard — it fails for ANY public view that hands
 *     INSERT/UPDATE/DELETE/TRUNCATE to anon/authenticated/PUBLIC, so a view
 *     added by a future migration re-introducing this bug fails CI here
 *     rather than in production.
 *   • both public_*_overrides views must stay anon-READABLE (the logged-out
 *     storefront catalog reads them before any auth) while anon writes are
 *     hard permission-denied.
 *   • customer_with_history is the PII surface: anon gets a hard denial (no
 *     grant at all), a plain signed-in member gets ZERO ROWS rather than an
 *     error — that is security_invoker honouring the `using (is_admin())`
 *     policy on customers, and it is the assertion that would fail if
 *     someone narrowed the grant to `authenticated` without the invoker flip
 *     — and an admin still gets data (the admin Customers page must not go
 *     dark).
 *
 * Follows memberAutomations' admin-auth fixture pattern. Requires a LOCAL
 * `supabase start` stack; see tests/integration/env.ts for the guard. NEVER
 * point this at production — it creates and deletes auth users and rows.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('view grant hardening suite');

/** Postgres insufficient_privilege — the shape a stripped grant produces. */
const PERMISSION_DENIED = '42501';

describe.skipIf(!canRun)('public view grant hardening (real DB, migration 078)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;    // signed in as an active admin
  let customer: SupabaseClient; // signed in as a plain member — proves the fence
  let adminUserId = '';
  let customerUserId = '';

  const productSku = `vgh-prod-${runId}`;
  const variantSku = `vgh-var-${runId}`;
  const customerContact = `vgh-cust-${runId}@example.test`;

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Admin fixture: is_admin() authorizes by an active admin_users row for
    // the CALLING auth user — the service key alone is not an admin.
    const adminEmail = `admin-vgh-${runId}@example.test`;
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

    // Customer fixture — a signed-in plain member. Deliberately NOT an admin.
    const customerEmail = `member-vgh-${runId}@example.test`;
    const customerPw = `Member-${runId}-Aa1!`;
    const created = await service.auth.admin.createUser({
      email: customerEmail, password: customerPw, email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    customerUserId = created.data.user.id;
    const profile = await service
      .from('customer_profiles')
      .upsert({ user_id: customerUserId, full_name: 'Grant Fence Member', tier: 'member', status: 'active' })
      .select('user_id');
    if (profile.error) throw new Error(`profile upsert failed: ${profile.error.message}`);
    customer = anonClient();
    const signIn = await customer.auth.signInWithPassword({ email: customerEmail, password: customerPw });
    if (signIn.error) throw new Error(`customer sign-in failed: ${signIn.error.message}`);

    // Real rows behind each view, so "still readable" means "returns data",
    // not merely "returned an empty array without erroring".
    const stock = await service.from('product_stock').insert({ sku: productSku, on_hand: 7, price_cents_override: 12345 });
    if (stock.error) throw new Error(`product_stock insert failed: ${stock.error.message}`);
    const variant = await service
      .from('product_variant_stock')
      .insert({ sku: variantSku, dose: '5mg', on_hand: 3, price_cents: 6789 });
    if (variant.error) throw new Error(`product_variant_stock insert failed: ${variant.error.message}`);
    const cust = await service.from('customers').insert({
      contact_key: customerContact,
      display_name: 'Grant Fence Customer',
      contact: customerContact,
    });
    if (cust.error) throw new Error(`customers insert failed: ${cust.error.message}`);
  });

  afterAll(async () => {
    await service.from('product_variant_stock').delete().eq('sku', variantSku);
    await service.from('product_stock').delete().eq('sku', productSku);
    await service.from('customers').delete().eq('contact_key', customerContact);
    if (customerUserId) {
      await service.from('customer_profiles').delete().eq('user_id', customerUserId);
      await service.auth.admin.deleteUser(customerUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  // ── The blanket guard ─────────────────────────────────────────────────────

  test('no public view grants any write privilege to anon or authenticated', async () => {
    const { data, error } = await service.rpc('admin_audit_public_view_write_grants');
    expect(error).toBeNull();
    // Named explicitly so a failure names the offending view/role/privilege
    // instead of just reporting a length mismatch.
    expect(data).toEqual([]);
  });

  test('the audit function is service-role only', async () => {
    const anonCall = await anon.rpc('admin_audit_public_view_write_grants');
    expect(anonCall.error).not.toBeNull();
    const memberCall = await customer.rpc('admin_audit_public_view_write_grants');
    expect(memberCall.error).not.toBeNull();
  });

  // ── public_product_overrides: readable by the logged-out storefront ───────

  test('anon can still READ public_product_overrides', async () => {
    const { data, error } = await anon
      .from('public_product_overrides')
      .select('sku, on_hand, price_cents_override')
      .eq('sku', productSku);
    expect(error).toBeNull();
    expect(data).toEqual([{ sku: productSku, on_hand: 7, price_cents_override: 12345 }]);
  });

  test('anon cannot INSERT through public_product_overrides', async () => {
    const { error } = await anon
      .from('public_product_overrides')
      .insert({ sku: `pwn-prod-${runId}`, on_hand: 0 });
    expect(error?.code).toBe(PERMISSION_DENIED);
    // And nothing reached the base table.
    const { data } = await service.from('product_stock').select('sku').eq('sku', `pwn-prod-${runId}`);
    expect(data).toEqual([]);
  });

  test('anon cannot UPDATE or DELETE through public_product_overrides', async () => {
    const upd = await anon.from('public_product_overrides').update({ price_cents_override: 1 }).eq('sku', productSku);
    expect(upd.error?.code).toBe(PERMISSION_DENIED);
    const del = await anon.from('public_product_overrides').delete().eq('sku', productSku);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
    // The seeded price is untouched — the writes never reached product_stock.
    const { data } = await service.from('product_stock').select('price_cents_override').eq('sku', productSku).single();
    expect(data?.price_cents_override).toBe(12345);
  });

  // ── public_variant_overrides: the view the price-rewrite exploit used ─────

  test('anon can still READ public_variant_overrides', async () => {
    const { data, error } = await anon
      .from('public_variant_overrides')
      .select('sku, dose, on_hand, price_cents')
      .eq('sku', variantSku);
    expect(error).toBeNull();
    expect(data).toEqual([{ sku: variantSku, dose: '5mg', on_hand: 3, price_cents: 6789 }]);
  });

  test('anon cannot INSERT through public_variant_overrides (the original exploit)', async () => {
    const { error } = await anon
      .from('public_variant_overrides')
      .insert({ sku: `pwn-var-${runId}`, dose: '1mg', on_hand: 0, price_cents: 1 });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await service.from('product_variant_stock').select('sku').eq('sku', `pwn-var-${runId}`);
    expect(data).toEqual([]);
  });

  test('anon cannot UPDATE or DELETE through public_variant_overrides', async () => {
    const upd = await anon.from('public_variant_overrides').update({ price_cents: 1 }).eq('sku', variantSku);
    expect(upd.error?.code).toBe(PERMISSION_DENIED);
    const del = await anon.from('public_variant_overrides').delete().eq('sku', variantSku);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
    const { data } = await service.from('product_variant_stock').select('price_cents').eq('sku', variantSku).single();
    expect(data?.price_cents).toBe(6789);
  });

  // ── customer_with_history: the PII surface ───────────────────────────────

  test('anon cannot READ customer_with_history at all', async () => {
    const { data, error } = await anon.from('customer_with_history').select('contact, display_name').limit(5);
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(data).toBeNull();
  });

  test('anon cannot WRITE customer_with_history', async () => {
    const ins = await anon.from('customer_with_history').insert({
      contact_key: `pwn-cust-${runId}@example.test`,
      display_name: 'PWN',
      contact: `pwn-cust-${runId}@example.test`,
    });
    expect(ins.error?.code).toBe(PERMISSION_DENIED);
    const upd = await anon.from('customer_with_history').update({ display_name: 'PWN' }).eq('contact_key', customerContact);
    expect(upd.error?.code).toBe(PERMISSION_DENIED);
    const del = await anon.from('customer_with_history').delete().eq('contact_key', customerContact);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
    const { data } = await service.from('customers').select('display_name').eq('contact_key', customerContact).single();
    expect(data?.display_name).toBe('Grant Fence Customer');
  });

  test('a plain signed-in member reads ZERO rows from customer_with_history', async () => {
    // Not an error: the grant to `authenticated` is real, but security_invoker
    // makes the customers `using (is_admin())` SELECT policy apply to this
    // caller. Without the invoker flip this returns every customer's PII.
    const { data, error } = await customer.from('customer_with_history').select('contact, display_name');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('an admin still reads customer_with_history', async () => {
    const { data, error } = await admin
      .from('customer_with_history')
      .select('contact, display_name, last_order_at, last_inquiry_at')
      .eq('contact_key', customerContact);
    expect(error).toBeNull();
    expect(data).toEqual([
      { contact: customerContact, display_name: 'Grant Fence Customer', last_order_at: null, last_inquiry_at: null },
    ]);
  });
});
