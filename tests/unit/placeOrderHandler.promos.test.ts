/**
 * Orchestration tests — place-order promos, exclusivity gates, and coupons
 * (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/placeOrderHarness)
 * and pins the money paths: the automatic wholesale/bundle/B2G1 promos, their
 * final-price exclusivity rules, coupon validation (validate_coupon), and
 * redemption (redeem_coupon) including the per-code rollback.
 */
import { describe, expect, test } from 'vitest';
import {
  BPC_PRICE_CENTS,
  BPC_SKU,
  basePayload,
  makeHarness,
  placeOrder,
  queryHas,
  withCatalog,
  type Harness,
} from '../helpers/placeOrderHarness';
import { GUEST_SHIPPING_CENTS } from '../../supabase/functions/place-order/orderShipping';
import type { OrderItemPayload } from '../../supabase/functions/place-order/orderPayload';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEMBER_JWT = 'member-session-jwt';

const RTT_SKU = 'VSR-RS-RTT-005';
const RTT_PRICE_CENTS = 24999;
const GHK_SKU = 'VSR-RS-GHK';
const GHK_PRICE_CENTS = 5999;
const SLOW_SKU = 'VSR-RS-SLW';
const SLOW_PRICE_CENTS = 2000;
const H2O_SKU = 'VSR-SUP-H2O';
const H2O_PRICE_CENTS = 1299;

/** Case of 10 at 40% off the admin price. */
const WHOLESALE_CASE_DISCOUNT = Math.round((10 * BPC_PRICE_CENTS * 40) / 100);

const BUNDLE_GROSS = RTT_PRICE_CENTS + GHK_PRICE_CENTS;
const BUNDLE_DISCOUNT = Math.round((BUNDLE_GROSS * 20) / 100);

interface TestVariantRow {
  sku: string;
  dose: string;
  price_cents: number;
  on_hand: number;
  inbound_units: number;
  lead_days: number | null;
  wholesale_eligible: boolean;
}

function variantRow(
  sku: string,
  dose: string,
  priceCents: number,
  overrides: Partial<TestVariantRow> = {},
): TestVariantRow {
  return {
    sku,
    dose,
    price_cents: priceCents,
    on_hand: 8,
    inbound_units: 0,
    lead_days: null,
    wholesale_eligible: false,
    ...overrides,
  };
}

/** Slow-ship (7–10 day) dose: no shelf or inbound stock, lead-days SLA. */
const slowRow = (): TestVariantRow =>
  variantRow(SLOW_SKU, '10mg', SLOW_PRICE_CENTS, { on_hand: 0, inbound_units: 0, lead_days: 7 });

function cartLine(
  sku: string,
  name: string,
  unitPriceCents: number,
  quantity: number,
  fast?: boolean,
): OrderItemPayload {
  return {
    product: { id: sku.toLowerCase(), name, category: 'biopeptides', sku },
    quantity,
    unitPriceCents,
    ...(fast === undefined ? {} : { fast }),
  };
}

const slowLine = (quantity = 3): OrderItemPayload =>
  cartLine(SLOW_SKU, 'Slowpeptide — 10mg', SLOW_PRICE_CENTS, quantity, false);

const bundleRows = (): TestVariantRow[] => [
  variantRow(RTT_SKU, '5mg', RTT_PRICE_CENTS),
  variantRow(GHK_SKU, '50mg', GHK_PRICE_CENTS),
];

const bundleItems = (): OrderItemPayload[] => [
  cartLine(RTT_SKU, 'Retatrutide — 5mg', RTT_PRICE_CENTS, 1, true),
  cartLine(GHK_SKU, 'GHK-Cu — 50mg', GHK_PRICE_CENTS, 1, true),
];

/** Route the price check AND the promo planner onto the same catalog rows. */
function withVariantRows(h: Harness, rows: TestVariantRow[]): Harness {
  h.db.on('product_variant_stock', 'select', { data: rows });
  h.db.on('product_stock', 'select', { data: [] });
  return h;
}

/** A verified member session whose email matches basePayload's contact. */
function asMember(h: Harness): Harness {
  h.sessions.set(MEMBER_JWT, { id: 'user-1', email: 'buyer@test.example' });
  return h;
}

function b2g1Settings(h: Harness, overrides: Record<string, unknown> = {}): void {
  h.db.on('promo_settings', 'select', {
    data: { b2g1_enabled: true, b2g1_ends_at: null, b2g1_excluded_skus: [], ...overrides },
  });
}

function redeemOk(h: Harness): void {
  h.db.onRpc('redeem_coupon', { data: { ok: true } });
}

/** Every order_coupons row inserted — promo singles and code batches flattened. */
function couponRows(h: Harness): Record<string, unknown>[] {
  return h.db.of('order_coupons', 'insert').flatMap((q) =>
    Array.isArray(q.payload)
      ? (q.payload as Record<string, unknown>[])
      : [q.payload as Record<string, unknown>],
  );
}

function orderInsert(h: Harness): Record<string, unknown> {
  return h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
}

function orderLines(h: Harness): Record<string, unknown>[] {
  return h.db.of('order_lines', 'insert')[0].payload as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Wholesale
// ---------------------------------------------------------------------------

describe('wholesale pack pricing', () => {
  test('member case of 10 gets the 40% case discount and suppresses every other promo', async () => {
    const h = asMember(
      withVariantRows(makeHarness(), [
        variantRow(BPC_SKU, '5mg', BPC_PRICE_CENTS, { wholesale_eligible: true }),
        slowRow(),
      ]),
    );
    // Everything below WOULD apply on its own — the wholesale gate kills it all.
    b2g1Settings(h);
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent: 10, label: 'Lifetime discount' },
    });
    h.db.on('reward_vouchers', 'select', { data: { id: 'voucher-1', percent: 40 } });

    const gross = 10 * BPC_PRICE_CENTS + 3 * SLOW_PRICE_CENTS;
    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [
          cartLine(BPC_SKU, 'BPC-157 — 5mg', BPC_PRICE_CENTS, 10, true),
          slowLine(),
        ],
      }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - WHOLESALE_CASE_DISCOUNT);

    // Order row: wholesale is the ONLY discount; member ships free.
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: gross,
      shipping_cents: 0,
      discount_cents: WHOLESALE_CASE_DISCOUNT,
      coupon_code: 'WHOLESALE',
      invoice_amount_cents: gross - WHOLESALE_CASE_DISCOUNT,
      user_id: 'user-1',
    });

    // Exactly one promo row — no ACCT-*, REWARD, or B2G1 rows despite all three
    // being active before the gate.
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'WHOLESALE',
      kind: 'fixed',
      amount_cents: WHOLESALE_CASE_DISCOUNT,
      discount_cents: WHOLESALE_CASE_DISCOUNT,
      free_label: 'Wholesale pack pricing — 10 vials at case rates',
      source: 'promo',
    });

    // The wholesale line's client-sent fast=true is forced to standard: a case
    // is sourced whole and never ships 24-hour.
    const lines = orderLines(h);
    expect(lines[0]).toMatchObject({ sku: BPC_SKU, quantity: 10, fast_ship: false });
    expect(lines[1]).toMatchObject({ sku: SLOW_SKU, quantity: 3, fast_ship: false });
  });

  test('a WHOLESALE order_coupons insert error is log-only — money on the order survives', async () => {
    const h = asMember(
      withVariantRows(makeHarness(), [
        variantRow(BPC_SKU, '5mg', BPC_PRICE_CENTS, { wholesale_eligible: true }),
      ]),
    );
    h.db.on(
      'order_coupons',
      'insert',
      { error: { message: 'promo row refused' } },
      (q) => (q.payload as { code?: string } | undefined)?.code === 'WHOLESALE',
    );

    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [cartLine(BPC_SKU, 'BPC-157 — 5mg', BPC_PRICE_CENTS, 10, true)] }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(10 * BPC_PRICE_CENTS - WHOLESALE_CASE_DISCOUNT);
    expect(orderInsert(h)).toMatchObject({
      discount_cents: WHOLESALE_CASE_DISCOUNT,
      coupon_code: 'WHOLESALE',
    });
    expect(h.alerts).toHaveLength(0); // deliberately log-only
    expect(h.emails).toHaveLength(2);
  });

  test('wholesale + any coupon code is a 400 and creates nothing', async () => {
    const h = asMember(
      withVariantRows(makeHarness(), [
        variantRow(BPC_SKU, '5mg', BPC_PRICE_CENTS, { wholesale_eligible: true }),
      ]),
    );
    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [cartLine(BPC_SKU, 'BPC-157 — 5mg', BPC_PRICE_CENTS, 10, true)],
        coupon_codes: ['SAVE10'],
      }),
      { bearer: MEMBER_JWT },
    );
    expect(status).toBe(400);
    expect(body.error).toBe(
      "Wholesale pricing is final and can't be combined with promo codes. Remove the code (or the wholesale items) to check out.",
    );
    expect(h.db.of('inquiries', 'insert')).toHaveLength(0);
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
    // The gate fires BEFORE any code is even validated.
    expect(h.db.rpcCalls.filter((c) => c.fn === 'validate_coupon')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

describe('bundle promo (Retatrutide + GHK-Cu)', () => {
  test('one of each bundle SKU gets 20% off the pair with a BUNDLE order_coupons row', async () => {
    const h = withVariantRows(makeHarness(), bundleRows());
    const { status, body } = await placeOrder(h, basePayload({ items: bundleItems() }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BUNDLE_GROSS - BUNDLE_DISCOUNT + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: BUNDLE_GROSS,
      discount_cents: BUNDLE_DISCOUNT,
      coupon_code: 'BUNDLE',
      invoice_amount_cents: BUNDLE_GROSS - BUNDLE_DISCOUNT + GUEST_SHIPPING_CENTS,
    });

    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'BUNDLE',
      kind: 'fixed',
      amount_cents: BUNDLE_DISCOUNT,
      discount_cents: BUNDLE_DISCOUNT,
      free_label: 'Retatrutide + GHK-Cu bundle — 20% off 1 pair',
      source: 'promo',
    });
  });

  test('two complete pairs double the discount and pluralize the free_label', async () => {
    const h = withVariantRows(makeHarness(), bundleRows());
    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [
          cartLine(RTT_SKU, 'Retatrutide — 5mg', RTT_PRICE_CENTS, 2, true),
          cartLine(GHK_SKU, 'GHK-Cu — 50mg', GHK_PRICE_CENTS, 2, true),
        ],
      }),
    );

    const gross = 2 * BUNDLE_GROSS;
    const discount = Math.round((gross * 20) / 100);
    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - discount + GUEST_SHIPPING_CENTS);
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'BUNDLE',
      amount_cents: discount,
      free_label: 'Retatrutide + GHK-Cu bundle — 20% off 2 pairs',
    });
  });

  test('a BUNDLE order_coupons insert error is log-only — money on the order survives', async () => {
    const h = withVariantRows(makeHarness(), bundleRows());
    h.db.on(
      'order_coupons',
      'insert',
      { error: { message: 'promo row refused' } },
      (q) => (q.payload as { code?: string } | undefined)?.code === 'BUNDLE',
    );
    const { status, body } = await placeOrder(h, basePayload({ items: bundleItems() }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BUNDLE_GROSS - BUNDLE_DISCOUNT + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      discount_cents: BUNDLE_DISCOUNT,
      coupon_code: 'BUNDLE',
    });
    expect(h.alerts).toHaveLength(0); // deliberately log-only
    expect(h.emails).toHaveLength(2);
  });

  test("a member's account discount is suppressed by the bundle", async () => {
    const h = asMember(withVariantRows(makeHarness(), bundleRows()));
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent: 10, label: 'Lifetime discount' },
    });
    const { status, body } = await placeOrder(h, basePayload({ items: bundleItems() }), {
      bearer: MEMBER_JWT,
    });

    expect(status).toBe(200);
    // Bundle only — no account percent stacked, member ships free.
    expect(body.amountCents).toBe(BUNDLE_GROSS - BUNDLE_DISCOUNT);
    expect(orderInsert(h)).toMatchObject({
      shipping_cents: 0,
      discount_cents: BUNDLE_DISCOUNT,
      coupon_code: 'BUNDLE',
    });
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'BUNDLE', source: 'promo' });
  });

  test('bundle + a coupon code is a 400 and creates nothing', async () => {
    const h = withVariantRows(makeHarness(), bundleRows());
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: bundleItems(), coupon_codes: ['SAVE10'] }),
    );
    expect(status).toBe(400);
    expect(body.error).toBe(
      "Bundle pricing is final and can't be combined with promo codes. Remove the code (or one of the bundle items) to check out.",
    );
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
    expect(h.db.rpcCalls.filter((c) => c.fn === 'validate_coupon')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B2G1
// ---------------------------------------------------------------------------

describe('B2G1 promo', () => {
  test('guest qty-3 slow-ship line under a live promo gets one unit free', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h);
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(2 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: 3 * SLOW_PRICE_CENTS,
      discount_cents: SLOW_PRICE_CENTS,
      coupon_code: 'B2G1',
    });

    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'B2G1',
      kind: 'fixed',
      amount_cents: SLOW_PRICE_CENTS,
      discount_cents: SLOW_PRICE_CENTS,
      free_label: 'Buy 2 Get 1 Free — 1 unit free',
      source: 'promo',
    });
  });

  test('qty 6 gets TWO units free with the pluralized free_label on row and invoice', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h);
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine(6)] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(4 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'B2G1',
      amount_cents: 2 * SLOW_PRICE_CENTS,
      free_label: 'Buy 2 Get 1 Free — 2 units free',
    });
    // The buyer invoice itemizes the same pluralized promo line.
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[0].html).toContain('B2G1');
  });

  test('a B2G1 order_coupons insert error is log-only — money on the order survives', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h);
    h.db.on(
      'order_coupons',
      'insert',
      { error: { message: 'promo row refused' } },
      (q) => (q.payload as { code?: string } | undefined)?.code === 'B2G1',
    );
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(2 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: SLOW_PRICE_CENTS, coupon_code: 'B2G1' });
    expect(h.alerts).toHaveLength(0); // deliberately log-only
    expect(h.emails).toHaveLength(2);
  });

  test('an expired b2g1_ends_at yields no discount', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h, { b2g1_ends_at: '2020-01-01T00:00:00.000Z' });
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));
    expect(status).toBe(200);
    expect(body.amountCents).toBe(3 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: null });
    expect(couponRows(h)).toHaveLength(0);
  });

  test('a sku on b2g1_excluded_skus yields no discount', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h, { b2g1_excluded_skus: [SLOW_SKU] });
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));
    expect(status).toBe(200);
    expect(body.amountCents).toBe(3 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: null });
    expect(couponRows(h)).toHaveLength(0);
  });

  test('a promo_settings read error proceeds at retail — no discount, no failure', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    h.db.on('promo_settings', 'select', { data: null, error: { message: 'read failed' } });
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(3 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: null });
    expect(couponRows(h)).toHaveLength(0);
  });

  test('guest B2G1 is unchanged — no account discount to conflict with', async () => {
    const h = withVariantRows(makeHarness(), [slowRow()]);
    b2g1Settings(h);
    const { status, body } = await placeOrder(h, basePayload({ items: [slowLine()] }));
    expect(status).toBe(200);
    expect(body.amountCents).toBe(2 * SLOW_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: SLOW_PRICE_CENTS, coupon_code: 'B2G1' });
    expect(couponRows(h)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B2G1 vs account discount exclusivity (owner policy 2026-07-22)
// ---------------------------------------------------------------------------
//
// A qty-4 slow-ship line makes the arithmetic clean: B2G1 frees exactly 1 of
// 4 units, i.e. B2G1's value is ALWAYS exactly 25% of that line's gross
// (floor(4/3) × unit = unit, and gross = 4 × unit) — so an account percent of
// 25 is an exact tie, below it B2G1 is bigger, above it the account is bigger.

describe('B2G1 vs account discount exclusivity', () => {
  function accountRpc(h: Harness, percent: number): void {
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent, label: 'Lifetime discount' },
    });
  }

  test('B2G1 bigger (10% account) — B2G1 bills, account is suppressed entirely', async () => {
    const h = asMember(withVariantRows(makeHarness(), [slowRow()]));
    b2g1Settings(h);
    accountRpc(h, 10);

    const gross = 4 * SLOW_PRICE_CENTS;
    const b2g1Value = SLOW_PRICE_CENTS; // floor(4/3) × unit = 1 free unit
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [slowLine(4)] }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - b2g1Value); // member ships free
    expect(orderInsert(h)).toMatchObject({
      discount_cents: b2g1Value,
      coupon_code: 'B2G1',
      shipping_cents: 0,
    });
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'B2G1', source: 'promo' });
  });

  test('account bigger (50% account) — account bills, B2G1 is suppressed entirely', async () => {
    const h = asMember(withVariantRows(makeHarness(), [slowRow()]));
    b2g1Settings(h);
    accountRpc(h, 50);

    const gross = 4 * SLOW_PRICE_CENTS;
    const accountValue = Math.round((gross * 50) / 100); // on the base WITHOUT B2G1
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [slowLine(4)] }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - accountValue); // member ships free
    expect(orderInsert(h)).toMatchObject({
      discount_cents: accountValue,
      coupon_code: 'ACCT-LIFETIME',
      shipping_cents: 0,
    });
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'ACCT-LIFETIME', source: 'account', percent: 50 });
  });

  test('tie (25% account, exactly matching B2G1s value) — B2G1 wins the tie', async () => {
    const h = asMember(withVariantRows(makeHarness(), [slowRow()]));
    b2g1Settings(h);
    accountRpc(h, 25);

    const gross = 4 * SLOW_PRICE_CENTS;
    const b2g1Value = SLOW_PRICE_CENTS;
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [slowLine(4)] }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - b2g1Value);
    expect(orderInsert(h)).toMatchObject({ discount_cents: b2g1Value, coupon_code: 'B2G1' });
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'B2G1', source: 'promo' });
  });

  test('a large mixed cart where the account % clearly outweighs B2G1 still yields ONLY the account row', async () => {
    // A second, non-B2G1-eligible (fast-ship) line inflates the subtotal the
    // account percent applies to, without adding anything for B2G1 to free —
    // this pins that the comparison uses the correct "as if B2G1 never fired"
    // base rather than double-counting the fast line into B2G1's value.
    const h = asMember(
      withVariantRows(makeHarness(), [slowRow(), variantRow(BPC_SKU, '5mg', BPC_PRICE_CENTS)]),
    );
    b2g1Settings(h);
    accountRpc(h, 40);

    const slowGross = 4 * SLOW_PRICE_CENTS;
    const gross = slowGross + BPC_PRICE_CENTS;
    const b2g1Value = SLOW_PRICE_CENTS;
    const accountValue = Math.round((gross * 40) / 100);
    expect(accountValue).toBeGreaterThan(b2g1Value);

    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [slowLine(4), cartLine(BPC_SKU, 'BPC-157 — 5mg', BPC_PRICE_CENTS, 1, true)],
      }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - accountValue);
    expect(orderInsert(h)).toMatchObject({ discount_cents: accountValue, coupon_code: 'ACCT-LIFETIME' });
    expect(couponRows(h)).toHaveLength(1);
  });

  test('B2G1 + account + a percent code together — account wins, B2G1 drops, the code still rides', async () => {
    // Both a B2G1 free line and an account discount are present, AND a percent
    // coupon code is applied. Unlike the other exclusivity cases (none of which
    // carry a code), this drives the B2G1-vs-account comparison with a NON-EMPTY
    // applied-code list, exercising the percent-entries filter in that block.
    const h = asMember(withVariantRows(makeHarness(), [slowRow()]));
    b2g1Settings(h);
    accountRpc(h, 50); // clearly outweighs the single B2G1 free unit
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'SAVE10', kind: 'percent', percent: 10, discount_cents: 500 },
    });
    redeemOk(h);

    const { status } = await placeOrder(
      h,
      basePayload({ items: [slowLine(4)], coupon_codes: ['SAVE10'] }),
      { bearer: MEMBER_JWT },
    );

    expect(status).toBe(200);
    const codes = couponRows(h).map((r) => r.code);
    // Account beat B2G1, so B2G1 is dropped; the account row and the percent
    // code both survive.
    expect(codes).toContain('ACCT-LIFETIME');
    expect(codes).toContain('SAVE10');
    expect(codes).not.toContain('B2G1');
  });

  test('bundle still suppresses BOTH B2G1 and account, even when B2G1 would otherwise win', async () => {
    const h = asMember(
      withVariantRows(makeHarness(), [...bundleRows(), slowRow()]),
    );
    b2g1Settings(h);
    accountRpc(h, 10); // would lose to B2G1 on its own — irrelevant, bundle kills both
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [...bundleItems(), slowLine(4)] }),
      { bearer: MEMBER_JWT },
    );
    expect(status).toBe(200);
    const gross = BUNDLE_GROSS + 4 * SLOW_PRICE_CENTS;
    // Bundle is final: neither B2G1 nor the account discount survives.
    expect(body.amountCents).toBe(gross - BUNDLE_DISCOUNT);
    expect(orderInsert(h)).toMatchObject({ discount_cents: BUNDLE_DISCOUNT, coupon_code: 'BUNDLE' });
    expect(couponRows(h)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Coupon validation
// ---------------------------------------------------------------------------

describe('coupon validation', () => {
  test('a validate_coupon rpc error is a 502 and creates nothing', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', { error: { message: 'db exploded' } });
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['SAVE10'] }));
    expect(status).toBe(502);
    expect(body.error).toBe('Could not verify the promo code. Please try again.');
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('an invalid coupon rejects with the rpc-supplied reason', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: false, reason: 'Code SAVE10 has expired.' },
    });
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['SAVE10'] }));
    expect(status).toBe(400);
    expect(body.error).toBe('Code SAVE10 has expired.');
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
  });

  test('an invalid coupon with NO rpc reason falls back to the generic per-code message', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', { data: { valid: false } });
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['SAVE10'] }));
    expect(status).toBe(400);
    expect(body.error).toBe('Code SAVE10 is not valid.');
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
  });

  test('a members-only rejection without a code echo names the submitted code', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: true, kind: 'percent', percent: 10, discount_cents: 500, requires_account: true },
    });
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['MEMBERS10'] }));
    expect(status).toBe(400);
    expect(body.error).toBe(
      'Code MEMBERS10 is for members only. Sign in to your account and try again.',
    );
  });

  test('a valid coupon without a code echo applies under the submitted code', async () => {
    const h = withCatalog(makeHarness());
    // No `code` and no `amount_cents` in the rpc echo — the submitted code and
    // a null display amount carry through to the order row and coupon row.
    h.db.onRpc('validate_coupon', { data: { valid: true, kind: 'fixed', discount_cents: 500 } });
    redeemOk(h);
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['SAVE10'] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - 500 + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 500, coupon_code: 'SAVE10' });
    const codeRows = couponRows(h).filter((r) => r.source === 'code');
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({ code: 'SAVE10', kind: 'fixed', amount_cents: null, discount_cents: 500 });
  });

  test('a percent coupon missing discount_cents and percent discounts nothing but still applies', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', { data: { valid: true, code: 'PCT', kind: 'percent' } });
    redeemOk(h);
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['PCT'] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS); // 0¢ off
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: 'PCT' });
    const codeRows = couponRows(h).filter((r) => r.source === 'code');
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({ code: 'PCT', kind: 'percent', percent: null, discount_cents: 0 });
  });

  test('a requires_account code without a session is a 400 members-only rejection', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: {
        valid: true, code: 'MEMBERS10', kind: 'percent',
        percent: 10, discount_cents: 500, requires_account: true,
      },
    });
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['MEMBERS10'] }));
    expect(status).toBe(400);
    expect(body.error).toBe(
      'Code MEMBERS10 is for members only. Sign in to your account and try again.',
    );
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
  });

  test('percent + fixed codes stack per the totals engine and the second validate call carries the context', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', (args) => {
      const code = String(args?.p_code ?? '');
      if (code === 'SAVE10') {
        return { data: { valid: true, code, kind: 'percent', percent: 10, discount_cents: 500 } };
      }
      return { data: { valid: true, code, kind: 'fixed', amount_cents: 1000, discount_cents: 1000 } };
    });
    redeemOk(h);

    const { status, body } = await placeOrder(
      h,
      basePayload({ coupon_codes: ['SAVE10', 'TENOFF'] }),
    );
    expect(status).toBe(200);

    // Fixed reduces the base first (flat 1000), then the percent's full-subtotal
    // discount is re-scaled onto the post-flat base:
    // round(500 × (4999−1000) / 4999) = 400 → discount 1400.
    const expectedDiscount = 1000 + Math.round((500 * (BPC_PRICE_CENTS - 1000)) / BPC_PRICE_CENTS);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - expectedDiscount + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      discount_cents: expectedDiscount,
      coupon_code: 'SAVE10, TENOFF',
    });

    // The SECOND code's validate call sees the first as already applied.
    const validates = h.db.rpcCalls.filter((c) => c.fn === 'validate_coupon');
    expect(validates).toHaveLength(2);
    expect(validates[1].args).toMatchObject({
      p_code: 'TENOFF',
      p_subtotal_cents: BPC_PRICE_CENTS,
      p_contact: 'buyer@test.example',
      p_has_reward: false,
      p_has_promo: false,
      p_has_account: false,
    });
    // p_applied_codes is a DEFENSIVE COPY per call, not the live admittedCodes
    // array: the handler pushes 'SAVE10' into its source array right after the
    // first call, yet the RECORDED first arg still reads as empty. An
    // arg-retaining client (telemetry, mocks) sees the codes as of each call.
    expect(validates.map((c) => c.args?.p_applied_codes)).toEqual([[], ['SAVE10']]);

    // Redemption records each code's actual contribution.
    const redeems = h.db.rpcCalls.filter((c) => c.fn === 'redeem_coupon');
    expect(redeems.map((c) => [c.args?.p_code, c.args?.p_discount_cents])).toEqual([
      ['SAVE10', 400],
      ['TENOFF', 1000],
    ]);

    // Both survive → both get order_coupons rows with source 'code'.
    const codeRows = couponRows(h).filter((r) => r.source === 'code');
    expect(codeRows).toHaveLength(2);
    expect(codeRows[0]).toMatchObject({ code: 'SAVE10', kind: 'percent', percent: 10, discount_cents: 400 });
    expect(codeRows[1]).toMatchObject({ code: 'TENOFF', kind: 'fixed', amount_cents: 1000, discount_cents: 1000 });
  });

  test('a fixed code larger than the subtotal is capped at the subtotal', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'BIGOFF', kind: 'fixed', amount_cents: 999999, discount_cents: 999999 },
    });
    redeemOk(h);
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['BIGOFF'] }));
    expect(status).toBe(200);
    // Subtotal fully discounted; shipping still rides on top.
    expect(body.amountCents).toBe(GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      discount_cents: BPC_PRICE_CENTS,
      invoice_amount_cents: GUEST_SHIPPING_CENTS,
    });
  });

  test('free_item with the item NOT in cart appends a $0 line and grows the item count', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: {
        valid: true, code: 'FREEBH2O', kind: 'free_item',
        free_sku: H2O_SKU, free_label: 'Bacteriostatic Water',
      },
    });
    redeemOk(h);
    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['FREEBH2O'] }));

    expect(status).toBe(200);
    // Nothing is discounted — the free item is a $0 line on top.
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: 'FREEBH2O' });

    const inquiry = h.db.of('inquiries', 'insert')[0].payload as Record<string, unknown>;
    expect(inquiry.item_count).toBe(2);

    const lines = orderLines(h);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      sku: H2O_SKU,
      product_name: 'Bacteriostatic Water (FREE)',
      quantity: 1,
      unit_price_cents: 0,
      item_note: 'Free with code FREEBH2O',
    });
  });

  test('free_item with a matching PRICED line in cart frees that unit instead of appending', async () => {
    const h = withVariantRows(makeHarness(), [
      variantRow(BPC_SKU, '5mg', BPC_PRICE_CENTS),
      variantRow(H2O_SKU, '10ml', H2O_PRICE_CENTS),
    ]);
    h.db.onRpc('validate_coupon', {
      data: {
        valid: true, code: 'FREEBH2O', kind: 'free_item',
        free_sku: H2O_SKU, free_label: 'Bacteriostatic Water',
      },
    });
    redeemOk(h);
    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [
          cartLine(BPC_SKU, 'BPC-157 — 5mg', BPC_PRICE_CENTS, 1, true),
          cartLine(H2O_SKU, 'Bacteriostatic Water — 10ml', H2O_PRICE_CENTS, 1, true),
        ],
        coupon_codes: ['FREEBH2O'],
      }),
    );

    expect(status).toBe(200);
    const gross = BPC_PRICE_CENTS + H2O_PRICE_CENTS;
    expect(body.amountCents).toBe(gross - H2O_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: gross,
      discount_cents: H2O_PRICE_CENTS,
      coupon_code: 'FREEBH2O',
    });

    // No appended $0 line — the existing unit was freed via the discount.
    const lines = orderLines(h);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => (l.unit_price_cents as number) > 0)).toBe(true);

    const codeRows = couponRows(h).filter((r) => r.source === 'code');
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({
      code: 'FREEBH2O',
      kind: 'free_item',
      free_sku: H2O_SKU,
      discount_cents: H2O_PRICE_CENTS,
    });
  });
});

// ---------------------------------------------------------------------------
// Coupon redemption + rollback
// ---------------------------------------------------------------------------

describe('coupon redemption rollback', () => {
  test('a failed redemption drops that code, deletes its free line, and re-persists the survivor pricing', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', (args) => {
      const code = String(args?.p_code ?? '');
      if (code === 'TENOFF') {
        return { data: { valid: true, code, kind: 'fixed', amount_cents: 500, discount_cents: 500 } };
      }
      return {
        data: {
          valid: true, code, kind: 'free_item',
          free_sku: H2O_SKU, free_label: 'Bacteriostatic Water',
        },
      };
    });
    h.db.onRpc('redeem_coupon', (args) =>
      args?.p_code === 'FREEBH2O'
        ? { data: { ok: false, reason: 'exhausted' } }
        : { data: { ok: true } },
    );

    const { status, body } = await placeOrder(
      h,
      basePayload({ coupon_codes: ['TENOFF', 'FREEBH2O'] }),
    );
    expect(status).toBe(200);
    const expectedTotal = BPC_PRICE_CENTS - 500 + GUEST_SHIPPING_CENTS;
    expect(body.amountCents).toBe(expectedTotal);

    // The order was inserted with BOTH codes, then re-priced to the survivor.
    expect(orderInsert(h)).toMatchObject({ coupon_code: 'TENOFF, FREEBH2O' });
    const updates = h.db.of('orders', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      discount_cents: 500,
      coupon_code: 'TENOFF',
      invoice_amount_cents: expectedTotal,
    });

    // The failed code's server-appended free line is deleted from order_lines…
    const deletes = h.db.of('order_lines', 'delete');
    expect(deletes).toHaveLength(1);
    expect(queryHas(deletes[0], 'eq', 'order_id', 'order-1')).toBe(true);
    expect(queryHas(deletes[0], 'eq', 'sku', H2O_SKU)).toBe(true);
    expect(queryHas(deletes[0], 'eq', 'unit_price_cents', 0)).toBe(true);
    // …and never renders on the buyer invoice.
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[0].html).not.toContain('Bacteriostatic Water');

    // Only the survivor gets an order_coupons row (source 'code'); no alert —
    // the rollback persisted cleanly.
    const codeRows = couponRows(h).filter((r) => r.source === 'code');
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0]).toMatchObject({ code: 'TENOFF', kind: 'fixed', discount_cents: 500 });
    expect(h.alerts).toHaveLength(0);
  });

  test("a failed redemption keeps the member's account discount in the rebuilt label and totals", async () => {
    const h = asMember(withCatalog(makeHarness()));
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent: 10, label: 'Lifetime discount' },
    });
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'TENOFF', kind: 'fixed', amount_cents: 500, discount_cents: 500 },
    });
    h.db.onRpc('redeem_coupon', { data: { ok: false, reason: 'race lost' } });

    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['TENOFF'] }), {
      bearer: MEMBER_JWT,
    });

    expect(status).toBe(200);
    // Flat 500 came off first, then the 10% account discount on the reduced
    // base: round((4999−500)×10%) = 450. The failed code's 500 goes back on;
    // the account's 450 must survive the reprice (member ships free).
    const accountCents = Math.round(((BPC_PRICE_CENTS - 500) * 10) / 100);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - accountCents);
    const updates = h.db.of('orders', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      discount_cents: accountCents,
      coupon_code: 'ACCT-LIFETIME',
      invoice_amount_cents: BPC_PRICE_CENTS - accountCents,
    });
  });

  test('a rollback update error raises the coupon_rollback operator alert', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'TENOFF', kind: 'fixed', amount_cents: 500, discount_cents: 500 },
    });
    h.db.onRpc('redeem_coupon', { data: { ok: false, reason: 'race lost' } });
    h.db.on('orders', 'update', { error: { message: 'db down' } });

    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['TENOFF'] }));
    expect(status).toBe(200);
    // The in-memory total dropped the failed code even though persistence failed.
    expect(body.amountCents).toBe(BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS);
    const alert = h.alerts.find((a) => a.stage === 'coupon_rollback');
    expect(alert).toBeDefined();
    expect(alert?.ctx?.failedCodes).toBe('TENOFF');
  });
});

// ---------------------------------------------------------------------------
// Legacy single-code field
// ---------------------------------------------------------------------------

describe('legacy coupon_code field', () => {
  test('a single legacy coupon_code validates and discounts through the same rpc path', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'SAVE10', kind: 'percent', percent: 10, discount_cents: 500 },
    });
    redeemOk(h);
    const { status, body } = await placeOrder(h, basePayload({ coupon_code: 'SAVE10' }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - 500 + GUEST_SHIPPING_CENTS);
    const validates = h.db.rpcCalls.filter((c) => c.fn === 'validate_coupon');
    expect(validates).toHaveLength(1);
    expect(validates[0].args).toMatchObject({ p_code: 'SAVE10' });
    expect(orderInsert(h)).toMatchObject({ discount_cents: 500, coupon_code: 'SAVE10' });
  });
});
