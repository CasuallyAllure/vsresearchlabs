/**
 * Prepared carts (migrations 081 + 082) against a REAL local Postgres.
 *
 * Mocks cannot prove any of what matters here, because every claim is about
 * PostgreSQL ACLs, RLS and what PostgREST will actually hand an unauthenticated
 * or merely-signed-in browser:
 *
 *   • THE GATE. `admin_create_prepared_cart` / `admin_revoke_prepared_cart` /
 *     `admin_prepared_carts` are is_admin()-gated SECURITY DEFINER routines
 *     granted only to `authenticated`. Both halves are proven: anon is denied
 *     at the ACL, and a plain signed-in customer — who HOLDS the grant — is
 *     denied by the body guard. The second case is the one a mock always gets
 *     wrong, and it is the realistic attacker: every member of this store is
 *     `authenticated`.
 *   • THE TABLES ARE UNREACHABLE. 081 revokes all and grants nothing back, so
 *     neither anon nor a signed-in member can select from `prepared_carts` or
 *     `prepared_cart_lines` at all. That, plus `admin_prepared_carts`'s
 *     explicit column list, is what makes "the token hash is never exposed" a
 *     structural fact rather than a promise.
 *   • THE TOKEN IS HASHED. What lands in the row is the SHA-256 of what the RPC
 *     returned — asserted against Node's own crypto, not against the database's
 *     opinion of itself.
 *   • NO MONEY IS STORED. The lines table has no price column and the RPC
 *     refuses a line carrying one, because place-order fails closed on any
 *     client-supplied price: a stored price makes the order unplaceable, not
 *     discounted.
 *
 *   • THE CLAIM IS BOUND TO ONE ACCOUNT (082). `claim_prepared_cart` matches on
 *     `token_hash = sha256($1) AND user_id = auth.uid()`, a deliberate
 *     departure from /track's bearer token: the link is emailed to an inbox, so
 *     possession must not equal authorization. A mock cannot prove this — the
 *     whole mechanism is auth.uid() inside a SECURITY DEFINER body — and it is
 *     the single most valuable property in the feature, because a forwarded
 *     mail or a shared screenshot must be worth nothing.
 *   • AND IT IS RE-OPENABLE. The cart the claim fills is device-local
 *     (localStorage), so a member who opens the mail on a phone and buys on a
 *     laptop MUST be able to open the same link twice. The RPC therefore never
 *     refuses for having been claimed before; it counts opens instead. Proven
 *     here rather than in a mock because the first-claim stamp's
 *     `coalesce(claimed_at, now())` behaviour under a concurrent second tap is
 *     a property of PostgreSQL's row locking, not of our code.
 *   • AND IT IS NOT AN ORACLE. A real token opened by the wrong member and a
 *     token that never existed must be BYTE-IDENTICAL answers. Asserted by
 *     comparing the two responses to each other, not to a literal, so the pair
 *     cannot drift apart later.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts.
 * NEVER point this at production — it creates and deletes auth users, profiles,
 * prepared carts and audit rows.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient } from './env';

logSkipReason('prepared carts suite');

const ADMIN_ONLY = /Unauthorized: admin role required/i;

interface CreatedCart { cart_id: string; token: string; expires_at: string }
interface CartSummary {
  id: string;
  status: string;
  coupon_code: string | null;
  note: string | null;
  claimed_at: string | null;
  last_claimed_at: string | null;
  claim_count: number;
  revoked_at: string | null;
  lines: Array<{ sku: string; dose: string; quantity: number }>;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe.skipIf(!canRun)('prepared carts (real DB, migration 081)', () => {
  const runId = randomUUID().slice(0, 8);
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let admin: SupabaseClient;   // signed in as an active admin — the intended caller
  let member: SupabaseClient;  // signed in as a PLAIN customer — holds the grant, fails the guard
  let stranger: SupabaseClient; // a DIFFERENT signed-in member — the leaked-link holder
  let memberUserId = '';
  let adminUserId = '';
  let strangerUserId = '';
  const createdCartIds: string[] = [];

  async function createCart(lines: unknown, coupon: string | null = null, note: string | null = null) {
    const res = await admin.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId, p_lines: lines, p_coupon_code: coupon, p_note: note,
    });
    if (!res.error && res.data) createdCartIds.push((res.data as CreatedCart).cart_id);
    return res;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // The RPCs authorize by an active admin_users row for the CALLING auth
    // user. The service-role key bypasses RLS but is not an admin user, so it
    // cannot (and must not) call them — the admin console calls them as a
    // signed-in admin, and so does this suite (mirrors memberWritePaths).
    const adminEmail = `admin-pc-${runId}@example.test`;
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

    // The member the carts are built for — and, signed in, the non-admin
    // attacker in the negative tests below.
    const memberEmail = `member-pc-${runId}@example.test`;
    const memberPw = `Member-${runId}-Aa1!`;
    const memberCreated = await service.auth.admin.createUser({
      email: memberEmail, password: memberPw, email_confirm: true,
    });
    if (memberCreated.error || !memberCreated.data.user) throw new Error(`member createUser failed: ${memberCreated.error?.message}`);
    memberUserId = memberCreated.data.user.id;
    const up = await service
      .from('customer_profiles')
      .upsert({ user_id: memberUserId, full_name: 'Prepared Cart Member', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (up.error) throw new Error(`profile upsert failed: ${up.error.message}`);

    member = anonClient();
    const memberSignIn = await member.auth.signInWithPassword({ email: memberEmail, password: memberPw });
    if (memberSignIn.error) throw new Error(`member sign-in failed: ${memberSignIn.error.message}`);

    // A SECOND ordinary member. This is the realistic holder of a leaked link:
    // signed in, entirely legitimate, and not the person the cart was built for.
    const strangerEmail = `stranger-pc-${runId}@example.test`;
    const strangerPw = `Stranger-${runId}-Aa1!`;
    const strangerCreated = await service.auth.admin.createUser({
      email: strangerEmail, password: strangerPw, email_confirm: true,
    });
    if (strangerCreated.error || !strangerCreated.data.user) throw new Error(`stranger createUser failed: ${strangerCreated.error?.message}`);
    strangerUserId = strangerCreated.data.user.id;
    const sp = await service
      .from('customer_profiles')
      .upsert({ user_id: strangerUserId, full_name: 'Someone Else', tier: 'member', status: 'active', account_type: 'individual' })
      .select('user_id');
    if (sp.error) throw new Error(`stranger profile upsert failed: ${sp.error.message}`);

    stranger = anonClient();
    const strangerSignIn = await stranger.auth.signInWithPassword({ email: strangerEmail, password: strangerPw });
    if (strangerSignIn.error) throw new Error(`stranger sign-in failed: ${strangerSignIn.error.message}`);
  });

  afterAll(async () => {
    if (memberUserId) {
      await service.from('prepared_carts').delete().eq('user_id', memberUserId);
      await service.from('audit_log').delete().eq('entity_id', memberUserId);
      await service.from('customer_profiles').delete().eq('user_id', memberUserId);
      await service.auth.admin.deleteUser(memberUserId);
    }
    if (strangerUserId) {
      await service.from('prepared_carts').delete().eq('user_id', strangerUserId);
      await service.from('audit_log').delete().eq('entity_id', strangerUserId);
      await service.from('customer_profiles').delete().eq('user_id', strangerUserId);
      await service.auth.admin.deleteUser(strangerUserId);
    }
    if (adminUserId) {
      await service.from('admin_users').delete().eq('user_id', adminUserId);
      await service.auth.admin.deleteUser(adminUserId);
    }
  });

  /* ── Creation: shape, token hashing, audit ──────────────────────────────── */

  test('admin_create_prepared_cart stores (sku, dose, quantity) lines and returns a token once', async () => {
    const res = await createCart([
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
      { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1 },
    ]);
    expect(res.error).toBeNull();

    const created = res.data as CreatedCart;
    expect(created.cart_id).toMatch(/^[0-9a-f-]{36}$/);
    // Two concatenated UUIDv4s with the dashes stripped — 019's token pattern.
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    // 14-day default expiry, as a column default.
    const days = (new Date(created.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    const lines = await service
      .from('prepared_cart_lines')
      .select('sku, dose, quantity, position')
      .eq('cart_id', created.cart_id)
      .order('position');
    expect(lines.error).toBeNull();
    expect(lines.data).toEqual([
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2, position: 0 },
      { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1, position: 1 },
    ]);
  });

  test('only the SHA-256 digest of the token is persisted — the plaintext is not in the row', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const row = await service
      .from('prepared_carts')
      .select('*')
      .eq('id', created.cart_id)
      .single();
    expect(row.error).toBeNull();

    const stored = row.data as Record<string, unknown>;
    expect(stored.token_hash).toBe(sha256Hex(created.token));
    expect(stored.token_hash).not.toBe(created.token);
    // Nothing anywhere in the row replays into a working link.
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(Object.keys(stored)).not.toContain('token');
  });

  test('the lines table stores no money at all', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const line = await service
      .from('prepared_cart_lines')
      .select('*')
      .eq('cart_id', created.cart_id)
      .limit(1)
      .single();
    expect(line.error).toBeNull();

    const priceish = Object.keys(line.data as object).filter((k) => /price|cents|amount|total|discount/i.test(k));
    expect(priceish).toEqual([]);
  });

  test('a coupon code is normalized and stored as a CODE, and the note is kept', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], '  spring20 ', '  For the Tuesday run  ');
    const created = res.data as CreatedCart;

    const row = await service
      .from('prepared_carts')
      .select('coupon_code, note, created_by, claimed_at, revoked_at')
      .eq('id', created.cart_id)
      .single();
    expect(row.data).toMatchObject({
      coupon_code: 'SPRING20',
      note: 'For the Tuesday run',
      created_by: adminUserId,
      claimed_at: null,
      revoked_at: null,
    });
  });

  test('blank coupon and note collapse to null rather than empty strings', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], '   ', '   ');
    const created = res.data as CreatedCart;

    const row = await service.from('prepared_carts').select('coupon_code, note').eq('id', created.cart_id).single();
    expect(row.data).toMatchObject({ coupon_code: null, note: null });
  });

  test('the same (sku, dose) twice in one payload sums instead of creating two lines', async () => {
    const res = await createCart([
      { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 2 },
      { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 3 },
    ]);
    const created = res.data as CreatedCart;

    const lines = await service.from('prepared_cart_lines').select('sku, dose, quantity').eq('cart_id', created.cart_id);
    expect(lines.data).toEqual([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 5 }]);
  });

  test('a single-config line stores dose as the empty string, never null', async () => {
    const res = await createCart([{ sku: 'VSR-LE-MIX', quantity: 1 }]);
    const created = res.data as CreatedCart;

    const line = await service.from('prepared_cart_lines').select('dose').eq('cart_id', created.cart_id).single();
    expect(line.data).toEqual({ dose: '' });
  });

  test('creation writes an audit_log row naming the member', async () => {
    const res = await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }], 'SPRING20');
    const created = res.data as CreatedCart;

    const audit = await service
      .from('audit_log')
      .select('action, entity_type, entity_id, actor_id, after_value')
      .eq('action', 'member.prepared_cart.created')
      .eq('entity_id', memberUserId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit.error).toBeNull();
    expect(audit.data).toMatchObject({ entity_type: 'customer', actor_id: adminUserId });
    expect((audit.data as { after_value: Record<string, unknown> }).after_value).toMatchObject({
      cart_id: created.cart_id, lines: 1, coupon_code: 'SPRING20',
    });
  });

  /* ── Creation: what it refuses ──────────────────────────────────────────── */

  test('an empty line array is refused', async () => {
    expect((await createCart([])).error?.message).toMatch(/at least one line/i);
  });

  test('a null line payload is refused', async () => {
    expect((await createCart(null)).error?.message).toMatch(/at least one line/i);
  });

  test('a non-array line payload is refused', async () => {
    expect((await createCart({ sku: 'VSR-RS-BPC', quantity: 1 })).error?.message).toMatch(/at least one line/i);
  });

  test('a line missing a sku is refused', async () => {
    expect((await createCart([{ dose: '5mg', quantity: 1 }])).error?.message).toMatch(/missing a sku/i);
  });

  test('a non-positive quantity is refused', async () => {
    expect((await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 0 }])).error?.message)
      .toMatch(/quantity above zero/i);
  });

  test('a non-numeric quantity is refused', async () => {
    expect((await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 'lots' }])).error).not.toBeNull();
  });

  test.each([
    ['unit_price_cents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, unit_price_cents: 1 }],
    ['unitPriceCents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, unitPriceCents: 1 }],
    ['price_cents', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, price_cents: 1 }],
    ['price', { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1, price: 1 }],
  ])('a line carrying %s is refused — a prepared cart is a list, not a quote', async (_key, line) => {
    // A baked-in price does not discount the order, it makes place-order refuse
    // it (409, fail-closed). A bespoke price must travel as a coupon code.
    expect((await createCart([line])).error?.message).toMatch(/must not carry a price/i);
  });

  test('a member id that is not a real auth user is refused by the FK', async () => {
    const res = await admin.rpc('admin_create_prepared_cart', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error).not.toBeNull();
  });

  /* ── Revocation ─────────────────────────────────────────────────────────── */

  test('admin_revoke_prepared_cart stamps revoked_at, and revoking twice is a calm no-op', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const first = await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ ok: true });

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).not.toBeNull();

    const second = await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ok: false, reason: 'not_found_or_already_revoked' });
  });

  test('revoking an unknown id reports not-found instead of raising', async () => {
    const res = await admin.rpc('admin_revoke_prepared_cart', { p_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'not_found_or_already_revoked' });
  });

  /* ── The admin read surface ─────────────────────────────────────────────── */

  test('admin_prepared_carts lists the member\'s carts with derived status and never leaks the hash', async () => {
    const live = (await createCart([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 }], 'SPRING20')).data as CreatedCart;
    const dead = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await admin.rpc('admin_revoke_prepared_cart', { p_id: dead.cart_id });

    const res = await admin.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 100 });
    expect(res.error).toBeNull();

    const rows = (res.data as { rows: CartSummary[] }).rows;
    const liveRow = rows.find((r) => r.id === live.cart_id);
    expect(liveRow).toMatchObject({ status: 'live', coupon_code: 'SPRING20' });
    expect(liveRow?.lines).toEqual([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 }]);
    expect(rows.find((r) => r.id === dead.cart_id)?.status).toBe('revoked');

    // The structural guarantee: the read surface has no hash column at all, and
    // no plaintext token can be reconstructed from what it returns.
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain(live.token);
    expect(Object.keys(liveRow as object)).not.toContain('token_hash');
  });

  test('admin_prepared_carts returns an empty list for a member with no carts', async () => {
    const res = await admin.rpc('admin_prepared_carts', { p_user_id: adminUserId, p_limit: 10 });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ rows: [] });
  });

  /* ── The gate: anon ─────────────────────────────────────────────────────── */

  test('anon cannot create a prepared cart', async () => {
    const res = await anon.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId,
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();
  });

  test('anon cannot read a prepared cart', async () => {
    expect((await anon.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 10 })).error).not.toBeNull();
    expect((await anon.from('prepared_carts').select('id')).error).not.toBeNull();
    expect((await anon.from('prepared_cart_lines').select('sku')).error).not.toBeNull();
  });

  test('anon cannot revoke a prepared cart', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    expect((await anon.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id })).error).not.toBeNull();

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).toBeNull();
  });

  test('anon cannot write to either table directly', async () => {
    expect((await anon.from('prepared_carts').insert({ user_id: memberUserId, token_hash: 'pwn' })).error).not.toBeNull();
    expect((await anon.from('prepared_carts').update({ revoked_at: null }).eq('user_id', memberUserId)).error).not.toBeNull();
    expect((await anon.from('prepared_carts').delete().eq('user_id', memberUserId)).error).not.toBeNull();
  });

  /* ── The gate: a PLAIN signed-in customer ───────────────────────────────── */
  // The realistic attacker. Every member of this store is `authenticated`, so
  // they HOLD the EXECUTE grant — only the is_admin() body guard stops them.

  test('a signed-in non-admin cannot create a prepared cart — not even their own', async () => {
    const res = await member.rpc('admin_create_prepared_cart', {
      p_user_id: memberUserId,
      p_lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
      p_coupon_code: null, p_note: null,
    });
    expect(res.error?.message).toMatch(ADMIN_ONLY);
  });

  test('a signed-in non-admin cannot read prepared carts — not through the RPC', async () => {
    const res = await member.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 10 });
    expect(res.error?.message).toMatch(ADMIN_ONLY);
  });

  test('a signed-in non-admin cannot read prepared carts — not through PostgREST either', async () => {
    // No table grant at all, so this is a hard permission error rather than an
    // RLS-filtered empty result: the row's existence is not even observable.
    const carts = await member.from('prepared_carts').select('id, token_hash');
    expect(carts.error).not.toBeNull();
    expect(carts.data).toBeNull();

    const lines = await member.from('prepared_cart_lines').select('sku, dose, quantity');
    expect(lines.error).not.toBeNull();
    expect(lines.data).toBeNull();
  });

  test('a signed-in non-admin cannot revoke a prepared cart', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const res = await member.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    expect(res.error?.message).toMatch(ADMIN_ONLY);

    const row = await service.from('prepared_carts').select('revoked_at').eq('id', created.cart_id).single();
    expect((row.data as { revoked_at: string | null }).revoked_at).toBeNull();
  });

  test('a signed-in non-admin cannot write to either table directly', async () => {
    expect((await member.from('prepared_carts').insert({ user_id: memberUserId, token_hash: 'pwn' })).error).not.toBeNull();
    expect((await member.from('prepared_carts').update({ expires_at: '2099-01-01' }).eq('user_id', memberUserId)).error).not.toBeNull();
    expect((await member.from('prepared_cart_lines').update({ quantity: 999 }).eq('sku', 'VSR-RS-BPC')).error).not.toBeNull();
    expect((await member.from('prepared_carts').delete().eq('user_id', memberUserId)).error).not.toBeNull();
  });

  test('the token hash is never reachable by any browser role', async () => {
    // Belt and braces over the individual cases above: the one column that
    // would turn a table leak into a working link is unreachable three ways.
    expect(createdCartIds.length).toBeGreaterThan(0);
    for (const client of [anon, member]) {
      const res = await client.from('prepared_carts').select('token_hash').eq('id', createdCartIds[0]);
      expect(res.error).not.toBeNull();
      expect(res.data).toBeNull();
    }
  });
  /* ── The claim (082) ────────────────────────────────────────────────────── */
  // The member-facing half. Not is_admin()-gated — its fence is the (digest,
  // auth.uid()) pair inside the body, which is exactly why it can only be
  // proven here.

  interface ClaimOk {
    ok: true;
    cart_id: string;
    coupon_code: string | null;
    note: string | null;
    expires_at: string;
    first_claim: boolean;
    lines: Array<{ sku: string; dose: string; quantity: number }>;
  }
  type ClaimFail = { ok: false; reason: string };

  const claimAs = (client: SupabaseClient, token: string) =>
    client.rpc('claim_prepared_cart', { p_token: token });

  test('the member claims their own cart and gets back properly DOSED lines', async () => {
    const created = (await createCart(
      [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: 'VSR-LE-MIX', quantity: 1 },
      ],
      'SPRING20',
      'For the Tuesday run',
    )).data as CreatedCart;

    const res = await claimAs(member, created.token);
    expect(res.error).toBeNull();

    const claim = res.data as ClaimOk;
    expect(claim.ok).toBe(true);
    expect(claim.cart_id).toBe(created.cart_id);
    expect(claim.coupon_code).toBe('SPRING20');
    expect(claim.note).toBe('For the Tuesday run');
    // THE DOSE SURVIVES THE ROUND TRIP. Without it the client cannot call
    // variantProduct(product, dose), the per-(sku,dose) price lookup misses,
    // and the order line is written at $0 — that shipped once.
    expect(claim.lines).toEqual([
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
      // '' NOT null for a single-config item, so the client can never mistake
      // "no dose needed" for "dose unknown".
      { sku: 'VSR-LE-MIX', dose: '', quantity: 1 },
    ]);
    expect(claim.lines.every((l) => typeof l.dose === 'string')).toBe(true);
    expect(claim.first_claim).toBe(true);
  });

  test('a successful claim stamps claimed_at and counts the open', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);

    const row = await service
      .from('prepared_carts')
      .select('claimed_at, last_claimed_at, claim_count')
      .eq('id', created.cart_id)
      .single();
    const stamps = row.data as { claimed_at: string | null; last_claimed_at: string | null; claim_count: number };
    expect(stamps.claimed_at).not.toBeNull();
    expect(stamps.last_claimed_at).not.toBeNull();
    expect(stamps.claim_count).toBe(1);
  });

  test('the claim response carries no price, and no token or hash', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    const res = await claimAs(member, created.token);

    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toMatch(/price|cents|amount/i);
  });

  test('claiming writes an audit row, so a used link is traceable', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);

    const audit = await service
      .from('audit_log')
      .select('action, entity_id, after_value')
      .eq('action', 'member.prepared_cart.claimed')
      .eq('entity_id', memberUserId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();
    expect(audit.error).toBeNull();
    expect((audit.data as { after_value: Record<string, unknown> }).after_value)
      .toMatchObject({ cart_id: created.cart_id });
  });

  /* ── Possession is NOT authorization ────────────────────────────────────── */

  test('a VALID token opened by the WRONG signed-in member fails', async () => {
    // The leaked-link case: a forwarded email, a shared screenshot, a mailbox
    // someone else can read. The token is genuine and unspent; it is still
    // worth nothing to anybody but its owner.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const res = await claimAs(stranger, created.token);
    expect(res.error).toBeNull();
    expect((res.data as ClaimFail).ok).toBe(false);
  });

  test('a wrong-user token is INDISTINGUISHABLE from a token that never existed', async () => {
    // The no-oracle property, asserted by comparing the two answers to EACH
    // OTHER rather than to a literal — so they cannot drift apart later.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const wrongUser = await claimAs(stranger, created.token);
    const neverExisted = await claimAs(stranger, 'f'.repeat(64));

    expect(wrongUser.error).toBeNull();
    expect(neverExisted.error).toBeNull();
    expect(wrongUser.data).toEqual(neverExisted.data);
    expect(wrongUser.data).toEqual({ ok: false, reason: 'not_found' });
  });

  test('a wrong-user attempt does not spend the link — the owner can still claim it', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    await claimAs(stranger, created.token);
    const owner = await claimAs(member, created.token);
    expect((owner.data as ClaimOk).ok).toBe(true);
  });

  test('an EXPIRED cart opened by the wrong member still says not_found, never "expired"', async () => {
    // The state of someone else's cart is not observable. Only the rightful
    // owner is told why their own link stopped working.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await service.from('prepared_carts').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', created.cart_id);

    expect((await claimAs(stranger, created.token)).data).toEqual({ ok: false, reason: 'not_found' });
    expect((await claimAs(member, created.token)).data).toEqual({ ok: false, reason: 'expired' });
  });

  test('a REVOKED cart opened by the wrong member still says not_found', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });

    expect((await claimAs(stranger, created.token)).data).toEqual({ ok: false, reason: 'not_found' });
  });

  /* ── The other refusals, all in the same shape ──────────────────────────── */

  test.each([
    ['an empty token', ''],
    ['a garbage token', 'not-a-real-token'],
    ['a token of the right shape that was never minted', 'e'.repeat(64)],
  ])('%s is refused in the SAME shape as every other miss', async (_label, token) => {
    const res = await claimAs(member, token);
    // Never a raise: a thrown error is itself a signal, rendered by PostgREST
    // as a different status and body. That is the oracle 041's convention
    // exists to avoid.
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'not_found' });
  });

  test('an expired cart is refused, and the owner is told which', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await service.from('prepared_carts').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', created.cart_id);

    const res = await claimAs(member, created.token);
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'expired' });

    // Refused means refused: nothing was stamped.
    const row = await service.from('prepared_carts').select('claimed_at').eq('id', created.cart_id).single();
    expect((row.data as { claimed_at: string | null }).claimed_at).toBeNull();
  });

  test('a revoked cart is refused — the kill switch reaches the member half', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });

    const res = await claimAs(member, created.token);
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'revoked' });
  });

  test('revocation beats expiry when a cart is both', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });
    await service.from('prepared_carts').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', created.cart_id);

    expect((await claimAs(member, created.token)).data).toEqual({ ok: false, reason: 'revoked' });
  });

  /* ── Opening it more than once ──────────────────────────────────────────── */
  // THE CART IS DEVICE-LOCAL. src/hooks/useCart.ts persists into localStorage,
  // so a member who opens the mail on a phone and buys on a laptop is doing the
  // normal thing, not an edge case. A single-use link would strand them on the
  // laptop looking at an empty cart — indistinguishable from the broken link
  // this workstream exists to fix.

  test('the SAME link opens again and returns the SAME cart, never a refusal', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }])).data as CreatedCart;

    const first = (await claimAs(member, created.token)).data as ClaimOk;
    const second = (await claimAs(member, created.token)).data as ClaimOk;

    expect(second.ok).toBe(true);
    // Byte-identical apart from the first_claim flag: the same list every time
    // is what lets the client SET quantities and converge instead of compound.
    expect(second.lines).toEqual(first.lines);
    expect(second.cart_id).toBe(first.cart_id);
    expect(second.coupon_code).toBe(first.coupon_code);
  });

  test('first_claim is true only the first time — the rest are re-opens', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    expect(((await claimAs(member, created.token)).data as ClaimOk).first_claim).toBe(true);
    expect(((await claimAs(member, created.token)).data as ClaimOk).first_claim).toBe(false);
    expect(((await claimAs(member, created.token)).data as ClaimOk).first_claim).toBe(false);
  });

  test('re-opening counts the opens and moves last_claimed_at, but NEVER moves claimed_at', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const read = async () => {
      const row = await service
        .from('prepared_carts')
        .select('claimed_at, last_claimed_at, claim_count')
        .eq('id', created.cart_id)
        .single();
      return row.data as { claimed_at: string; last_claimed_at: string; claim_count: number };
    };

    await claimAs(member, created.token);
    const afterFirst = await read();

    await claimAs(member, created.token);
    const afterSecond = await read();

    // claimed_at is the FIRST open, preserved by coalesce(claimed_at, now()).
    expect(afterSecond.claimed_at).toBe(afterFirst.claimed_at);
    expect(afterSecond.claim_count).toBe(2);
    expect(new Date(afterSecond.last_claimed_at).getTime())
      .toBeGreaterThanOrEqual(new Date(afterFirst.last_claimed_at).getTime());
  });

  test('re-opening writes only ONE audit row — the first open is the signal', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    await claimAs(member, created.token);
    await claimAs(member, created.token);
    await claimAs(member, created.token);

    const audit = await service
      .from('audit_log')
      .select('id', { count: 'exact' })
      .eq('action', 'member.prepared_cart.claimed')
      .contains('after_value', { cart_id: created.cart_id });
    expect(audit.data).toHaveLength(1);
  });

  test('an expired link stops opening even though it was opened before', async () => {
    // Re-openable is bounded by the two things that DO end a link.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);
    await service.from('prepared_carts').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', created.cart_id);

    expect((await claimAs(member, created.token)).data).toEqual({ ok: false, reason: 'expired' });
  });

  test('a revoked link stops opening even though it was opened before', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);
    await admin.rpc('admin_revoke_prepared_cart', { p_id: created.cart_id });

    expect((await claimAs(member, created.token)).data).toEqual({ ok: false, reason: 'revoked' });
  });

  test('two simultaneous claims both succeed but write only ONE first-claim stamp', async () => {
    // Neither tap may be refused — but `coalesce(claimed_at, now())` under the
    // row lock a single UPDATE takes means the second re-reads the committed row
    // and preserves the first claim's timestamp rather than overwriting it.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const [a, b] = await Promise.all([
      claimAs(member, created.token),
      claimAs(member, created.token),
    ]);
    expect([a, b].every((r) => (r.data as ClaimOk | ClaimFail).ok === true)).toBe(true);
    // Exactly one of the pair is the first claim; the other is a re-open.
    expect([a, b].filter((r) => (r.data as ClaimOk).first_claim === true)).toHaveLength(1);

    const read = async () => {
      const row = await service
        .from('prepared_carts')
        .select('claimed_at, claim_count')
        .eq('id', created.cart_id)
        .single();
      return row.data as { claimed_at: string; claim_count: number };
    };
    const afterPair = await read();
    expect(afterPair.claim_count).toBe(2);
    expect(afterPair.claimed_at).not.toBeNull();

    // And no later open overwrites it either.
    await claimAs(member, created.token);
    const afterThird = await read();
    expect(afterThird.claimed_at).toBe(afterPair.claimed_at);
    expect(afterThird.claim_count).toBe(3);
  });

  test('an opened cart still reads as LIVE on the admin surface, with an open count', async () => {
    // 081 derived status 'claimed' the moment claimed_at was set. That would now
    // tell the owner a perfectly live link was spent, so 082 replaces the
    // function: status answers openability, opens are a count beside it.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);
    await claimAs(member, created.token);

    const res = await admin.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 100 });
    const row = (res.data as { rows: CartSummary[] }).rows.find((r) => r.id === created.cart_id);
    expect(row?.status).toBe('live');
    expect(row?.claim_count).toBe(2);
    expect(row?.last_claimed_at).not.toBeNull();
  });

  test('the admin surface still never leaks the hash after the status rewrite', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);

    const res = await admin.rpc('admin_prepared_carts', { p_user_id: memberUserId, p_limit: 100 });
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain(created.token);
  });

  /* ── The claim's own gate ───────────────────────────────────────────────── */

  test('anon cannot call claim_prepared_cart at all', async () => {
    // The ACL is load-bearing here in a way it is not for 081's admin RPCs: an
    // anon caller has no auth.uid(), so an anon grant would turn a leaked link
    // into a redeemable one for whoever holds it.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const res = await anon.rpc('claim_prepared_cart', { p_token: created.token });
    expect(res.error).not.toBeNull();
    expect(res.data).toBeNull();

    const row = await service.from('prepared_carts').select('claimed_at').eq('id', created.cart_id).single();
    expect((row.data as { claimed_at: string | null }).claimed_at).toBeNull();
  });

  test('claiming does not open any read path to the tables themselves', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await claimAs(member, created.token);

    // Still no grant, even on a cart the caller has legitimately claimed.
    expect((await member.from('prepared_carts').select('token_hash').eq('id', created.cart_id)).error).not.toBeNull();
    expect((await member.from('prepared_cart_lines').select('sku')).error).not.toBeNull();
  });

  /* ── The email payload RPC (082) ────────────────────────────────────────── */

  test('prepared_cart_email_payload is unreachable from every browser role', async () => {
    // It returns a member's EMAIL ADDRESS. service_role reaches it through its
    // default grant; nobody else has one.
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    const args = { p_cart_id: created.cart_id, p_token: created.token };

    for (const client of [anon, member, admin]) {
      const res = await client.rpc('prepared_cart_email_payload', args);
      expect(res.error).not.toBeNull();
      expect(res.data).toBeNull();
    }
  });

  test('prepared_cart_email_payload gives the edge function the recipient, the lines and a token check', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }], 'SPRING20')).data as CreatedCart;

    const res = await service.rpc('prepared_cart_email_payload', {
      p_cart_id: created.cart_id, p_token: created.token,
    });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({
      ok: true,
      user_id: memberUserId,
      marketing_opt_out: false,
      coupon_code: 'SPRING20',
      revoked: false,
      expired: false,
      token_ok: true,
      lines: [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }],
    });
    expect((res.data as { recipient: string }).recipient).toMatch(/member-pc-/);
  });

  test('a token that does not match reports token_ok:false rather than a working payload', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;

    const res = await service.rpc('prepared_cart_email_payload', {
      p_cart_id: created.cart_id, p_token: 'd'.repeat(64),
    });
    expect(res.data).toMatchObject({ ok: true, token_ok: false });
  });

  test('the payload reports a member’s marketing opt-out so the send can be suppressed', async () => {
    const created = (await createCart([{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }])).data as CreatedCart;
    await service.from('customer_profiles').update({ marketing_opt_out: true }).eq('user_id', memberUserId);

    const res = await service.rpc('prepared_cart_email_payload', {
      p_cart_id: created.cart_id, p_token: created.token,
    });
    expect(res.data).toMatchObject({ marketing_opt_out: true });

    await service.from('customer_profiles').update({ marketing_opt_out: false }).eq('user_id', memberUserId);
  });

  test('an unknown cart id reports not_found rather than raising', async () => {
    const res = await service.rpc('prepared_cart_email_payload', {
      p_cart_id: '00000000-0000-0000-0000-000000000000', p_token: 'd'.repeat(64),
    });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, reason: 'not_found' });
  });
});
