/**
 * Early-access admin control (migration 077) against a REAL local Postgres.
 * Mocks cannot prove the parts that matter here:
 *
 *   • product_flags is admin-only: no grant to anon at all (hard permission
 *     denied, not just empty RLS), and a plain signed-in customer is granted
 *     select but RLS narrows it to zero rows (mirrors 075's automation_settings
 *     / email_log split). Neither can write the table directly — no
 *     insert/update/delete policy exists at all.
 *   • public_product_flags is the narrow anon-readable view the storefront
 *     catalog gate actually queries — sku + early_access only.
 *   • admin_set_product_flag() — the one write path: the is_admin() gate,
 *     the upsert (first-touch insert vs. later update), the audit row (real
 *     before/after values, not placeholders), and that public_product_flags
 *     reflects the write immediately.
 *   • the whole surface is INERT with zero rows: a SKU nobody has ever
 *     toggled returns no row from public_product_flags at all, which is
 *     exactly what the client-side OR-fallback (earlyAccess.ts) treats as
 *     "flag not set" — the tag alone decides, byte-for-byte today's behavior.
 *
 * Follows memberAutomations' admin-auth fixture pattern. Each test uses its
 * own SKU (derived from the test index) and an afterEach wipes every SKU this
 * suite could have touched, so tests never depend on execution order or leak
 * state into each other.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production — it creates and deletes auth
 * users and rows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('product flags suite');

describe.skipIf(!canRun)('early-access admin control (real DB, migration 077)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;    // signed in as an active admin — the RPC caller
  let customer: SupabaseClient; // signed in as a plain member — proves the fences
  let adminUserId = '';
  let customerUserId = '';
  // Every SKU any test in this file writes, so afterEach can wipe them all —
  // tests never depend on another test's leftover row.
  const allSkus = [
    'untouched', 'write-anon', 'write-cust', 'read-admin-only', 'public-view',
    'public-view-write', 'rpc-fence', 'blank-sku', 'first-touch', 'upsert',
  ].map((tag) => `${tag}-${runId}`);

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // Admin fixture (mirrors memberAutomations: is_admin() authorizes by an
    // active admin_users row for the CALLING auth user — the service key
    // alone is not an admin).
    const adminEmail = `admin-flags-${runId}@example.test`;
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

    // Customer fixture — a signed-in plain member.
    const customerEmail = `member-flags-${runId}@example.test`;
    const customerPw = `Member-${runId}-Aa1!`;
    const created = await service.auth.admin.createUser({
      email: customerEmail, password: customerPw, email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    customerUserId = created.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: customerUserId, full_name: 'Flags Member', tier: 'member', status: 'active' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);
    customer = anonClient();
    const signIn = await customer.auth.signInWithPassword({ email: customerEmail, password: customerPw });
    if (signIn.error) throw new Error(`customer sign-in failed: ${signIn.error.message}`);
  });

  afterEach(async () => {
    await service.from('product_flags').delete().in('sku', allSkus);
    await service.from('audit_log').delete().in('entity_id', allSkus);
  });

  afterAll(async () => {
    if (customerUserId) {
      await service.from('customer_profiles').delete().eq('user_id', customerUserId);
      await service.auth.admin.deleteUser(customerUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  // ── Inert with zero rows ────────────────────────────────────────────────

  test('an untouched SKU has no row in either surface — the OR-fallback state', async () => {
    const sku = `untouched-${runId}`;
    const adminSide = await service.from('product_flags').select('sku').eq('sku', sku);
    expect(adminSide.error).toBeNull();
    expect(adminSide.data).toHaveLength(0);

    const publicSide = await anon.from('public_product_flags').select('sku, early_access').eq('sku', sku);
    expect(publicSide.error).toBeNull();
    expect(publicSide.data).toHaveLength(0);
  });

  // ── product_flags: admin-only read, no direct writes from anyone ─────────

  test('anon and a plain customer cannot write product_flags directly', async () => {
    const skuAnon = `write-anon-${runId}`;
    const skuCust = `write-cust-${runId}`;

    const anonInsert = await anon.from('product_flags').insert({ sku: skuAnon, early_access: true });
    expect(anonInsert.error).not.toBeNull();

    const customerInsert = await customer.from('product_flags').insert({ sku: skuCust, early_access: true });
    expect(customerInsert.error).not.toBeNull();

    const check = await service.from('product_flags').select('sku').in('sku', [skuAnon, skuCust]);
    expect(check.data ?? []).toHaveLength(0);
  });

  test('anon gets a hard permission error; a plain customer gets zero rows (RLS); admin reads the full row', async () => {
    const sku = `read-admin-only-${runId}`;
    // Seed one row directly via service role so there's something to try to read.
    const seed = await service.from('product_flags').insert({ sku, early_access: true, updated_by: adminUserId });
    expect(seed.error).toBeNull();

    // anon has NO grant on product_flags at all (revoke all; grant select is
    // authenticated-only) — PostgREST returns a permission-denied error, not
    // an empty result set. Either way, anon comes away with zero rows.
    const anonRead = await anon.from('product_flags').select('sku').eq('sku', sku);
    expect((anonRead.data ?? []).length).toBe(0);
    expect(anonRead.error).not.toBeNull();

    // A plain customer IS granted select (authenticated), but the
    // is_admin()-only RLS policy narrows it to zero rows, no error.
    const customerRead = await customer.from('product_flags').select('sku').eq('sku', sku);
    expect(customerRead.error).toBeNull();
    expect(customerRead.data).toHaveLength(0);

    // An admin CAN read it directly (full row incl. audit columns).
    const adminRead = await admin.from('product_flags').select('sku, early_access, updated_by').eq('sku', sku);
    expect(adminRead.error).toBeNull();
    expect(adminRead.data).toMatchObject([{ sku, early_access: true, updated_by: adminUserId }]);
  });

  // ── public_product_flags: the narrow anon-readable catalog-gate surface ──

  test('anon reads sku + early_access from public_product_flags, nothing else', async () => {
    const sku = `public-view-${runId}`;
    const seed = await service.from('product_flags').insert({ sku, early_access: true, updated_by: adminUserId });
    expect(seed.error).toBeNull();

    const res = await anon.from('public_product_flags').select('*').eq('sku', sku);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ sku, early_access: true }]);
    // No updated_by / updated_at leak through the public view.
    expect(Object.keys((res.data ?? [])[0] ?? {}).sort()).toEqual(['early_access', 'sku']);
  });

  test('anon cannot write public_product_flags (it is a view with no write grant)', async () => {
    const sku = `public-view-write-${runId}`;
    const res = await anon.from('public_product_flags').update({ early_access: true }).eq('sku', sku);
    expect(res.error).not.toBeNull();
  });

  // ── admin_set_product_flag: the one write path ────────────────────────────

  test('admin_set_product_flag is revoked from anon and from a plain customer', async () => {
    const sku = `rpc-fence-${runId}`;
    const anonRes = await anon.rpc('admin_set_product_flag', { p_sku: sku, p_early_access: true });
    expect(anonRes.error).not.toBeNull();

    const customerRes = await customer.rpc('admin_set_product_flag', { p_sku: sku, p_early_access: true });
    expect(customerRes.error).not.toBeNull();

    const check = await service.from('product_flags').select('sku').eq('sku', sku);
    expect(check.data ?? []).toHaveLength(0);
  });

  test('admin_set_product_flag rejects a blank sku', async () => {
    const res = await admin.rpc('admin_set_product_flag', { p_sku: '   ', p_early_access: true });
    expect(res.error).not.toBeNull();
  });

  test('admin first-touch insert: sets the flag, stamps updated_by, writes an audit row', async () => {
    const sku = `first-touch-${runId}`;
    const res = await admin.rpc('admin_set_product_flag', { p_sku: sku, p_early_access: true });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ sku, earlyAccess: true });

    const row = await service.from('product_flags').select('early_access, updated_by').eq('sku', sku).single();
    expect(row.error).toBeNull();
    expect((row.data as { early_access: boolean; updated_by: string }).early_access).toBe(true);
    expect((row.data as { early_access: boolean; updated_by: string }).updated_by).toBe(adminUserId);

    const audit = await service
      .from('audit_log')
      .select('action, entity_id, before_value, after_value')
      .eq('action', 'product.early_access_toggled')
      .eq('entity_id', sku)
      .order('occurred_at', { ascending: false })
      .limit(1);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    // No prior row existed — before_value.earlyAccess is genuinely null, not
    // a placeholder or a copy of the after-value.
    expect((audit.data as { before_value: unknown }[])[0].before_value).toMatchObject({ earlyAccess: null });
    expect((audit.data as { after_value: unknown }[])[0].after_value).toMatchObject({ earlyAccess: true });

    // Reflected immediately in the public view the storefront gate reads.
    const publicRow = await anon.from('public_product_flags').select('early_access').eq('sku', sku).single();
    expect(publicRow.error).toBeNull();
    expect((publicRow.data as { early_access: boolean }).early_access).toBe(true);
  });

  test('admin second write is an update (upsert), not a duplicate row, and the audit before-value is real', async () => {
    const sku = `upsert-${runId}`;

    const first = await admin.rpc('admin_set_product_flag', { p_sku: sku, p_early_access: true });
    expect(first.error).toBeNull();

    const second = await admin.rpc('admin_set_product_flag', { p_sku: sku, p_early_access: false });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ sku, earlyAccess: false });

    const rows = await service.from('product_flags').select('sku, early_access').eq('sku', sku);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1); // upsert, not a second row
    expect((rows.data as { early_access: boolean }[])[0].early_access).toBe(false);

    const audit = await service
      .from('audit_log')
      .select('before_value, after_value')
      .eq('action', 'product.early_access_toggled')
      .eq('entity_id', sku)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit.error).toBeNull();
    expect((audit.data as { before_value: { earlyAccess: boolean } }).before_value).toMatchObject({ earlyAccess: true });
    expect((audit.data as { after_value: { earlyAccess: boolean } }).after_value).toMatchObject({ earlyAccess: false });
  });
});
