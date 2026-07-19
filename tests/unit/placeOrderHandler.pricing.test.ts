/**
 * Orchestration tests — place-order server price authority (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/placeOrderHarness)
 * and pins the P0-1 fail-closed price gate: catalog read failures refuse the
 * order, mismatched/zero/unknown/unresolvable lines are 409s with the exact
 * buyer copy, malformed skus stay out of the .in() query, and the one allowed
 * gap — a formula-priced dose with no admin price — proceeds as an UNVERIFIED
 * order with the full operator paper trail (order_events + flagged emails).
 */
import { describe, expect, test } from 'vitest';
import {
  BPC_PRICE_CENTS,
  BPC_SKU,
  basePayload,
  catalogRows,
  makeHarness,
  placeOrder,
  withCatalog,
  type Harness,
} from '../helpers/placeOrderHarness';
import type { OrderItemPayload } from '../../supabase/functions/place-order/orderPayload';

const CATALOG_DOWN_MESSAGE =
  "We couldn't verify catalog prices just now. Please try again in a moment.";
const GENERIC_REFUSAL_MESSAGE =
  "We couldn't verify every line in this order against the catalog. " +
  "Refresh your cart and try again — if it keeps happening, contact us and we'll place the order for you.";

/** A second cart line (TB-500 10mg) for multi-line scenarios. */
const TB_SKU = 'VSR-RS-TB4';
function tbItem(overrides: Partial<OrderItemPayload> = {}): OrderItemPayload {
  return {
    product: { id: 'tb-500', name: 'TB-500 — 10mg', category: 'biopeptides', sku: TB_SKU },
    quantity: 1,
    unitPriceCents: 6999,
    fast: true,
    ...overrides,
  };
}

function expectNoRowsAndNoEmails(h: Harness): void {
  expect(h.db.of('inquiries', 'insert')).toHaveLength(0);
  expect(h.db.of('orders', 'insert')).toHaveLength(0);
  expect(h.emails).toHaveLength(0);
}

/** The leading args of the .in() call on the recorded price-check select. */
function inFilterArgs(h: Harness, table: string): unknown[] | undefined {
  const query = h.db.of(table, 'select')[0];
  return query?.calls.find((c) => c.method === 'in')?.args;
}

describe('catalog read failure fails closed', () => {
  test('a variant read error refuses the order with 503 and creates nothing', async () => {
    // Arrange
    const h = makeHarness();
    h.db.on('product_variant_stock', 'select', { error: { message: 'connection refused' } });
    h.db.on('product_stock', 'select', { data: [] });

    // Act
    const { status, body } = await placeOrder(h, basePayload());

    // Assert
    expect(status).toBe(503);
    expect(body.error).toBe(CATALOG_DOWN_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });

  test('an override read error alone (variants fine) still refuses with 503', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('product_stock', 'select', { error: { message: 'timeout' } });

    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(503);
    expect(body.error).toBe(CATALOG_DOWN_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });
});

describe('price mismatch refusal', () => {
  test('a line billed below the admin price is a 409 with the "price changed" copy, no rows, no emails', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items[0].unitPriceCents = BPC_PRICE_CENTS - 500;

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(
      'The price of “BPC-157 — 5mg” changed while you were checking out. ' +
        'Refresh your cart to see the current price, then place the order again.',
    );
    expectNoRowsAndNoEmails(h);
  });

  test('two mismatched lines pluralize the "price changed" copy', async () => {
    const h = withCatalog(makeHarness(), [
      ...catalogRows(),
      { sku: TB_SKU, dose: '10mg', price_cents: 6999, on_hand: 4, inbound_units: 0, lead_days: null, wholesale_eligible: false },
    ]);
    const payload = basePayload();
    payload.items[0].unitPriceCents = 1;
    payload.items.push(tbItem({ unitPriceCents: 2 }));

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(
      'The price of 2 items in your cart changed while you were checking out. ' +
        'Refresh your cart to see the current price, then place the order again.',
    );
    expectNoRowsAndNoEmails(h);
  });
});

describe('unverifiable lines refuse with the generic message', () => {
  test('a zero client price is a 409 even when the dose is priced in the catalog', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items[0].unitPriceCents = 0;

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });

  test('a negative client price clamps to zero and is refused the same way', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items[0].unitPriceCents = -4999;

    const { status } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expectNoRowsAndNoEmails(h);
  });

  test('a sku with no catalog rows anywhere is a 409', async () => {
    // Arrange — both price sources return empty: the sku is not in the catalog.
    const h = makeHarness();
    h.db.on('product_variant_stock', 'select', { data: [] });
    h.db.on('product_stock', 'select', { data: [] });

    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });

  test('a line with NO sku at all is a 409 and skips the catalog queries entirely', async () => {
    // With no queryable sku the handler takes the no-query branch (empty
    // results, no .in() filter) and verifyLinePrices refuses on missing_sku.
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    delete payload.items[0].product.sku;

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    expect(h.db.of('product_variant_stock', 'select')).toHaveLength(0);
    expect(h.db.of('product_stock', 'select')).toHaveLength(0);
    expectNoRowsAndNoEmails(h);
  });

  test('catalog reads resolving null data (no error) are treated as empty and refuse with 409', async () => {
    // A null result set is coalesced to [] — the sku then has no rows anywhere,
    // which is unknown_sku, not a silent pass.
    const h = makeHarness();
    h.db.on('product_variant_stock', 'select', { data: null });
    h.db.on('product_stock', 'select', { data: null });

    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });

  test('a catalog sku whose line text names no real dose is a 409 (dose_unresolved)', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items[0].product.name = 'BPC-157 — mystery size';

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    expectNoRowsAndNoEmails(h);
  });

  test('a mismatch mixed with any other failure falls back to the generic message', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items[0].unitPriceCents = BPC_PRICE_CENTS - 100; // price_mismatch
    payload.items.push(tbItem({ unitPriceCents: 0 })); // zero_price

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
  });
});

describe('malformed sku containment', () => {
  test('a sku with a quote is rejected AND kept out of both .in() query filters', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items.push(
      tbItem({
        product: { id: 'evil', name: 'Evil — 5mg', category: null, sku: 'VSR-"EVIL' },
        unitPriceCents: 1000,
      }),
    );

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(409);
    expect(body.error).toBe(GENERIC_REFUSAL_MESSAGE);
    // Only the well-formed sku entered the batched catalog queries.
    expect(inFilterArgs(h, 'product_variant_stock')).toEqual(['sku', [BPC_SKU]]);
    expect(inFilterArgs(h, 'product_stock')).toEqual(['sku', [BPC_SKU]]);
    expectNoRowsAndNoEmails(h);
  });
});

describe('formula-priced (unverified) lines proceed with a paper trail', () => {
  /** basePayload()'s dose exists in the catalog but carries NO admin price. */
  function unpricedCatalog(h: Harness): Harness {
    return withCatalog(h, [{ ...catalogRows()[0], price_cents: null }]);
  }

  test('an unpriced dose ships: 200, order_events warning, flagged business email, buyer invoice intact', async () => {
    // Arrange
    const h = unpricedCatalog(makeHarness());

    // Act
    const { status, body } = await placeOrder(h, basePayload());

    // Assert — the order goes through.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.db.of('orders', 'insert')).toHaveLength(1);

    // Durable admin-timeline record of the line taken on trust.
    const events = h.db.of('order_events', 'insert');
    expect(events).toHaveLength(1);
    const event = events[0].payload as Record<string, unknown>;
    expect(event.kind).toBe('system');
    expect(event.note).toContain('Unverified line price on checkout');
    expect(event.note).toContain(`${BPC_SKU}: billed $49.99, no admin price for this dose`);

    // Buyer invoice still sends; the business copy is flagged.
    expect(h.emails).toHaveLength(2);
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[1].to).toBe('biz@test.example');
    expect(h.emails[1].subject.startsWith('⚠ ')).toBe(true);
    expect(h.emails[1].html).toContain('Unverified price — confirm before marking paid');
    expect(h.emails[1].html).toContain('no admin price for this dose');
  });

  test('an order_events insert error is tolerated — order still succeeds with no alert', async () => {
    const h = unpricedCatalog(makeHarness());
    h.db.on('order_events', 'insert', { error: { message: 'events table locked' } });

    const { status, body } = await placeOrder(h, basePayload());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.alerts).toHaveLength(0);
    expect(h.emails).toHaveLength(2);
  });

  test('with one verified and one unverified line, only the unverified sku is in the warning', async () => {
    // Arrange — BPC verifies exactly; TB-500's dose row has no admin price.
    const h = withCatalog(makeHarness(), [
      ...catalogRows(),
      { sku: TB_SKU, dose: '10mg', price_cents: null, on_hand: 0, inbound_units: 0, lead_days: null, wholesale_eligible: false },
    ]);
    const payload = basePayload();
    payload.items.push(tbItem());

    const { status } = await placeOrder(h, payload);

    expect(status).toBe(200);
    const note = (h.db.of('order_events', 'insert')[0].payload as Record<string, unknown>)
      .note as string;
    expect(note).toContain(TB_SKU);
    expect(note).not.toContain(BPC_SKU);
    // The flagged business email likewise names only the unverified line.
    expect(h.emails[1].subject.startsWith('⚠ ')).toBe(true);
  });
});

describe('sku deduplication in the catalog query', () => {
  test('duplicate cart skus produce a deduped .in() filter and still verify', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload();
    payload.items.push({ ...basePayload().items[0] }); // same sku twice

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(inFilterArgs(h, 'product_variant_stock')).toEqual(['sku', [BPC_SKU]]);
    expect(inFilterArgs(h, 'product_stock')).toEqual(['sku', [BPC_SKU]]);
  });
});
