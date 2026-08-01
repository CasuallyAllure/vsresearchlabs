/**
 * Orchestration tests — LAUNCH DAY BOGO through the REAL place-order handler.
 *
 * Scope: only what needs the FULL HANDLER. The pairing kernel, client/server
 * parity, the promo window/timezone boundary, the exclusion list and the
 * BOGO-vs-B2G1 arbitration are already pinned by bogoParity.test.ts and
 * bogoWindow.test.ts — none of that is repeated here.
 *
 * What only the handler can answer:
 *   • what gets PERSISTED (invoice_amount_cents — the figure reward points
 *     accrue from, migration 044/053), and the order_coupons row
 *   • the member gate as it resolves from a VERIFIED JWT, not a payload flag
 *   • larger-wins against the account % (effective_customer_discount RPC) and
 *     against coupon CODES (arbitrated pre-admission, against validate_coupon)
 *   • the advisory expected_bogo_cents notice path
 *
 * The money fixture is deliberately trivial so every assertion is exact integer
 * cents: four 24-hour units of one $100 dose. BOGO frees two of them, so BOGO
 * is worth exactly 50% of that cart — which makes a 50% account discount an
 * EXACT tie, anything below it a BOGO win, anything above it an account win.
 */
import { describe, expect, test } from 'vitest';
import {
  basePayload,
  makeHarness,
  placeOrder,
  type Harness,
} from '../helpers/placeOrderHarness';
import { GUEST_SHIPPING_CENTS } from '../../supabase/functions/place-order/orderShipping';
import type { OrderItemPayload } from '../../supabase/functions/place-order/orderPayload';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEMBER_JWT = 'member-session-jwt';

/** A 24-hour (on-hand) dose at a clean price — the BOGO workhorse. */
const FAST_SKU = 'VSR-RS-FST';
const FAST_DOSE = '5mg';
const FAST_PRICE_CENTS = 10_000;

/** Four units: BOGO frees two (indices 1 and 3 of the price-sorted units). */
const BOGO_QTY = 4;
const BOGO_GROSS = BOGO_QTY * FAST_PRICE_CENTS; // 40,000
const BOGO_VALUE = 2 * FAST_PRICE_CENTS; //        20,000 — exactly 50% of gross
const BOGO_FREE_UNITS = 2;

/** A sourced (7–10 day) dose sold by the case — never 24-hour, never BOGO. */
const WSL_SKU = 'VSR-RS-WSL';
const WSL_PRICE_CENTS = 5_000;
const WSL_QTY = 10;
const WSL_DISCOUNT = Math.round((WSL_QTY * WSL_PRICE_CENTS * 40) / 100); // 20,000

/** Bundle SKUs (authoritative in handler BUNDLE_PROMO). Prices are set per test
 *  so the bundle's 20%-of-the-pair can be tuned above, below, or exactly onto
 *  BOGO's "cheaper unit of the pair is free". */
const RTT_SKU = 'VSR-RS-RTT-005';
const GHK_SKU = 'VSR-RS-GHK';

interface TestVariantRow {
  sku: string;
  dose: string;
  price_cents: number;
  on_hand: number;
  inbound_units: number;
  lead_days: number | null;
  wholesale_eligible: boolean;
}

/** 24-hour by default (on_hand > 0) — the BOGO eligibility gate. */
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

const fastRow = (): TestVariantRow => variantRow(FAST_SKU, FAST_DOSE, FAST_PRICE_CENTS);

/** Sourced case stock: no shelf, no inbound, lead-days SLA, case-sellable. */
const wholesaleRow = (): TestVariantRow =>
  variantRow(WSL_SKU, '10mg', WSL_PRICE_CENTS, {
    on_hand: 0,
    inbound_units: 0,
    lead_days: 7,
    wholesale_eligible: true,
  });

function cartLine(
  sku: string,
  name: string,
  unitPriceCents: number,
  quantity: number,
  fast: boolean,
): OrderItemPayload {
  return {
    product: { id: sku.toLowerCase(), name, category: 'biopeptides', sku },
    quantity,
    unitPriceCents,
    fast,
  };
}

const fastLine = (quantity = BOGO_QTY): OrderItemPayload =>
  cartLine(FAST_SKU, `Fastpeptide — ${FAST_DOSE}`, FAST_PRICE_CENTS, quantity, true);

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

/** promo_settings with BOGO live and B2G1 off (isolating the launch promo). */
function bogoSettings(h: Harness, overrides: Record<string, unknown> = {}): void {
  h.db.on('promo_settings', 'select', {
    data: {
      b2g1_enabled: false,
      b2g1_ends_at: null,
      b2g1_excluded_skus: [],
      bogo_enabled: true,
      bogo_ends_at: null,
      bogo_excluded_skus: [],
      ...overrides,
    },
  });
}

function accountRpc(h: Harness, percent: number): void {
  h.db.onRpc('effective_customer_discount', {
    data: { found: true, scope: 'lifetime', percent, label: 'Lifetime discount' },
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

function notices(body: Record<string, unknown>): string[] {
  return (body.notices ?? []) as string[];
}

/** mark_order_paid / the signup backfill both accrue floor(cents / 100). */
const pointsFor = (invoiceAmountCents: number): number =>
  Math.floor(invoiceAmountCents / 100);

/** A member harness with BOGO live and one four-unit 24-hour line available. */
function bogoHarness(): Harness {
  const h = asMember(withVariantRows(makeHarness(), [fastRow()]));
  bogoSettings(h);
  return h;
}

// ---------------------------------------------------------------------------
// Case 1 — points accrue on what the customer actually PAYS
// ---------------------------------------------------------------------------

describe('reward points accrue on the discounted invoice, not the gross subtotal', () => {
  test('a BOGO order persists invoice_amount_cents at the DISCOUNTED figure points are computed from', async () => {
    // Arrange — member, BOGO live, four 24-hour units.
    const h = bogoHarness();

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert — the persisted invoice is the post-BOGO figure (member ships free),
    // and reward points therefore accrue on 20,000¢ (200 pts), never on the
    // 40,000¢ pre-discount subtotal (400 pts).
    expect(status).toBe(200);
    const row = orderInsert(h);
    expect(row).toMatchObject({
      subtotal_cents: BOGO_GROSS,
      shipping_cents: 0,
      discount_cents: BOGO_VALUE,
      invoice_amount_cents: BOGO_GROSS - BOGO_VALUE,
    });
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    expect(pointsFor(row.invoice_amount_cents as number)).toBe(200);
    expect(pointsFor(row.invoice_amount_cents as number)).not.toBe(
      pointsFor(row.subtotal_cents as number),
    );
  });
});

// ---------------------------------------------------------------------------
// Cases 2 & 3 — the member gate
// ---------------------------------------------------------------------------

describe('BOGO is members only', () => {
  test('a guest checking out the identical cart gets no discount and no BOGO row', async () => {
    // Arrange — same catalog, same promo settings, NO Authorization bearer.
    const h = withVariantRows(makeHarness(), [fastRow()]);
    bogoSettings(h);

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }));

    // Assert — full retail plus the guest shipping fee.
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BOGO_GROSS + GUEST_SHIPPING_CENTS);
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: BOGO_GROSS,
      discount_cents: 0,
      coupon_code: null,
      invoice_amount_cents: BOGO_GROSS + GUEST_SHIPPING_CENTS,
    });
    expect(couponRows(h)).toHaveLength(0);
  });

  test('a verified member gets the discount, the BOGO order_coupons row, and BOGO in the label', async () => {
    // Arrange
    const h = bogoHarness();

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert — money
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    const row = orderInsert(h);
    expect(row).toMatchObject({
      discount_cents: BOGO_VALUE,
      coupon_code: 'BOGO',
      user_id: 'user-1',
    });
    expect(String(row.coupon_code)).toContain('BOGO');

    // Assert — the synthetic promo row, exactly as the invoice surfaces read it
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: 'BOGO',
      kind: 'fixed',
      amount_cents: BOGO_VALUE,
      discount_cents: BOGO_VALUE,
      free_label: `Launch Day BOGO — ${BOGO_FREE_UNITS} units free`,
      source: 'promo',
    });

    // Assert — the buyer invoice itemizes it
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[0].html).toContain('BOGO');
  });

  test('a single free unit renders the SINGULAR free_label', async () => {
    // Arrange — two units pair into exactly one free unit.
    const h = bogoHarness();

    // Act
    const { status } = await placeOrder(h, basePayload({ items: [fastLine(2)] }), {
      bearer: MEMBER_JWT,
    });

    // Assert
    expect(status).toBe(200);
    expect(couponRows(h)[0]).toMatchObject({
      code: 'BOGO',
      free_label: 'Launch Day BOGO — 1 unit free',
      discount_cents: FAST_PRICE_CENTS,
    });
  });
});

// ---------------------------------------------------------------------------
// Case 4 — larger wins vs the account percentage (never additive)
// ---------------------------------------------------------------------------
//
// BOGO frees 2 of 4 identical units, so it is worth exactly 50% of this cart:
// a 30% account discount loses, 70% wins, and 50% is an exact tie.

describe('BOGO vs the account percentage — larger wins, tie to BOGO', () => {
  test('account clearly larger (70%) — the account bills and BOGO is suppressed entirely', async () => {
    // Arrange
    const h = bogoHarness();
    accountRpc(h, 70);
    const accountValue = Math.round((BOGO_GROSS * 70) / 100); // 28,000
    expect(accountValue).toBeGreaterThan(BOGO_VALUE);

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert — one discount only, and it is the account's.
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BOGO_GROSS - accountValue);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: accountValue, coupon_code: 'ACCT-LIFETIME' });
    expect(String(row.coupon_code)).not.toContain('BOGO');
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'ACCT-LIFETIME', source: 'account', percent: 70 });
  });

  test('BOGO clearly larger (30% account) — BOGO bills and the account row is absent', async () => {
    // Arrange
    const h = bogoHarness();
    accountRpc(h, 30);
    expect(Math.round((BOGO_GROSS * 30) / 100)).toBeLessThan(BOGO_VALUE);

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });
    expect(String(row.coupon_code)).not.toContain('ACCT');
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'BOGO', source: 'promo' });
  });

  test('exact tie (50% account, matching BOGO to the cent) — BOGO wins and the account row is absent', async () => {
    // Arrange
    const h = bogoHarness();
    accountRpc(h, 50);
    expect(Math.round((BOGO_GROSS * 50) / 100)).toBe(BOGO_VALUE); // a true tie

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert — the discount is charged once, under BOGO.
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });
    expect(String(row.coupon_code)).not.toContain('ACCT');
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'BOGO', source: 'promo' });
  });
});

// ---------------------------------------------------------------------------
// Case 5 — larger wins vs COUPON CODES, arbitrated before any code is admitted
// ---------------------------------------------------------------------------
//
// The buyer must always be able to TYPE a code: every branch below has to end
// in a successful order with a readable explanation, never a 400.

describe('BOGO vs coupon codes — larger wins, and typing a code never blocks checkout', () => {
  function fixedCodeRpc(h: Harness, code: string, cents: number): void {
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code, kind: 'fixed', amount_cents: cents, discount_cents: cents },
    });
  }

  test('a code worth MORE than BOGO is applied and BOGO stands down', async () => {
    // Arrange — 25,000¢ code vs 20,000¢ BOGO.
    const h = bogoHarness();
    fixedCodeRpc(h, 'BIG25', 25_000);
    redeemOk(h);

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], coupon_codes: ['BIG25'] }),
      { bearer: MEMBER_JWT },
    );

    // Assert — the code bills alone; nothing is additive.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS - 25_000);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: 25_000, coupon_code: 'BIG25' });
    expect(String(row.coupon_code)).not.toContain('BOGO');
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'BIG25', source: 'code', discount_cents: 25_000 });

    // The buyer is told why, in plain language — and the notice NAMES the code
    // and both figures, symmetrically with the BOGO-wins message.
    const why = notices(body).find((n) => /Launch Day BOGO/i.test(n));
    expect(why).toBeDefined();
    expect(why).toContain('BIG25');
    expect(why).toContain('$250.00'); // the code's value
    expect(why).toContain('$200.00'); // the BOGO value it beat
    expect(why).toMatch(/applied instead/i);

    // The dry-run valuation and the authoritative Pass-1 call are distinct, and
    // the real one sees no automatic promo (BOGO already stood down).
    const validates = h.db.rpcCalls.filter((c) => c.fn === 'validate_coupon');
    expect(validates).toHaveLength(2);
    expect(validates[1].args).toMatchObject({ p_code: 'BIG25', p_has_promo: false });
  });

  test('a code worth LESS than BOGO is NOT applied, BOGO bills, and the notice names the code', async () => {
    // Arrange — 5,000¢ code vs 20,000¢ BOGO.
    const h = bogoHarness();
    fixedCodeRpc(h, 'SMALL5', 5_000);
    redeemOk(h);

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], coupon_codes: ['SMALL5'] }),
      { bearer: MEMBER_JWT },
    );

    // Assert — checkout SUCCEEDS; the code is simply not admitted.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    expect(orderInsert(h)).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'BOGO', source: 'promo' });
    expect(rows.some((r) => r.source === 'code')).toBe(false);

    // Readable, and it names the code the buyer actually typed.
    const explanation = notices(body).find((n) => n.includes('SMALL5'));
    expect(explanation).toBeDefined();
    expect(explanation).toContain('$200.00'); // BOGO's value, stated in dollars
    expect(explanation).toMatch(/don't combine/i);

    // The loser is never redeemed — no coupon usage is burned.
    expect(h.db.rpcCalls.filter((c) => c.fn === 'redeem_coupon')).toHaveLength(0);
  });

  test('an exact tie between a code and BOGO goes to BOGO, and still succeeds', async () => {
    // Arrange — 20,000¢ code vs 20,000¢ BOGO.
    const h = bogoHarness();
    fixedCodeRpc(h, 'EVEN20', BOGO_VALUE);
    redeemOk(h);

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], coupon_codes: ['EVEN20'] }),
      { bearer: MEMBER_JWT },
    );

    // Assert
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    expect(orderInsert(h)).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });
    expect(couponRows(h)).toHaveLength(1);
    expect(couponRows(h)[0]).toMatchObject({ code: 'BOGO', source: 'promo' });
    expect(notices(body).some((n) => n.includes('EVEN20'))).toBe(true);
  });

  test('an INVALID code alongside BOGO is worth nothing, so BOGO bills and checkout still succeeds', async () => {
    // Arrange — the dry run says the code is invalid; it contributes 0¢, so
    // BOGO wins and the code list is cleared before Pass 1 could ever 400 on it.
    const h = bogoHarness();
    h.db.onRpc('validate_coupon', { data: { valid: false, reason: 'Code NOPE has expired.' } });

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], coupon_codes: ['NOPE'] }),
      { bearer: MEMBER_JWT },
    );

    // Assert — a dead code does not cost the member their BOGO discount.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    expect(orderInsert(h)).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });

    // …and the bad code is NAMED rather than silently dropped. Without BOGO
    // this same code is a hard 400; with BOGO live the order must not be
    // blocked (launch day), so the explanation moves into the notices instead.
    // Owner rule: a code the buyer typed is never silently ignored.
    expect(notices(body)).toHaveLength(1);
    expect(notices(body)[0]).toContain('NOPE');
    expect(notices(body)[0]).toMatch(/isn't valid/i);
  });
});

// ---------------------------------------------------------------------------
// Case 6 — wholesale finality still kills BOGO order-wide
// ---------------------------------------------------------------------------

describe('wholesale finality outranks BOGO', () => {
  test('a wholesale case suppresses BOGO on every OTHER line of the order', async () => {
    // Arrange — a sourced case of 10 (never 24-hour, so never BOGO-eligible)
    // plus a separate two-unit 24-hour line that WOULD earn BOGO on its own.
    const h = asMember(withVariantRows(makeHarness(), [wholesaleRow(), fastRow()]));
    bogoSettings(h);

    const gross = WSL_QTY * WSL_PRICE_CENTS + 2 * FAST_PRICE_CENTS;

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({
        items: [
          cartLine(WSL_SKU, 'Casepeptide — 10mg', WSL_PRICE_CENTS, WSL_QTY, false),
          fastLine(2),
        ],
      }),
      { bearer: MEMBER_JWT },
    );

    // Assert — wholesale is the only discount on the order.
    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - WSL_DISCOUNT);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: WSL_DISCOUNT, coupon_code: 'WHOLESALE' });
    expect(String(row.coupon_code)).not.toContain('BOGO');
    const rows = couponRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'WHOLESALE', source: 'promo' });
  });
});

// ---------------------------------------------------------------------------
// Case 7 — bundle vs BOGO: larger wins, tie to the bundle
// ---------------------------------------------------------------------------
//
// The bundle takes 20% of a complete Retatrutide + GHK-Cu pair; BOGO frees the
// CHEAPER unit of that same pair. So the bundle wins exactly when
// 0.2 × (a + b) > b, i.e. a > 4b. The three prices below sit either side of
// that boundary and exactly on it.

describe('bundle vs BOGO — larger wins, tie to the bundle', () => {
  function bundleCart(rttCents: number, ghkCents: number): {
    rows: TestVariantRow[];
    items: OrderItemPayload[];
  } {
    return {
      rows: [
        variantRow(RTT_SKU, '5mg', rttCents),
        variantRow(GHK_SKU, '50mg', ghkCents),
      ],
      items: [
        cartLine(RTT_SKU, 'Retatrutide — 5mg', rttCents, 1, true),
        cartLine(GHK_SKU, 'GHK-Cu — 50mg', ghkCents, 1, true),
      ],
    };
  }

  test('bundle clearly larger — the bundle bills and BOGO is zeroed', async () => {
    // Arrange — 60,000 + 10,000: bundle = 14,000, BOGO frees the 10,000 unit.
    const { rows, items } = bundleCart(60_000, 10_000);
    const h = asMember(withVariantRows(makeHarness(), rows));
    bogoSettings(h);
    const gross = 70_000;
    const bundleValue = Math.round((gross * 20) / 100); // 14,000
    expect(bundleValue).toBeGreaterThan(10_000);

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items }), { bearer: MEMBER_JWT });

    // Assert
    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - bundleValue);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: bundleValue, coupon_code: 'BUNDLE' });
    expect(String(row.coupon_code)).not.toContain('BOGO');
    expect(couponRows(h)).toHaveLength(1);
    expect(couponRows(h)[0]).toMatchObject({ code: 'BUNDLE', source: 'promo' });
  });

  test('BOGO clearly larger — BOGO bills and the bundle is zeroed', async () => {
    // Arrange — 20,000 + 10,000: bundle = 6,000, BOGO frees the 10,000 unit.
    const { rows, items } = bundleCart(20_000, 10_000);
    const h = asMember(withVariantRows(makeHarness(), rows));
    bogoSettings(h);
    const gross = 30_000;
    expect(Math.round((gross * 20) / 100)).toBeLessThan(10_000);

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items }), { bearer: MEMBER_JWT });

    // Assert
    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - 10_000);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: 10_000, coupon_code: 'BOGO' });
    expect(String(row.coupon_code)).not.toContain('BUNDLE');
    expect(couponRows(h)).toHaveLength(1);
    expect(couponRows(h)[0]).toMatchObject({
      code: 'BOGO',
      free_label: 'Launch Day BOGO — 1 unit free',
      source: 'promo',
    });
  });

  test('an exact tie (a = 4b) goes to the bundle', async () => {
    // Arrange — 40,000 + 10,000: bundle = 10,000, BOGO frees the 10,000 unit.
    const { rows, items } = bundleCart(40_000, 10_000);
    const h = asMember(withVariantRows(makeHarness(), rows));
    bogoSettings(h);
    const gross = 50_000;
    expect(Math.round((gross * 20) / 100)).toBe(10_000); // a true tie

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items }), { bearer: MEMBER_JWT });

    // Assert
    expect(status).toBe(200);
    expect(body.amountCents).toBe(gross - 10_000);
    const row = orderInsert(h);
    expect(row).toMatchObject({ discount_cents: 10_000, coupon_code: 'BUNDLE' });
    expect(String(row.coupon_code)).not.toContain('BOGO');
    expect(couponRows(h)).toHaveLength(1);
    expect(couponRows(h)[0]).toMatchObject({ code: 'BUNDLE', source: 'promo' });
  });
});

// ---------------------------------------------------------------------------
// Case 8 — the in-flight expiry notice (expected_bogo_cents is advisory ONLY)
// ---------------------------------------------------------------------------

describe('expected_bogo_cents — advisory only, never priced', () => {
  test('a quoted BOGO the server does not grant still succeeds and says the offer ended', async () => {
    // Arrange — the promo is switched off, simulating the window closing while
    // the cart sat open, but the client still carries what it quoted.
    const h = asMember(withVariantRows(makeHarness(), [fastRow()]));
    bogoSettings(h, { bogo_enabled: false });

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], expected_bogo_cents: BOGO_VALUE }),
      { bearer: MEMBER_JWT },
    );

    // Assert — full retail, order intact, and plain language about why.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS);
    expect(orderInsert(h)).toMatchObject({ discount_cents: 0, coupon_code: null });
    expect(couponRows(h)).toHaveLength(0);
    const explanation = notices(body).find((n) => /offer ended/i.test(n));
    expect(explanation).toBeDefined();
    expect(explanation).toMatch(/wasn't applied/i);
  });

  test('a huge bogus expected_bogo_cents changes no money at all', async () => {
    // Arrange — the same promo-off cart, once bare and once with an absurd
    // advisory figure. The only permitted difference is the notice.
    const bare = asMember(withVariantRows(makeHarness(), [fastRow()]));
    bogoSettings(bare, { bogo_enabled: false });
    const bogus = asMember(withVariantRows(makeHarness(), [fastRow()]));
    bogoSettings(bogus, { bogo_enabled: false });

    // Act
    const control = await placeOrder(bare, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });
    const claimed = await placeOrder(
      bogus,
      basePayload({ items: [fastLine()], expected_bogo_cents: 9_999_999 }),
      { bearer: MEMBER_JWT },
    );

    // Assert — identical money either way.
    expect(claimed.status).toBe(200);
    expect(claimed.body.amountCents).toBe(control.body.amountCents);
    expect(claimed.body.amountCents).toBe(BOGO_GROSS);
    expect(orderInsert(bogus)).toMatchObject({
      subtotal_cents: BOGO_GROSS,
      discount_cents: 0,
      invoice_amount_cents: BOGO_GROSS,
    });
    // …and the control order says nothing, because nothing was quoted.
    expect(notices(control.body)).toHaveLength(0);
    expect(notices(claimed.body)).toHaveLength(1);
  });

  test('a quote that DISAGREES with the granted discount is reconciled in the notice, not in the price', async () => {
    // Arrange — BOGO is live and worth 20,000¢; the client claims 33,333¢.
    const h = bogoHarness();

    // Act
    const { status, body } = await placeOrder(
      h,
      basePayload({ items: [fastLine()], expected_bogo_cents: 33_333 }),
      { bearer: MEMBER_JWT },
    );

    // Assert — the server's own figure bills, and the buyer is told both.
    expect(status).toBe(200);
    expect(body.amountCents).toBe(BOGO_GROSS - BOGO_VALUE);
    expect(orderInsert(h)).toMatchObject({ discount_cents: BOGO_VALUE, coupon_code: 'BOGO' });
    const explanation = notices(body).find((n) => /recalculated at checkout/i.test(n));
    expect(explanation).toBeDefined();
    expect(explanation).toContain('$200.00'); // applied
    expect(explanation).toContain('$333.33'); // claimed
  });
});

// ---------------------------------------------------------------------------
// Case 9 — a promo-settings read failure falls closed
// ---------------------------------------------------------------------------

describe('promo_settings read failure', () => {
  test('falls closed to retail — no BOGO, and the order still succeeds', async () => {
    // Arrange — the settings read errors, so BOGO liveness is unknowable.
    const h = asMember(withVariantRows(makeHarness(), [fastRow()]));
    h.db.on('promo_settings', 'select', { data: null, error: { message: 'read failed' } });

    // Act
    const { status, body } = await placeOrder(h, basePayload({ items: [fastLine()] }), {
      bearer: MEMBER_JWT,
    });

    // Assert — the buyer misses a discount, never gets overcharged, never blocked.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(BOGO_GROSS);
    expect(orderInsert(h)).toMatchObject({
      subtotal_cents: BOGO_GROSS,
      discount_cents: 0,
      coupon_code: null,
      invoice_amount_cents: BOGO_GROSS,
    });
    expect(couponRows(h)).toHaveLength(0);
    expect(h.emails).toHaveLength(2);
  });
});
