/**
 * Orchestration tests — place-order email rendering branches (handler.ts).
 *
 * The email builders live inside the handler factory and only render through
 * a full checkout, so these tests pin their branchwork the same way the
 * operator sees it: by driving real orders through the harness and asserting
 * on the captured Resend payloads — brand-stamp header vs the text stamp,
 * per-line ship-speed tags, the split-shipment notice, the ship-to block's
 * absence for address-less orders, and the organization/notes rows.
 */
import { describe, expect, test } from 'vitest';
import {
  basePayload,
  catalogRows,
  makeHarness,
  placeOrder,
  withCatalog,
  type CatalogVariantRow,
} from '../helpers/placeOrderHarness';
import type { OrderItemPayload } from '../../supabase/functions/place-order/orderPayload';

const TB_SKU = 'VSR-RS-TB4';
const TB_PRICE = 6999;

function tbRow(): CatalogVariantRow {
  return {
    sku: TB_SKU,
    dose: '10mg',
    price_cents: TB_PRICE,
    on_hand: 4,
    inbound_units: 0,
    lead_days: null,
    wholesale_eligible: false,
  };
}

function tbItem(overrides: Partial<OrderItemPayload> = {}): OrderItemPayload {
  return {
    product: { id: 'tb-500', name: 'TB-500 — 10mg', category: 'biopeptides', sku: TB_SKU },
    quantity: 1,
    unitPriceCents: TB_PRICE,
    ...overrides,
  };
}

describe('brand header', () => {
  test('a configured BRAND_STAMP_URL renders the hosted stamp image instead of the text mark', async () => {
    const h = withCatalog(
      makeHarness({ brandStampUrl: 'https://cdn.test.example/stamp.png' }),
    );
    await placeOrder(h, basePayload());

    const biz = h.emails[1];
    expect(biz.html).toContain('https://cdn.test.example/stamp.png');
    expect(biz.html).not.toContain('BioPeptides · Nootropics · Skincare');
  });

  test('without a stamp URL the email-safe text mark renders with the compliance line', async () => {
    const h = withCatalog(makeHarness());
    await placeOrder(h, basePayload());

    const biz = h.emails[1];
    expect(biz.html).toContain('Research Labs');
    expect(biz.html).toContain('For Research Use Only · Not For Human Use');
  });
});

describe('ship-speed tags and the split-shipment notice', () => {
  test('a mixed fast + standard cart tags each line and flags the split shipment', async () => {
    const h = withCatalog(makeHarness(), [...catalogRows(), tbRow()]);
    const payload = basePayload(); // line 1 is fast: true
    payload.items.push(tbItem({ fast: false }));

    await placeOrder(h, payload);

    const biz = h.emails[1];
    expect(biz.html).toContain('⚡ 24 HR');
    expect(biz.html).toContain('Standard');
    expect(biz.html).toContain('Split shipment');
    expect(biz.html).toContain('ship them separately');
    // The plain-text mirror tags both lines too.
    expect(biz.text).toContain('[24 HR]');
    expect(biz.text).toContain('[STANDARD]');
  });

  test('a uniform-speed cart gets no split-shipment notice, and unknown speed gets no tag', async () => {
    const h = withCatalog(makeHarness(), [...catalogRows(), tbRow()]);
    const payload = basePayload();
    payload.items[0].fast = undefined;
    payload.items.push(tbItem({ fast: undefined }));

    await placeOrder(h, payload);

    const biz = h.emails[1];
    expect(biz.html).not.toContain('Split shipment');
    expect(biz.html).not.toContain('⚡ 24 HR');
    expect(biz.html).not.toContain('>Standard<');
    // Unknown ship speed is stored as null on the lines.
    const lines = h.db.of('order_lines', 'insert')[0].payload as Record<string, unknown>[];
    expect(lines.every((l) => l.fast_ship === null)).toBe(true);
  });
});

describe('ship-to block', () => {
  test('an order with no address renders no Ship to block in the business email', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload({
      ship_street: undefined,
      ship_city: undefined,
      ship_state: undefined,
      ship_zip: undefined,
      ship_country: undefined,
    });

    const { status } = await placeOrder(h, payload);

    expect(status).toBe(200);
    const biz = h.emails[1];
    expect(biz.html).not.toContain('Ship to');
    // The rows persist the absence as NULLs (country defaults to US).
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.ship_street).toBeNull();
    expect(order.ship_city).toBeNull();
  });

  test('a city-only address (blank street/state/zip/country) renders just the city line and stores NULLs', async () => {
    const h = withCatalog(makeHarness());
    // Explicit empty strings: blank country survives as empty (only an ABSENT
    // country defaults to US), so the block renders city alone.
    const payload = basePayload({
      ship_street: '',
      ship_state: '',
      ship_zip: '',
      ship_country: '',
    });

    const { status } = await placeOrder(h, payload);

    expect(status).toBe(200);
    const biz = h.emails[1];
    expect(biz.html).toContain('Ship to');
    expect(biz.html).toContain('Lab City');
    expect(biz.html).not.toContain('1 Research Way');
    expect(biz.html).not.toMatch(/US\s*<\/div>/); // no country line
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.ship_street).toBeNull();
    expect(order.ship_country).toBeNull();
  });

  test('a street-only address (blank city/state/zip) renders street + defaulted country, no city line', async () => {
    const h = withCatalog(makeHarness());
    const payload = basePayload({ ship_city: '', ship_state: '', ship_zip: '' });

    const { status } = await placeOrder(h, payload);

    expect(status).toBe(200);
    const biz = h.emails[1];
    expect(biz.html).toContain('Ship to');
    expect(biz.html).toContain('1 Research Way');
    expect(biz.html).not.toContain('Lab City');
    expect(biz.html).toMatch(/US\s*<\/div>/); // absent country defaulted to US
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.ship_city).toBeNull();
    expect(order.ship_country).toBe('US');
  });

  test('a full address renders the verify-before-paying ship-to block', async () => {
    const h = withCatalog(makeHarness());
    await placeOrder(h, basePayload());

    const biz = h.emails[1];
    expect(biz.html).toContain('Ship to');
    expect(biz.html).toContain('1 Research Way');
    expect(biz.html).toContain('Lab City, CA 90001');
    expect(biz.html).toContain('Please verify before paying');
  });
});

describe('organization and buyer notes rows', () => {
  test('organization and notes render in the business email when present', async () => {
    const h = withCatalog(makeHarness());
    const { status } = await placeOrder(
      h,
      basePayload({ organization: 'Velari Labs LLC', notes: 'Leave at loading dock\nRing bell' }),
    );

    expect(status).toBe(200);
    const biz = h.emails[1];
    expect(biz.html).toContain('Organization');
    expect(biz.html).toContain('Velari Labs LLC');
    expect(biz.html).toContain('Buyer notes');
    expect(biz.html).toContain('Leave at loading dock<br/>Ring bell');
    // Both persist on the inquiry + order rows.
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.buyer_organization).toBe('Velari Labs LLC');
    expect(order.notes).toBe('Leave at loading dock\nRing bell');
  });

  test('HTML in buyer-controlled fields is escaped in the business email', async () => {
    const h = withCatalog(makeHarness());
    await placeOrder(
      h,
      basePayload({
        name: 'Evil <script>alert(1)</script>',
        organization: '<img src=x onerror=alert(1)>',
      }),
    );

    const biz = h.emails[1];
    expect(biz.html).not.toContain('<script>alert(1)</script>');
    expect(biz.html).toContain('Evil &lt;script&gt;');
    expect(biz.html).not.toContain('<img src=x');
  });
});

describe('payment code', () => {
  test('the business email action block carries the short payment code (the final order-number segment)', async () => {
    const h = withCatalog(makeHarness());
    const { body } = await placeOrder(h, basePayload());

    const orderNumber = body.orderNumber as string;
    const shortCode = orderNumber.split('-').pop() as string;
    const biz = h.emails[1];
    expect(biz.html).toContain(`>${shortCode}</span>`);
    expect(biz.text).toContain(`a payment with note ${shortCode}.`);
    expect(biz.subject).toContain(orderNumber);
  });
});
