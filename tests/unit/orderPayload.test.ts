/**
 * Unit tests for supabase/functions/place-order/orderPayload.ts — boundary
 * validation + normalization for the checkout payload, extracted verbatim
 * from the place-order handler. Error messages and statuses are asserted
 * byte-for-byte: the handler turns { ok: false } into jsonResponse(error,
 * status), so these strings ARE the API contract.
 */
import { describe, expect, test } from 'vitest';
import {
  validateOrderPayload,
  type OrderItemPayload,
  type OrderPayload,
  type ValidatedOrder,
} from '../../supabase/functions/place-order/orderPayload';

const VALID_ITEM: OrderItemPayload = {
  product: { id: 'retatrutide-5mg', name: 'Retatrutide 5mg', category: 'peptides' },
  quantity: 2,
  unitPriceCents: 2499,
};

const VALID_ATTESTATION = {
  accepted_at: '2026-07-17T12:00:00.000Z',
  disclaimer_version: 2,
  industry: 'biotech_pharma',
  age_21_confirmed: true,
  research_use_confirmed: true,
};

function basePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    name: 'Ray Buyer',
    contact: 'buyer@example.com',
    items: [{ ...VALID_ITEM, product: { ...VALID_ITEM.product } }],
    ...overrides,
  };
}

/** Cast an intentionally malformed value through the payload type. */
function asPayload(value: unknown): OrderPayload {
  return value as OrderPayload;
}

function expectReject(payload: OrderPayload, error: string): void {
  expect(validateOrderPayload(payload)).toEqual({ ok: false, error, status: 400 });
}

function expectOk(payload: OrderPayload): ValidatedOrder {
  const result = validateOrderPayload(payload);
  if (!result.ok) {
    throw new Error(`expected ok result, got rejection: ${result.error}`);
  }
  return result.value;
}

describe('validateOrderPayload — buyer field rejections', () => {
  test('rejects a missing name', () => {
    const { name: _n, ...rest } = basePayload(); void _n;
    expectReject(asPayload(rest), 'Name is required.');
  });

  test('rejects a whitespace-only name (trimmed to empty)', () => {
    expectReject(basePayload({ name: '   ' }), 'Name is required.');
  });

  test('rejects a name longer than 120 chars', () => {
    expectReject(basePayload({ name: 'x'.repeat(121) }), 'Name too long.');
  });

  test('accepts a name exactly at the 120-char cap', () => {
    expect(expectOk(basePayload({ name: 'x'.repeat(120) })).name).toBe('x'.repeat(120));
  });

  test('rejects a missing contact', () => {
    const { contact: _c, ...rest } = basePayload(); void _c;
    expectReject(asPayload(rest), 'Contact is required.');
  });

  test('rejects a whitespace-only contact (trimmed to empty)', () => {
    expectReject(basePayload({ contact: '  ' }), 'Contact is required.');
  });

  test('rejects a contact longer than 200 chars', () => {
    expectReject(basePayload({ contact: 'c'.repeat(201) }), 'Contact too long.');
  });

  test('rejects an organization longer than 200 chars', () => {
    expectReject(basePayload({ organization: 'o'.repeat(201) }), 'Organization too long.');
  });

  test('rejects notes longer than 4000 chars', () => {
    expectReject(basePayload({ notes: 'n'.repeat(4001) }), 'Notes too long.');
  });
});

describe('validateOrderPayload — items array rejections', () => {
  test('rejects an empty items array', () => {
    expectReject(basePayload({ items: [] }), 'Order must contain at least one item.');
  });

  test('treats a non-array items field as zero items', () => {
    expectReject(
      basePayload({ items: asPayload('not-an-array') as unknown as OrderItemPayload[] }),
      'Order must contain at least one item.',
    );
  });

  test('treats a missing items field as zero items', () => {
    const { items: _i, ...rest } = basePayload(); void _i;
    expectReject(asPayload(rest), 'Order must contain at least one item.');
  });

  test('rejects more than 100 items', () => {
    const items = Array.from({ length: 101 }, () => ({ ...VALID_ITEM }));
    expectReject(basePayload({ items }), 'Too many items in order.');
  });

  test('accepts exactly 100 items', () => {
    const items = Array.from({ length: 100 }, () => ({ ...VALID_ITEM }));
    expect(expectOk(basePayload({ items })).items).toHaveLength(100);
  });

  test('rejects a null item', () => {
    const items = [null] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Malformed item.');
  });

  test('rejects a non-object item', () => {
    const items = ['garbage'] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Malformed item.');
  });

  test('rejects an item with no product', () => {
    const items = [{ quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item missing product details.');
  });

  test('rejects an item whose product is not an object', () => {
    const items = [{ product: 'retatrutide', quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item missing product details.');
  });

  test('rejects a product with no id', () => {
    const items = [{ product: { name: 'Retatrutide 5mg' }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product must include id and name.');
  });

  test('rejects a product whose id is not a string', () => {
    const items = [{ product: { id: 42, name: 'Retatrutide 5mg' }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product must include id and name.');
  });

  test('rejects a product whose name is not a string', () => {
    const items = [{ product: { id: 'reta', name: 42 }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product must include id and name.');
  });

  test('rejects a product whose name trims to empty', () => {
    const items = [{ product: { id: 'reta', name: '   ' }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product must include id and name.');
  });

  test('rejects a product id longer than 200 chars', () => {
    const items = [{ product: { id: 'i'.repeat(201), name: 'Retatrutide 5mg' }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product details too long.');
  });

  test('rejects a product name longer than 200 chars (post-trim)', () => {
    const items = [{ product: { id: 'reta', name: 'n'.repeat(201) }, quantity: 1 }] as unknown as OrderItemPayload[];
    expectReject(basePayload({ items }), 'Item product details too long.');
  });

  test('accepts a product id and name exactly at the 200-char cap', () => {
    const items = [{ product: { id: 'i'.repeat(200), name: 'n'.repeat(200), category: null }, quantity: 1 }];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].product.id).toBe('i'.repeat(200));
    expect(value.items[0].product.name).toBe('n'.repeat(200));
  });
});

describe('validateOrderPayload — trims, slices, and defaults', () => {
  test('trims name, contact, organization, and notes', () => {
    const value = expectOk(basePayload({
      name: '  Ray Buyer  ',
      contact: '  buyer@example.com  ',
      organization: '  VS Research  ',
      notes: '  leave at door  ',
    }));
    expect(value.name).toBe('Ray Buyer');
    expect(value.contact).toBe('buyer@example.com');
    expect(value.organization).toBe('VS Research');
    expect(value.notes).toBe('leave at door');
  });

  test('trims then slices every ship field to its cap', () => {
    const value = expectOk(basePayload({
      ship_street:  `  ${'s'.repeat(250)}  `,
      ship_city:    `  ${'c'.repeat(150)}  `,
      ship_state:   `  ${'t'.repeat(80)}  `,
      ship_zip:     `  ${'z'.repeat(30)}  `,
      ship_country: `  ${'u'.repeat(80)}  `,
    }));
    expect(value.shipStreet).toBe('s'.repeat(200));
    expect(value.shipCity).toBe('c'.repeat(120));
    expect(value.shipState).toBe('t'.repeat(60));
    expect(value.shipZip).toBe('z'.repeat(20));
    expect(value.shipCountry).toBe('u'.repeat(60));
  });

  test('defaults ship_country to "US" when absent', () => {
    const value = expectOk(basePayload());
    expect(value.shipCountry).toBe('US');
    expect(value.cleanPayload.ship_country).toBe('US');
  });

  test('a whitespace-only ship_country trims to empty rather than defaulting', () => {
    // Oddity: the "US" default only applies to a nullish ship_country — an
    // explicit whitespace string trims to "" and is dropped from cleanPayload.
    const value = expectOk(basePayload({ ship_country: '   ' }));
    expect(value.shipCountry).toBe('');
    expect(value.cleanPayload.ship_country).toBeUndefined();
  });

  test('missing optional fields normalize to empty strings on the value', () => {
    const value = expectOk(basePayload());
    expect(value.organization).toBe('');
    expect(value.notes).toBe('');
    expect(value.shipStreet).toBe('');
    expect(value.shipCity).toBe('');
    expect(value.shipState).toBe('');
    expect(value.shipZip).toBe('');
  });
});

describe('validateOrderPayload — item normalization', () => {
  test('clamps a zero quantity up to 1', () => {
    const value = expectOk(basePayload({ items: [{ ...VALID_ITEM, quantity: 0 }] }));
    expect(value.items[0].quantity).toBe(1);
  });

  test('clamps a quantity above 9999 down to the cap', () => {
    const value = expectOk(basePayload({ items: [{ ...VALID_ITEM, quantity: 10000 }] }));
    expect(value.items[0].quantity).toBe(9999);
  });

  test('floors a fractional quantity and defaults a non-numeric quantity to 1', () => {
    const items = [
      { ...VALID_ITEM, quantity: 3.9 },
      { ...VALID_ITEM, quantity: 'lots' },
    ] as unknown as OrderItemPayload[];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].quantity).toBe(3);
    expect(value.items[1].quantity).toBe(1);
  });

  test('clamps negative unitPriceCents to 0 and caps at the $100k line ceiling', () => {
    const items = [
      { ...VALID_ITEM, unitPriceCents: -500 },
      { ...VALID_ITEM, unitPriceCents: 100_000_00 + 1 },
    ];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].unitPriceCents).toBe(0);
    expect(value.items[1].unitPriceCents).toBe(100_000_00);
  });

  test('defaults a missing unitPriceCents to 0', () => {
    const { unitPriceCents: _p, ...itemRest } = VALID_ITEM; void _p;
    const value = expectOk(basePayload({ items: [itemRest] }));
    expect(value.items[0].unitPriceCents).toBe(0);
  });

  test('trims the line note and slices it to 1000 chars', () => {
    const value = expectOk(basePayload({
      items: [{ ...VALID_ITEM, note: `  ${'n'.repeat(1200)}  ` }],
    }));
    expect(value.items[0].note).toBe('n'.repeat(1000));
  });

  test('drops a whitespace-only note', () => {
    const value = expectOk(basePayload({ items: [{ ...VALID_ITEM, note: '   ' }] }));
    expect(value.items[0].note).toBeUndefined();
  });

  test('drops a non-string note', () => {
    const items = [{ ...VALID_ITEM, note: 123 }] as unknown as OrderItemPayload[];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].note).toBeUndefined();
  });

  test('trims the sku and drops it when empty or non-string', () => {
    const items = [
      { ...VALID_ITEM, product: { ...VALID_ITEM.product, sku: '  SKU-9  ' } },
      { ...VALID_ITEM, product: { ...VALID_ITEM.product, sku: '   ' } },
      { ...VALID_ITEM, product: { ...VALID_ITEM.product, sku: 42 } },
    ] as unknown as OrderItemPayload[];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].product.sku).toBe('SKU-9');
    expect(value.items[1].product.sku).toBeUndefined();
    expect(value.items[2].product.sku).toBeUndefined();
  });

  test('keeps a string category and nulls a non-string category', () => {
    const items = [
      { ...VALID_ITEM, product: { ...VALID_ITEM.product, category: 'peptides' } },
      { ...VALID_ITEM, product: { ...VALID_ITEM.product, category: 7 } },
      { ...VALID_ITEM, product: { id: 'bare', name: 'Bare' } },
    ] as unknown as OrderItemPayload[];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].product.category).toBe('peptides');
    expect(value.items[1].product.category).toBeNull();
    expect(value.items[2].product.category).toBeNull();
  });

  test('keeps fast only when it is a boolean', () => {
    const items = [
      { ...VALID_ITEM, fast: true },
      { ...VALID_ITEM, fast: false },
      { ...VALID_ITEM, fast: 'yes' },
      { ...VALID_ITEM },
    ] as unknown as OrderItemPayload[];
    const value = expectOk(basePayload({ items }));
    expect(value.items[0].fast).toBe(true);
    expect(value.items[1].fast).toBe(false);
    expect(value.items[2].fast).toBeUndefined();
    expect(value.items[3].fast).toBeUndefined();
  });

  test('trims the product name', () => {
    const value = expectOk(basePayload({
      items: [{ ...VALID_ITEM, product: { ...VALID_ITEM.product, name: '  Retatrutide 5mg  ' } }],
    }));
    expect(value.items[0].product.name).toBe('Retatrutide 5mg');
  });
});

describe('validateOrderPayload — derived values', () => {
  test('itemCount sums the clamped quantities across lines', () => {
    const items = [
      { ...VALID_ITEM, quantity: 3 },
      { ...VALID_ITEM, quantity: 0 },      // clamps to 1
      { ...VALID_ITEM, quantity: 10000 },  // clamps to 9999
    ];
    expect(expectOk(basePayload({ items })).itemCount).toBe(3 + 1 + 9999);
  });

  test('grossSubtotalCents sums clamped unit price times clamped quantity', () => {
    const items = [
      { ...VALID_ITEM, quantity: 2, unitPriceCents: 2499 },
      { ...VALID_ITEM, quantity: 0, unitPriceCents: -100 }, // 1 * 0
      { ...VALID_ITEM, quantity: 3, unitPriceCents: 1000 },
    ];
    expect(expectOk(basePayload({ items })).grossSubtotalCents).toBe(2 * 2499 + 1 * 0 + 3 * 1000);
  });

  test('contactIsEmail is true for an email contact', () => {
    expect(expectOk(basePayload({ contact: 'buyer@example.com' })).contactIsEmail).toBe(true);
  });

  test('contactIsEmail is false for a phone contact', () => {
    expect(expectOk(basePayload({ contact: '555-0100' })).contactIsEmail).toBe(false);
  });

  test('cleanPayload carries trimmed fields and the normalized items array', () => {
    const value = expectOk(basePayload({
      name: '  Ray Buyer  ',
      contact: '  buyer@example.com  ',
      organization: '  VS Research  ',
      notes: '  gate code 4411  ',
      ship_street: ' 100 Lab Way ',
      ship_city: ' Austin ',
      ship_state: ' TX ',
      ship_zip: ' 78701 ',
    }));
    expect(value.cleanPayload).toEqual({
      name: 'Ray Buyer',
      contact: 'buyer@example.com',
      organization: 'VS Research',
      notes: 'gate code 4411',
      ship_street: '100 Lab Way',
      ship_city: 'Austin',
      ship_state: 'TX',
      ship_zip: '78701',
      ship_country: 'US',
      items: value.items,
    });
    // Same array instance — the handler appends server-generated free lines
    // to value.items and cleanPayload must see them.
    expect(value.cleanPayload.items).toBe(value.items);
  });

  test('cleanPayload drops empty optionals as undefined', () => {
    const { cleanPayload } = expectOk(basePayload());
    expect(cleanPayload.organization).toBeUndefined();
    expect(cleanPayload.notes).toBeUndefined();
    expect(cleanPayload.ship_street).toBeUndefined();
    expect(cleanPayload.ship_city).toBeUndefined();
    expect(cleanPayload.ship_state).toBeUndefined();
    expect(cleanPayload.ship_zip).toBeUndefined();
  });

  test('cleanPayload does not carry coupon or idempotency fields', () => {
    const { cleanPayload } = expectOk(basePayload({
      coupon_code: 'FREEBH2O',
      coupon_codes: ['FREEBH2O'],
      idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
    }));
    expect('coupon_code' in cleanPayload).toBe(false);
    expect('coupon_codes' in cleanPayload).toBe(false);
    expect('idempotency_key' in cleanPayload).toBe(false);
  });
});

describe('validateOrderPayload — attestation pass-through', () => {
  test('retains a sanitized snapshot for a valid attestation', () => {
    const value = expectOk(basePayload({ research_attestation: VALID_ATTESTATION }));
    expect(value.attestation).toMatchObject({
      accepted_at: '2026-07-17T12:00:00.000Z',
      disclaimer_version: 2,
      industry: 'biotech_pharma',
      age_21_confirmed: true,
      research_use_confirmed: true,
    });
  });

  test('nulls an invalid attestation (missing confirmations)', () => {
    const value = expectOk(basePayload({
      research_attestation: { accepted_at: '2026-07-17T12:00:00.000Z' },
    }));
    expect(value.attestation).toBeNull();
  });

  test('nulls a missing attestation', () => {
    expect(expectOk(basePayload()).attestation).toBeNull();
  });
});
