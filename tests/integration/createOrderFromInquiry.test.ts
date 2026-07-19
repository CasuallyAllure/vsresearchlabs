/**
 * create_order_from_inquiry (migrations 003 → 010 → 027 → 061) against a REAL
 * local Postgres.
 *
 * 061 made the conversion fail-closed: every line must resolve a price from a
 * priced variant (longest-dose substring match) or the per-SKU override, or
 * the WHOLE conversion aborts — including the already-inserted order row.
 * That all-or-nothing rollback and the SQL dose matcher are exactly what the
 * unit tier cannot reach. Also proves the RPC's authz surface: admin-only
 * (is_admin()), revoked from anon.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { anonClient, canRun, logSkipReason, serviceClient, SUPABASE_URL, ANON_KEY } from './env';
import { createClient } from '@supabase/supabase-js';

logSkipReason('create_order_from_inquiry suite');

describe.skipIf(!canRun)('create_order_from_inquiry (real DB, migration 061)', () => {
  const runId = randomUUID().slice(0, 8);
  const PASSWORD = `Coi-Test-${runId}!`;
  const skuVariant = `COI-VAR-${runId}`; // priced via product_variant_stock
  const skuOverride = `COI-OVR-${runId}`; // priced via product_stock override
  const skuUnpriced = `COI-NIL-${runId}`; // no price anywhere → conversion aborts

  let service: SupabaseClient;
  let anon: SupabaseClient;
  let clientAdmin: SupabaseClient;
  let clientCustomer: SupabaseClient;
  let adminId = '';
  let customerId = '';
  let pricedInquiryId = '';
  let unpricedInquiryId = '';
  let createdOrderId = '';

  async function seedInquiry(
    referenceId: string,
    items: Array<{ sku: string; name: string; qty: number }>,
  ): Promise<string> {
    const inquiry = await service
      .from('inquiries')
      .insert({
        reference_id: referenceId,
        name: 'Inquiry Test Buyer',
        contact: `coi-${runId}@example.test`,
        organization: 'Integration Test Lab',
        item_count: items.length,
        ship_street: '1 Test Way', ship_city: 'Testville', ship_state: 'CA',
        ship_zip: '90210', ship_country: 'US',
      })
      .select('id')
      .single();
    if (inquiry.error || !inquiry.data) throw new Error(`Failed to seed inquiry: ${inquiry.error?.message}`);
    const inquiryId = inquiry.data.id as string;

    const inserted = await service.from('inquiry_items').insert(
      items.map((i) => ({ inquiry_id: inquiryId, sku: i.sku, product_name: i.name, quantity: i.qty })),
    );
    if (inserted.error) throw new Error(`Failed to seed inquiry_items: ${inserted.error.message}`);
    return inquiryId;
  }

  beforeAll(async () => {
    service = serviceClient();
    anon = anonClient();

    // ── Users: one admin, one plain customer ──────────────────────────────
    const [admin, customer] = await Promise.all([
      service.auth.admin.createUser({
        email: `coi-admin-${runId}@example.test`, password: PASSWORD, email_confirm: true,
      }),
      service.auth.admin.createUser({
        email: `coi-customer-${runId}@example.test`, password: PASSWORD, email_confirm: true,
      }),
    ]);
    if (admin.error || !admin.data.user) throw new Error(`Failed to create admin: ${admin.error?.message}`);
    if (customer.error || !customer.data.user) throw new Error(`Failed to create customer: ${customer.error?.message}`);
    adminId = admin.data.user.id;
    customerId = customer.data.user.id;

    const adminRow = await service
      .from('admin_users')
      .insert({ user_id: adminId, email: `coi-admin-${runId}@example.test` });
    if (adminRow.error) throw new Error(`Failed to seed admin_users: ${adminRow.error.message}`);

    const fresh = () =>
      createClient(SUPABASE_URL ?? '', ANON_KEY ?? '', {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    clientAdmin = fresh();
    clientCustomer = fresh();
    const [signAdmin, signCustomer] = await Promise.all([
      clientAdmin.auth.signInWithPassword({ email: `coi-admin-${runId}@example.test`, password: PASSWORD }),
      clientCustomer.auth.signInWithPassword({ email: `coi-customer-${runId}@example.test`, password: PASSWORD }),
    ]);
    if (signAdmin.error) throw new Error(`Admin sign-in failed: ${signAdmin.error.message}`);
    if (signCustomer.error) throw new Error(`Customer sign-in failed: ${signCustomer.error.message}`);

    // ── Pricing fixtures ──────────────────────────────────────────────────
    // Two doses whose squashed forms BOTH appear in "… — 15mg" ("5mg" is a
    // substring of "15mg") — the longest-dose rule must pick 15mg.
    const variants = await service.from('product_variant_stock').insert([
      { sku: skuVariant, dose: '5mg', price_cents: 7500 },
      { sku: skuVariant, dose: '15mg', price_cents: 9900 },
    ]);
    if (variants.error) throw new Error(`Failed to seed variants: ${variants.error.message}`);

    const override = await service
      .from('product_stock')
      .insert({ sku: skuOverride, on_hand: 0, price_cents_override: 1234 });
    if (override.error) throw new Error(`Failed to seed override: ${override.error.message}`);

    // ── Inquiries ─────────────────────────────────────────────────────────
    pricedInquiryId = await seedInquiry(`VSR-REQ-ITEST-A-${runId}`, [
      { sku: skuVariant, name: 'Test Compound — 15mg', qty: 2 },
      { sku: skuVariant, name: 'Test Compound — 5mg', qty: 1 },
      { sku: skuOverride, name: 'Override Priced Item', qty: 3 },
    ]);
    unpricedInquiryId = await seedInquiry(`VSR-REQ-ITEST-B-${runId}`, [
      { sku: skuUnpriced, name: 'Nobody Priced Me — 10mg', qty: 1 },
    ]);
  }, 30_000);

  afterAll(async () => {
    if (!canRun) return;
    if (createdOrderId) await service.from('orders').delete().eq('id', createdOrderId);
    await service.from('inquiries').delete().in(
      'id',
      [pricedInquiryId, unpricedInquiryId].filter(Boolean),
    );
    await service.from('product_variant_stock').delete().eq('sku', skuVariant);
    await service.from('product_stock').delete().in('sku', [skuVariant, skuOverride, skuUnpriced]);
    await Promise.all(
      [adminId, customerId].filter(Boolean).map((id) => service.auth.admin.deleteUser(id)),
    );
  }, 30_000);

  test('anon cannot execute create_order_from_inquiry (revoked)', async () => {
    const res = await anon.rpc('create_order_from_inquiry', { p_inquiry_id: randomUUID() });
    expect(res.error).toBeTruthy();
  });

  test('a signed-in non-admin is rejected by the is_admin() gate', async () => {
    const res = await clientCustomer.rpc('create_order_from_inquiry', {
      p_inquiry_id: pricedInquiryId,
    });
    expect(res.error).toBeTruthy();
    expect(res.error?.message).toContain('admin role required');
  });

  test('unpriced line aborts the WHOLE conversion — no order row survives', async () => {
    const res = await clientAdmin.rpc('create_order_from_inquiry', {
      p_inquiry_id: unpricedInquiryId,
    });
    expect(res.error).toBeTruthy();
    expect(res.error?.message).toContain('Cannot convert inquiry');
    expect(res.error?.message).toContain(skuUnpriced);

    // The order inserted before the failing line was rolled back with it.
    const orders = await service.from('orders').select('id').eq('inquiry_id', unpricedInquiryId);
    expect(orders.data).toEqual([]);

    // The inquiry was not consumed either.
    const inquiry = await service.from('inquiries').select('status').eq('id', unpricedInquiryId).single();
    expect(inquiry.data?.status).toBe('OPEN');
  });

  test('admin conversion prices every line (longest dose wins, override falls back)', async () => {
    const res = await clientAdmin.rpc('create_order_from_inquiry', {
      p_inquiry_id: pricedInquiryId,
    });
    expect(res.error).toBeNull();
    createdOrderId = res.data as string;
    expect(createdOrderId).toBeTruthy();

    const order = await service
      .from('orders')
      .select('order_number, status, buyer_name, buyer_contact, ship_zip, inquiry_id, created_by')
      .eq('id', createdOrderId)
      .single();
    expect(order.error).toBeNull();
    // 027 generator: VSR- + 6 chars from the ambiguity-free alphabet.
    expect(order.data?.order_number).toMatch(/^VSR-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(order.data?.status).toBe('pending_invoice');
    expect(order.data?.buyer_name).toBe('Inquiry Test Buyer');
    expect(order.data?.ship_zip).toBe('90210');
    expect(order.data?.inquiry_id).toBe(pricedInquiryId);
    expect(order.data?.created_by).toBe(adminId);

    const lines = await service
      .from('order_lines')
      .select('sku, product_name, quantity, unit_price_cents')
      .eq('order_id', createdOrderId);
    expect(lines.error).toBeNull();
    const byName = Object.fromEntries((lines.data ?? []).map((l) => [l.product_name, l]));
    // "— 15mg" matches BOTH doses as substrings; the longer dose must win.
    expect(byName['Test Compound — 15mg']).toMatchObject({ unit_price_cents: 9900, quantity: 2 });
    expect(byName['Test Compound — 5mg']).toMatchObject({ unit_price_cents: 7500, quantity: 1 });
    // No variant rows for this SKU → product_stock.price_cents_override.
    expect(byName['Override Priced Item']).toMatchObject({ unit_price_cents: 1234, quantity: 3 });

    const inquiry = await service.from('inquiries').select('status').eq('id', pricedInquiryId).single();
    expect(inquiry.data?.status).toBe('REVIEWING');
  });
});
