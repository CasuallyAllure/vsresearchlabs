/**
 * Unit tests for src/lib/cartActions.ts — the variant-aware cart helpers.
 *
 * Pins three production-incident invariants:
 *
 *   1. Add-to-cart MUST go through `variantProduct(product, dose)`. A bare
 *      `add(product)` once dropped the buyer's dose: deriveProductDose()
 *      resolved "" for multi-variant families, the per-(sku,dose) override
 *      lookup missed, and every order line was written at $0 (see the
 *      cart-variant-dose incident). The "$0 regression" block below proves
 *      the failure mode still exists for a bare product and that
 *      variantProduct fixes it.
 *   2. The public price path is `effectiveTierPriceCents` (admin override
 *      wins), never the bare `tierPriceCents` formula — variantProduct must
 *      bake the OVERRIDE price into the line.
 *   3. `cartSubtotalCents` = Σ lineUnitCents × quantity is the single client
 *      source of truth for the subtotal (CartDrawer + CartPage both read it).
 *
 * The overrides store is a Zustand singleton; tests seed it directly via
 * `useProductOverrides.setState(...)` and reset it between tests. The
 * supabase seam is mocked to `null` so no client is ever constructed (the
 * checked-in .env carries real credentials; tests/setup.ts would make any
 * accidental network call throw anyway).
 *
 * Also covers the last uncovered branch of src/lib/pricing.ts: a zero-mg
 * dose on a product whose own priceCents is null returns null (the `?? null`
 * arm of the mg<=0 guard).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({ supabase: null }));

import {
  canQuickAdd,
  cartHasMixedShipping,
  cartSubtotalCents,
  lineIsFast,
  lineIsWholesale,
  lineUnitCents,
  resolveSellableDose,
  rewardCreditPreview,
  variantProduct,
} from '../../src/lib/cartActions';
import { tierPriceCents } from '../../src/lib/pricing';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { makeProduct } from '../fixtures/product';

// Formula derivation (mirrors pricing.test.ts): perMg = 7 + (hashKey(id) % 6),
// base = 20, price = round(base + mg*perMg) * 100.
// hashKey('test-product-a') % 6 === 2 → perMg = 9:
//   '10mg' → (20 + 10*9) * 100 = 11000
//   '5mg'  → (20 +  5*9) * 100 =  6500
const FORMULA_ID = 'test-product-a';
const SKU = 'VSR-TEST-A';

const INITIAL_STATE = {
  bySku: {},
  variantBySku: {},
  loaded: true,
  loading: false,
  error: null,
};

/** Full VariantOverride row with sane defaults. */
function makeVariantOverride(
  sku: string,
  dose: string,
  overrides: Partial<VariantOverride> = {},
): VariantOverride {
  return {
    sku,
    dose,
    on_hand: 0,
    inbound_units: 0,
    price_cents: null,
    lead_days: null,
    hidden: false,
    ...overrides,
  };
}

/** Seeds per-dose override rows for one SKU. */
function seedVariants(sku: string, rows: Record<string, Partial<VariantOverride>>): void {
  const bySku: Record<string, VariantOverride> = {};
  for (const [dose, over] of Object.entries(rows)) {
    bySku[dose] = makeVariantOverride(sku, dose, over);
  }
  useProductOverrides.setState({ variantBySku: { [sku]: bySku } });
}

beforeEach(() => {
  // Merge (not replace) so the store's load/reload/getOverride actions survive.
  useProductOverrides.setState(INITIAL_STATE);
});

describe('variantProduct — baking the selected dose into the cart line', () => {
  test('returns the product unchanged when dose is undefined', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU });

    expect(variantProduct(product)).toBe(product);
  });

  test('returns the product unchanged when dose is empty or whitespace', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU });

    expect(variantProduct(product, '')).toBe(product);
    expect(variantProduct(product, '   ')).toBe(product);
  });

  test('bakes the dose into id and name so deriveProductDose resolves it downstream', () => {
    // Arrange — a multi-variant family whose display name carries no dose.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157', priceCents: null });

    // Act
    const line = variantProduct(product, '10mg');

    // Assert — distinct doses become distinct cart lines; the dose rides in the name.
    expect(line.id).toBe(`${FORMULA_ID}::10mg`);
    expect(line.name).toBe('BPC-157 — 10mg');
  });

  test('does not mutate the original product', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157' });
    const before = { ...product };

    variantProduct(product, '10mg');

    expect(product).toEqual(before);
  });

  test('trims the dose before baking it in', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157' });

    const line = variantProduct(product, '  10mg  ');

    expect(line.id).toBe(`${FORMULA_ID}::10mg`);
    expect(line.name).toBe('BPC-157 — 10mg');
  });

  test('carries the ADMIN OVERRIDE price, not the tierPriceCents formula (price-path invariant)', () => {
    // Arrange — admin set 8888 for (sku, 10mg); the formula says 11000.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157', priceCents: null });
    seedVariants(SKU, { '10mg': { price_cents: 8888 } });

    // Act
    const line = variantProduct(product, '10mg');

    // Assert — effectiveTierPriceCents (override) wins over the raw formula.
    expect(line.priceCents).toBe(8888);
    expect(line.priceCents).not.toBe(tierPriceCents(product, '10mg'));
  });

  test('falls back to the formula price when no admin override exists', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157', priceCents: null });

    const line = variantProduct(product, '10mg');

    expect(line.priceCents).toBe(11000);
  });

  test('does not double-append the dose when the name already carries one', () => {
    // Single-variant products are stored as "Name — 5mg" already.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'Solo Peptide — 5mg', priceCents: null });

    const line = variantProduct(product, '5mg');

    expect(line.name).toBe('Solo Peptide — 5mg');
    expect(line.id).toBe(`${FORMULA_ID}::5mg`);
    expect(line.priceCents).toBe(6500);
  });

  test('falls back to product.priceCents ?? null when the dose resolves no price', () => {
    // A non-mg dose with no override and no own price → line price stays null
    // (the caller guards against adding a $0 line via canQuickAdd).
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'Mixer', priceCents: null });

    const line = variantProduct(product, 'Benchtop');

    expect(line.priceCents).toBeNull();
  });
});

describe('resolveSellableDose — what a quick-add "+" actually adds', () => {
  test('keeps the passed dose when it already resolves to a real price (equipment headline)', () => {
    // "Benchtop" has no mg magnitude → tierPriceCents falls back to priceCents.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: 4999 });

    expect(resolveSellableDose(product, 'Benchtop')).toBe('Benchtop');
  });

  test('resolves an EMPTY headline to the first publicly-priced variant dose', () => {
    // The catalog "+" passes "" for a multi-dose family — the incident case.
    const product = makeProduct({
      id: FORMULA_ID,
      sku: SKU,
      priceCents: null,
      variants: [{ dose: '5mg' }, { dose: '10mg' }],
    });

    expect(resolveSellableDose(product, '')).toBe('5mg');
    expect(resolveSellableDose(product)).toBe('5mg');
  });

  test('skips a non-public (hidden) variant and returns the next priced one', () => {
    const product = makeProduct({
      id: FORMULA_ID,
      sku: SKU,
      priceCents: null,
      variants: [{ dose: '5mg' }, { dose: '10mg' }],
    });
    seedVariants(SKU, {
      '5mg': { price_cents: 5000, hidden: true },
      '10mg': { price_cents: 9000 },
    });

    expect(resolveSellableDose(product, '')).toBe('10mg');
  });

  test('skips a public but priceless variant (no formula fallback for non-mg doses)', () => {
    // "30 mL" is public via lead_days but has no admin price and no mg
    // magnitude, so effectiveTierPriceCents is null → not sellable by "+".
    const product = makeProduct({
      id: FORMULA_ID,
      sku: SKU,
      priceCents: null,
      variants: [{ dose: '30 mL' }, { dose: '10mg' }],
    });
    seedVariants(SKU, {
      '30 mL': { lead_days: 7 },
      '10mg': { price_cents: 9000 },
    });

    expect(resolveSellableDose(product, '')).toBe('10mg');
  });

  test('returns the passed dose unchanged when nothing sellable resolves', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: null, variants: [] });

    expect(resolveSellableDose(product, 'Benchtop')).toBe('Benchtop');
    expect(resolveSellableDose(product, '')).toBe('');
  });
});

describe('canQuickAdd — refuses to add a $0 line', () => {
  test('true when the dose resolves a real price', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: null });

    expect(canQuickAdd(product, '10mg')).toBe(true);
  });

  test('true for a single-config product with its own priceCents and no variants', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: null, variants: [] });
    // Dose resolves nothing, but the product itself is priced.
    const priced = { ...product, priceCents: 4999 };

    // "Box of 100" carries no mg magnitude → tierPriceCents returns
    // priceCents (4999) → true via the price branch AND the no-variant branch.
    expect(canQuickAdd(priced, 'Box of 100')).toBe(true);
  });

  test('false for a multi-variant product when no priced dose resolves', () => {
    const product = makeProduct({
      id: FORMULA_ID,
      sku: SKU,
      priceCents: null,
      variants: [{ dose: '5mg' }],
    });

    // Empty dose → no override, no mg magnitude, priceCents null → null price;
    // the product HAS variants, so a "+" must open the dose picker instead.
    expect(canQuickAdd(product, '')).toBe(false);
  });

  test('false for a variant-less product with no price at all', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: null, variants: [] });

    expect(canQuickAdd(product, '')).toBe(false);
  });
});

describe('lineUnitCents — resolution order (live override → add-time snapshot → formula → 0)', () => {
  test('1. a live admin override for (sku, dose) beats the add-time snapshot price', () => {
    // Buyer added at 9999; admin then changed the price to 8888.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg', priceCents: 9999 });
    seedVariants(SKU, { '10mg': { price_cents: 8888 } });

    expect(lineUnitCents({ product })).toBe(8888);
  });

  test('2. falls back to the add-time snapshot price when the override store is empty', () => {
    // The deep-link-to-/cart case: overrides not loaded → snapshot must win
    // over the formula so a correct admin price is not clobbered.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg', priceCents: 9999 });

    expect(lineUnitCents({ product })).toBe(9999);
    expect(lineUnitCents({ product })).not.toBe(tierPriceCents(product, '10mg'));
  });

  test('3. falls back to the placeholder formula when there is no override and no snapshot', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg', priceCents: null });

    expect(lineUnitCents({ product })).toBe(11000);
  });

  test('4. resolves 0 as the last resort when every source is null', () => {
    // Non-mg dose, no override, no snapshot → tierPriceCents null → 0.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'Mixer — Benchtop', priceCents: null });

    expect(lineUnitCents({ product })).toBe(0);
  });
});

describe('$0-order-line regression — the cart-variant-dose incident', () => {
  test('a BARE multi-variant product (dose never baked in) still degrades to $0 — variantProduct is mandatory', () => {
    // Arrange — admin priced (sku, 10mg); the family name carries no dose.
    const bare = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157', priceCents: null });
    seedVariants(SKU, { '10mg': { price_cents: 8888 } });

    // Act / Assert — deriveProductDose("BPC-157") = "" → override lookup
    // misses → no snapshot → formula on "" is null → 0. This is exactly the
    // production bug a bare add(product) caused.
    expect(lineUnitCents({ product: bare })).toBe(0);

    // The fix: the same add routed through variantProduct carries the dose
    // in the name, so the override resolves and the line is priced.
    const line = variantProduct(bare, '10mg');
    expect(lineUnitCents({ product: line })).toBe(8888);
  });
});

describe('cartSubtotalCents — the single client source of truth', () => {
  test('returns 0 for an empty cart', () => {
    expect(cartSubtotalCents([])).toBe(0);
  });

  test('sums lineUnitCents × quantity across mixed lines', () => {
    // Arrange — one overridden line, one snapshot line, one formula line.
    seedVariants(SKU, { '10mg': { price_cents: 8888 } });
    const overridden = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg', priceCents: null });
    const snapshot = makeProduct({ id: 'snap', sku: 'VSR-SNAP', name: 'GHK-Cu — 50mg', priceCents: 12000 });
    const formula = makeProduct({ id: FORMULA_ID, sku: 'VSR-FORM', name: 'TB-500 — 5mg', priceCents: null });
    const items = [
      { product: overridden, quantity: 2 }, // 8888 × 2
      { product: snapshot, quantity: 1 }, // 12000 × 1
      { product: formula, quantity: 3 }, // 6500 × 3
    ];

    // Act
    const subtotal = cartSubtotalCents(items);

    // Assert — Σ lineUnitCents × qty, and internally consistent with lineUnitCents.
    expect(subtotal).toBe(8888 * 2 + 12000 + 6500 * 3);
    expect(subtotal).toBe(items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0));
  });
});

describe('lineIsWholesale — account-gated pack quantities', () => {
  const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });

  test('true for a member at the smallest pack size (half kit, 5) and above', () => {
    expect(lineIsWholesale({ product, quantity: 5 }, true)).toBe(true);
    expect(lineIsWholesale({ product, quantity: 10 }, true)).toBe(true);
  });

  test('false for a member below pack quantity', () => {
    expect(lineIsWholesale({ product, quantity: 4 }, true)).toBe(false);
  });

  test('false for a guest even at pack quantity (wholesale is account-gated)', () => {
    expect(lineIsWholesale({ product, quantity: 10 }, false)).toBe(false);
  });

  test('false when quantity is missing, and defaults isMember to false', () => {
    expect(lineIsWholesale({ product }, true)).toBe(false);
    expect(lineIsWholesale({ product, quantity: 10 })).toBe(false);
  });
});

describe('lineIsFast — 24-hour badge for a cart line', () => {
  test('true when the (sku, dose) has on-hand supply', () => {
    seedVariants(SKU, { '10mg': { price_cents: 8888, on_hand: 3 } });
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });

    expect(lineIsFast({ product, quantity: 1 })).toBe(true);
  });

  test('true when supply is inbound (in transit counts as inventory)', () => {
    seedVariants(SKU, { '10mg': { price_cents: 8888, on_hand: 0, inbound_units: 5 } });
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });

    expect(lineIsFast({ product, quantity: 1 })).toBe(true);
  });

  test('false for a sourced dose (tracked, no 24-hour supply)', () => {
    seedVariants(SKU, { '10mg': { price_cents: 8888, lead_days: 7 } });
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });

    expect(lineIsFast({ product, quantity: 1 })).toBe(false);
  });

  test('false for an untracked dose (no per-dose row at all)', () => {
    const product = makeProduct({ id: FORMULA_ID, sku: 'VSR-UNTRACKED', name: 'BPC-157 — 10mg' });

    expect(lineIsFast({ product, quantity: 1 })).toBe(false);
  });

  test('a wholesale line is NEVER fast, even when the dose ships 24-hour at retail', () => {
    // The whole case is sourced together → always 7–10 business days.
    seedVariants(SKU, { '10mg': { price_cents: 8888, on_hand: 20 } });
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });

    expect(lineIsFast({ product, quantity: 1 }, true)).toBe(true); // retail qty: fast
    expect(lineIsFast({ product, quantity: 5 }, true)).toBe(false); // pack qty: wholesale
  });
});

describe('cartHasMixedShipping — separate-shipments warning', () => {
  const fastProduct = makeProduct({ id: FORMULA_ID, sku: SKU, name: 'BPC-157 — 10mg' });
  const slowProduct = makeProduct({ id: 'slow', sku: 'VSR-SLOW', name: 'TB-500 — 5mg' });

  beforeEach(() => {
    seedVariants(SKU, { '10mg': { price_cents: 8888, on_hand: 3 } });
  });

  test('true when the cart mixes fast and standard lines, in either order', () => {
    const fast = { product: fastProduct, quantity: 1 };
    const slow = { product: slowProduct, quantity: 1 };

    expect(cartHasMixedShipping([fast, slow])).toBe(true);
    expect(cartHasMixedShipping([slow, fast])).toBe(true);
  });

  test('false when every line is fast', () => {
    expect(cartHasMixedShipping([{ product: fastProduct, quantity: 2 }])).toBe(false);
  });

  test('false when every line is standard', () => {
    expect(cartHasMixedShipping([{ product: slowProduct, quantity: 1 }])).toBe(false);
  });

  test('false for an empty cart', () => {
    expect(cartHasMixedShipping([])).toBe(false);
  });

  test('a member buying a fast dose at pack quantity makes the line standard (no mix with other standard lines)', () => {
    const packLine = { product: fastProduct, quantity: 5 };
    const slow = { product: slowProduct, quantity: 1 };

    expect(cartHasMixedShipping([packLine, slow], true)).toBe(false);
  });
});

describe('rewardCreditPreview — the reward voucher\'s "40% off one item" line', () => {
  test('picks the line with the highest unit price', () => {
    const cheap = makeProduct({ id: 'a', sku: 'VSR-A', name: 'Cheap', priceCents: 5000 });
    const pricey = makeProduct({ id: 'b', sku: 'VSR-B', name: 'Pricey', priceCents: 9000 });
    const items = [{ product: cheap }, { product: pricey }];

    expect(rewardCreditPreview(items, 40)).toEqual({ name: 'Pricey', cents: 3600 });
  });

  test('ties keep the first line seen', () => {
    const first = makeProduct({ id: 'a', sku: 'VSR-A', name: 'First', priceCents: 8000 });
    const second = makeProduct({ id: 'b', sku: 'VSR-B', name: 'Second', priceCents: 8000 });
    const items = [{ product: first }, { product: second }];

    expect(rewardCreditPreview(items, 40)).toEqual({ name: 'First', cents: 3200 });
  });

  test('rounds the discount to the nearest cent', () => {
    const product = makeProduct({ id: 'a', sku: 'VSR-A', name: 'Rounded', priceCents: 12341 });

    expect(rewardCreditPreview([{ product }], 40)).toEqual({ name: 'Rounded', cents: 4936 });
  });

  test('returns null for an empty cart', () => {
    expect(rewardCreditPreview([], 40)).toBeNull();
  });

  test('returns null when the credit rounds to zero or less', () => {
    const product = makeProduct({ id: 'a', sku: 'VSR-A', name: 'Free', priceCents: 0 });

    expect(rewardCreditPreview([{ product }], 40)).toBeNull();
  });
});

describe('pricing.ts — remaining branch: zero-mg dose with no own price', () => {
  test('tierPriceCents returns null for a 0mg dose when priceCents is null', () => {
    // The mg <= 0 guard's `product.priceCents ?? null` arm with a null
    // priceCents — the one branch pricing.test.ts leaves uncovered.
    const product = makeProduct({ id: FORMULA_ID, sku: SKU, priceCents: null });

    expect(tierPriceCents(product, '0mg')).toBeNull();
  });
});
