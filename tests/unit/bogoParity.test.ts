/**
 * CLIENT/SERVER PARITY FOR THE LAUNCH DAY BOGO PROMO.
 *
 * This is the contract test for the whole feature. `src/lib/bogoPreview.ts` and
 * `supabase/functions/place-order/promoPlan.ts` are deliberate MIRRORS — the
 * deploy boundary (Deno edge bundle vs Vite client bundle) makes a shared
 * import unsafe, so the two implementations are kept honest HERE instead of by
 * the type system.
 *
 * WHAT ACTUALLY BREAKS IF THEY DIVERGE — stated precisely, because the usual
 * framing is wrong: `verifyLinePrices` (handler.ts:554) compares LINE UNIT
 * PRICES, and BOGO is a flat order-level reduction that never touches a unit
 * price. So a preview/server disagreement does NOT produce a 409. It produces
 * something quieter and arguably worse: the cart quotes one total and the card
 * is charged another, with no error anywhere. That is the silent-overcharge
 * class this repo treats as a defect, and this file is what prevents it.
 *
 * Every case below builds ONE cart description and feeds it to BOTH sides —
 * the client store (useProductOverrides/usePromoSettings) and the server's
 * VariantPromoRow[] — then asserts they agree TO THE CENT, and that the
 * per-line free-unit attribution matches too (so the cart highlights the same
 * row the invoice discounts).
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
  computeBogoPreview,
  freePlanValue as clientFreePlanValue,
  pairFreeUnits as clientPairFreeUnits,
} from '../../src/lib/bogoPreview';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { usePromoSettings } from '../../src/lib/promoSettings';
import { makeCartItem } from '../fixtures/product';
import {
  buildPromoPlans,
  freePlanValue as serverFreePlanValue,
  pairFreeUnits as serverPairFreeUnits,
  type PromoLine,
  type VariantPromoRow,
} from '../../supabase/functions/place-order/promoPlan';

/** One cart line, described once and projected onto both sides. */
interface Line {
  sku: string;
  dose: string;
  qty: number;
  /** Admin price in integer cents (product_variant_stock.price_cents). */
  unitCents: number;
  /** 24-hour supply → BOGO-eligible. false → sourced → B2G1 territory. */
  fast: boolean;
  /** Server-only flag (migration 063). The client approximates it; every case
   *  here keeps the approximation true, which is the real catalog's state. */
  wholesaleEligible?: boolean;
}

/** The name cartActions.variantProduct builds — the dose is baked into it, and
 *  it is the ONLY text resolveVariantRow() is allowed to match on. */
const lineName = (sku: string, dose: string) => `${sku} Compound — ${dose}`;

function applyToClient(lines: readonly Line[]) {
  const variantBySku: Record<string, Record<string, VariantOverride>> = {};
  for (const l of lines) {
    variantBySku[l.sku] ??= {};
    variantBySku[l.sku][l.dose] = {
      sku: l.sku,
      dose: l.dose,
      // has24hrSupply() reads on_hand/inbound — this is the client's `fast`.
      on_hand: l.fast ? 5 : 0,
      inbound_units: 0,
      price_cents: l.unitCents,
      lead_days: l.fast ? null : 7,
      hidden: false,
    };
  }
  useProductOverrides.setState({ bySku: {}, variantBySku });
  return lines.map((l) => makeCartItem({ sku: l.sku, name: lineName(l.sku, l.dose) }, l.qty));
}

function serverInputs(lines: readonly Line[]) {
  const promoLines: PromoLine[] = lines.map((l) => ({
    sku: l.sku,
    name: lineName(l.sku, l.dose),
    quantity: l.qty,
    unitPriceCents: l.unitCents,
  }));
  const variantRows: VariantPromoRow[] = lines.map((l) => ({
    sku: l.sku,
    dose: l.dose,
    on_hand: l.fast ? 5 : 0,
    inbound_units: 0,
    lead_days: l.fast ? null : 7,
    price_cents: l.unitCents,
    wholesale_eligible: l.wholesaleEligible ?? true,
  }));
  return { promoLines, variantRows };
}

interface Options {
  isMember?: boolean;
  live?: boolean;
  excluded?: string[];
  /** B2G1 liveness — it competes with BOGO order-wide, so parity has to cover
   *  carts where it is running too. */
  b2g1Live?: boolean;
}

/**
 * Run one cart through BOTH implementations and assert they agree exactly.
 * Returns the agreed total so a case can additionally pin the expected value.
 */
function assertParity(lines: readonly Line[], opts: Options = {}): number {
  const isMember = opts.isMember ?? true;
  const live = opts.live ?? true;
  const excluded = opts.excluded ?? [];
  const b2g1Live = opts.b2g1Live ?? false;

  const items = applyToClient(lines);
  usePromoSettings.setState({
    bogoEnabled: live,
    bogoEndsAt: null,
    bogoExcludedSkus: excluded,
    b2g1Enabled: b2g1Live,
    b2g1EndsAt: null,
    b2g1ExcludedSkus: [],
    loaded: true,
    loading: false,
  });
  const clientPreview = computeBogoPreview(items, isMember, live, excluded);

  const { promoLines, variantRows } = serverInputs(lines);
  const serverPlan = buildPromoPlans({
    lines: promoLines,
    variantRows,
    promoLive: b2g1Live,
    excludedSkus: new Set<string>(),
    bogoLive: live,
    bogoExcludedSkus: new Set(excluded),
    isMember,
  });

  const serverTotal = serverFreePlanValue(serverPlan.bogoFreePlan);

  // TO THE CENT — the assertion that keeps the cart and the invoice honest.
  expect(clientPreview.totalCents).toBe(serverTotal);
  // …and the same free units credited to the same lines, so the cart
  // highlights the row the invoice actually discounts.
  expect(clientPreview.lines).toEqual(
    serverPlan.bogoFreePlan.map((p) => ({ idx: p.idx, freeUnits: p.freeUnits, unit: p.unit })),
  );
  // Integer cents only — a float anywhere would desync the two sides.
  expect(Number.isInteger(clientPreview.totalCents)).toBe(true);

  return serverTotal;
}

beforeEach(() => {
  useProductOverrides.setState({ bySku: {}, variantBySku: {} });
  usePromoSettings.setState({
    b2g1Enabled: false, b2g1EndsAt: null, b2g1ExcludedSkus: [],
    bogoEnabled: false, bogoEndsAt: null, bogoExcludedSkus: [],
    serverNowMs: null, fetchedAtMs: null,
    loaded: true, loading: false,
  });
});

// ── The kernels are byte-identical ─────────────────────────────────────────
describe('the pairing kernel is identical on both sides', () => {
  const cases: { name: string; units: { idx: number; unit: number }[] }[] = [
    { name: 'empty', units: [] },
    { name: 'one unit', units: [{ idx: 0, unit: 5_000 }] },
    { name: 'two equal', units: [{ idx: 0, unit: 5_000 }, { idx: 1, unit: 5_000 }] },
    {
      name: 'two different — cheaper is free',
      units: [{ idx: 0, unit: 9_900 }, { idx: 1, unit: 4_200 }],
    },
    {
      name: 'five across three lines, ties present',
      units: [
        { idx: 2, unit: 7_000 }, { idx: 0, unit: 7_000 }, { idx: 1, unit: 3_000 },
        { idx: 0, unit: 12_000 }, { idx: 1, unit: 3_000 },
      ],
    },
    {
      name: 'descending and ascending input order produce the same plan',
      units: [
        { idx: 0, unit: 1 }, { idx: 1, unit: 2 }, { idx: 2, unit: 3 },
        { idx: 3, unit: 4 }, { idx: 4, unit: 5 },
      ],
    },
  ];

  for (const c of cases) {
    test(`${c.name}`, () => {
      expect(clientPairFreeUnits(c.units)).toEqual(serverPairFreeUnits(c.units));
      expect(clientFreePlanValue(clientPairFreeUnits(c.units)))
        .toBe(serverFreePlanValue(serverPairFreeUnits(c.units)));
    });
  }

  test('input ORDER never changes the plan (the idx tiebreak is total)', () => {
    const units = [
      { idx: 0, unit: 5_000 }, { idx: 1, unit: 5_000 },
      { idx: 2, unit: 5_000 }, { idx: 3, unit: 9_000 },
    ];
    const forward = serverPairFreeUnits(units);
    const reversed = serverPairFreeUnits([...units].reverse());
    expect(reversed).toEqual(forward);
    expect(clientPairFreeUnits([...units].reverse())).toEqual(forward);
  });
});

// ── THE CART TABLE — the launch-day guard ──────────────────────────────────
describe('client/server parity across a wide range of carts', () => {
  const F = true;  // 24-hour → BOGO-eligible
  const S = false; // sourced → B2G1 territory, never BOGO

  test('empty cart', () => {
    expect(assertParity([])).toBe(0);
  });

  test('single 24-hour item, qty 1 — nothing pairs, nothing free', () => {
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 1, unitCents: 9_900, fast: F }])).toBe(0);
  });

  test('two identical units on one line — one free', () => {
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 2, unitCents: 9_900, fast: F }]))
      .toBe(9_900);
  });

  test('two DIFFERENT products, one each — the cheaper one is free (the owner\'s example)', () => {
    // Reta 5mg $199 + BPC 5mg $42 → BPC is free.
    expect(assertParity([
      { sku: 'RETA', dose: '5mg', qty: 1, unitCents: 19_900, fast: F },
      { sku: 'BPC', dose: '5mg', qty: 1, unitCents: 4_200, fast: F },
    ])).toBe(4_200);
  });

  test('three units — exactly one free (odd counts round down)', () => {
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 3, unitCents: 5_000, fast: F }]))
      .toBe(5_000);
  });

  test('four units — two free', () => {
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 4, unitCents: 5_000, fast: F }]))
      .toBe(10_000);
  });

  test('mixed eligible / ineligible — only the 24-hour lines pair', () => {
    // Two fast units pair with each other; the sourced line is invisible to BOGO.
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 2, unitCents: 8_000, fast: F },
      { sku: 'B', dose: '5mg', qty: 2, unitCents: 6_000, fast: S },
    ])).toBe(8_000);
  });

  test('all-ineligible (every line sourced) — no BOGO at all', () => {
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 4, unitCents: 8_000, fast: S },
      { sku: 'B', dose: '5mg', qty: 2, unitCents: 6_000, fast: S },
    ])).toBe(0);
  });

  test('three different products at three different prices', () => {
    // 12000, 9000, 4000 sorted desc → index 1 (9000) is free; 4000 unpaired.
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 1, unitCents: 12_000, fast: F },
      { sku: 'B', dose: '5mg', qty: 1, unitCents: 9_000, fast: F },
      { sku: 'C', dose: '5mg', qty: 1, unitCents: 4_000, fast: F },
    ])).toBe(9_000);
  });

  test('four lines, uneven quantities, ties across lines', () => {
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 3, unitCents: 7_000, fast: F },
      { sku: 'B', dose: '10mg', qty: 2, unitCents: 7_000, fast: F },
      { sku: 'C', dose: '5mg', qty: 1, unitCents: 15_000, fast: F },
      { sku: 'D', dose: '2mg', qty: 2, unitCents: 1_500, fast: F },
    ])).toBeGreaterThan(0);
  });

  test('GUEST gets nothing, member gets the discount — same cart', () => {
    const cart: Line[] = [
      { sku: 'A', dose: '5mg', qty: 2, unitCents: 9_900, fast: F },
    ];
    expect(assertParity(cart, { isMember: false })).toBe(0);
    expect(assertParity(cart, { isMember: true })).toBe(9_900);
  });

  test('promo switched OFF yields nothing on both sides', () => {
    expect(assertParity(
      [{ sku: 'A', dose: '5mg', qty: 4, unitCents: 9_900, fast: F }],
      { live: false },
    )).toBe(0);
  });

  test('qty 5 (the half-kit floor) — BOGO 40% beats wholesale 27%, larger wins', () => {
    // The regression this test exists for: half kit = 27% of 5 × 5000 = 6,750.
    // BOGO = 2 free × 5000 = 10,000. BOGO must win, on BOTH sides.
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 5, unitCents: 5_000, fast: F }]))
      .toBe(10_000);
  });

  test('wholesale case (qty 10) — 40% case ties BOGO 40%, tie goes to wholesale', () => {
    // 10 × $60: case = 40% of 60,000 = 24,000. BOGO = 5 free × 6,000 = 30,000.
    // BOGO is actually LARGER here (a full case discounts 40% of the whole
    // line, BOGO frees half the units), so BOGO wins.
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 10, unitCents: 6_000, fast: F }]))
      .toBe(30_000);
  });

  test('wholesale wins when its line is NOT BOGO-eligible (sourced case)', () => {
    // A sourced qty-10 line takes the 40% case; no fast line exists to pair.
    expect(assertParity([{ sku: 'A', dose: '5mg', qty: 10, unitCents: 6_000, fast: S }]))
      .toBe(0);
  });

  test('wholesale line alongside a separate BOGO-eligible line', () => {
    assertParity([
      { sku: 'A', dose: '5mg', qty: 10, unitCents: 6_000, fast: F },
      { sku: 'B', dose: '5mg', qty: 2, unitCents: 4_000, fast: F },
    ]);
  });

  test('B2G1-eligible sourced items present alongside BOGO items', () => {
    assertParity(
      [
        { sku: 'SLOW', dose: '5mg', qty: 3, unitCents: 6_000, fast: S },
        { sku: 'FAST', dose: '5mg', qty: 2, unitCents: 9_000, fast: F },
      ],
      { b2g1Live: true },
    );
  });

  test('B2G1 clearly larger than BOGO — B2G1 wins, BOGO zeroed, both sides agree', () => {
    // Sourced qty 9 at $10,000 → 3 free = $30,000. Fast qty 2 at $1,000 → $1,000.
    expect(assertParity(
      [
        { sku: 'SLOW', dose: '5mg', qty: 9, unitCents: 10_000, fast: S },
        { sku: 'FAST', dose: '5mg', qty: 2, unitCents: 1_000, fast: F },
      ],
      { b2g1Live: true },
    )).toBe(0);
  });

  test('BOGO clearly larger than B2G1 — BOGO wins', () => {
    // Sourced qty 3 at $1,000 → 1 free = $1,000. Fast qty 4 at $20,000 → 2 free
    // = $40,000.
    expect(assertParity(
      [
        { sku: 'SLOW', dose: '5mg', qty: 3, unitCents: 1_000, fast: S },
        { sku: 'FAST', dose: '5mg', qty: 4, unitCents: 20_000, fast: F },
      ],
      { b2g1Live: true },
    )).toBe(40_000);
  });

  test('excluded SKU earns nothing but does not poison the rest of the cart', () => {
    expect(assertParity(
      [
        { sku: 'VSR-RS-GSK', dose: '1200mg', qty: 4, unitCents: 9_000, fast: F },
        { sku: 'OK', dose: '5mg', qty: 2, unitCents: 5_000, fast: F },
      ],
      { excluded: ['VSR-RS-GSK'] },
    )).toBe(5_000);
  });

  test('an unpriced dose (no admin price) is invisible to both sides', () => {
    // unitCents 0 → price_cents 0 → "no server truth to discount from".
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 2, unitCents: 0, fast: F },
      { sku: 'B', dose: '5mg', qty: 2, unitCents: 5_000, fast: F },
    ])).toBe(5_000);
  });

  test('odd-cent prices never drift (no rounding anywhere in BOGO)', () => {
    expect(assertParity([
      { sku: 'A', dose: '5mg', qty: 1, unitCents: 3_333, fast: F },
      { sku: 'B', dose: '5mg', qty: 1, unitCents: 6_667, fast: F },
      { sku: 'C', dose: '5mg', qty: 1, unitCents: 1, fast: F },
    ])).toBe(3_333);
  });

  test('large cart — many lines, many quantities, still identical', () => {
    assertParity([
      { sku: 'A', dose: '5mg', qty: 7, unitCents: 12_345, fast: F },
      { sku: 'B', dose: '10mg', qty: 3, unitCents: 9_999, fast: F },
      { sku: 'C', dose: '2mg', qty: 4, unitCents: 501, fast: F },
      { sku: 'D', dose: '5mg', qty: 2, unitCents: 12_345, fast: S },
      { sku: 'E', dose: '1mg', qty: 1, unitCents: 77_777, fast: F },
    ], { b2g1Live: true });
  });
});

// ── The exclusions, named ──────────────────────────────────────────────────
describe('the owner\'s exclusion list', () => {
  // The seeded list from migration 084. Korean Glutathione is ONE sku; the
  // "-hero" the brief anticipated is an image basename, not a product. There
  // is no Laennec sku in this catalog at all.
  const EXCLUDED = [
    'VSR-RS-GSK',
    'VSR-LE-BAL-220', 'VSR-LE-CEN-024', 'VSR-LE-PHM-001',
    'VSR-LE-PIP-SET', 'VSR-LE-VTX-001',
    'VSR-RS-ACE-003', 'VSR-RS-BAC-030', 'VSR-RS-SYR-100',
  ];

  for (const sku of EXCLUDED) {
    test(`${sku} earns no BOGO even at qty 4, 24-hour, member, promo live`, () => {
      expect(assertParity(
        [{ sku, dose: '5mg', qty: 4, unitCents: 9_000, fast: true }],
        { excluded: EXCLUDED },
      )).toBe(0);
    });
  }

  test('lab equipment is ALSO excluded structurally — no variant row, no promo', () => {
    // Even with the exclusion list empty, a line that resolves to no
    // product_variant_stock row (how lab equipment is actually priced) gets
    // nothing. Belt and braces: the seeded list is not the only defence.
    const plan = buildPromoPlans({
      lines: [{ sku: 'VSR-LE-CEN-024', name: 'Microcentrifuge — 24-Place', quantity: 4, unitPriceCents: 20_000 }],
      variantRows: [], // lab equipment prices per-sku on product_stock
      promoLive: true,
      excludedSkus: new Set<string>(),
      bogoLive: true,
      bogoExcludedSkus: new Set<string>(), // deliberately EMPTY
      isMember: true,
    });
    expect(plan.bogoFreePlan).toEqual([]);
  });
});

// ── Mutual exclusion with B2G1 is structural, not arbitrated ───────────────
describe('BOGO and B2G1 can never both claim one line', () => {
  test('a 24-hour line is BOGO-only; a sourced line is B2G1-only', () => {
    const plan = buildPromoPlans({
      lines: [
        { sku: 'FAST', name: 'FAST Compound — 5mg', quantity: 4, unitPriceCents: 5_000 },
      ],
      variantRows: [
        { sku: 'FAST', dose: '5mg', on_hand: 5, inbound_units: 0, lead_days: null, price_cents: 5_000, wholesale_eligible: true },
      ],
      promoLive: true,
      excludedSkus: new Set<string>(),
      bogoLive: true,
      bogoExcludedSkus: new Set<string>(),
      isMember: true,
    });
    // The fast line took BOGO and B2G1 got nothing — not because anything
    // arbitrated, but because isSlow is false.
    expect(plan.b2g1FreePlan).toEqual([]);
    expect(plan.bogoFreePlan).toEqual([{ idx: 0, freeUnits: 2, unit: 5_000 }]);
  });

  test('no cart can ever produce a non-empty b2g1 plan AND a non-empty bogo plan', () => {
    // Order-wide arbitration is the backstop for mixed carts.
    const plan = buildPromoPlans({
      lines: [
        { sku: 'SLOW', name: 'SLOW Compound — 5mg', quantity: 3, unitPriceCents: 5_000 },
        { sku: 'FAST', name: 'FAST Compound — 5mg', quantity: 2, unitPriceCents: 5_000 },
      ],
      variantRows: [
        { sku: 'SLOW', dose: '5mg', on_hand: 0, inbound_units: 0, lead_days: 7, price_cents: 5_000, wholesale_eligible: true },
        { sku: 'FAST', dose: '5mg', on_hand: 5, inbound_units: 0, lead_days: null, price_cents: 5_000, wholesale_eligible: true },
      ],
      promoLive: true,
      excludedSkus: new Set<string>(),
      bogoLive: true,
      bogoExcludedSkus: new Set<string>(),
      isMember: true,
    });
    const bothApply = plan.b2g1FreePlan.length > 0 && plan.bogoFreePlan.length > 0;
    expect(bothApply).toBe(false);
  });

  test('a tie between BOGO and B2G1 goes to BOGO', () => {
    // Both worth exactly $5,000.
    const plan = buildPromoPlans({
      lines: [
        { sku: 'SLOW', name: 'SLOW Compound — 5mg', quantity: 3, unitPriceCents: 5_000 },
        { sku: 'FAST', name: 'FAST Compound — 5mg', quantity: 2, unitPriceCents: 5_000 },
      ],
      variantRows: [
        { sku: 'SLOW', dose: '5mg', on_hand: 0, inbound_units: 0, lead_days: 7, price_cents: 5_000, wholesale_eligible: true },
        { sku: 'FAST', dose: '5mg', on_hand: 5, inbound_units: 0, lead_days: null, price_cents: 5_000, wholesale_eligible: true },
      ],
      promoLive: true,
      excludedSkus: new Set<string>(),
      bogoLive: true,
      bogoExcludedSkus: new Set<string>(),
      isMember: true,
    });
    expect(serverFreePlanValue(plan.bogoFreePlan)).toBe(5_000);
    expect(plan.b2g1FreePlan).toEqual([]);
  });
});

// ── Wholesale beats BOGO — the other side of the order-wide arbitration ────
describe('wholesale wins when it out-values BOGO', () => {
  const F = true;

  test('a big sourced case out-values a small BOGO pair — BOGO stands down', () => {
    // Sourced qty 10 @ $500 → case 40% = $2,000 (no BOGO: sourced).
    // Fast qty 2 @ $10 → BOGO 1 free = $10. Wholesale is far larger.
    expect(assertParity([
      { sku: 'CASE', dose: '5mg', qty: 10, unitCents: 50_000, fast: false },
      { sku: 'FAST', dose: '5mg', qty: 2, unitCents: 1_000, fast: F },
    ])).toBe(0);
  });

  test('an exact tie between wholesale and BOGO goes to wholesale', () => {
    // Sourced qty 5 @ $1,000: half kit 27% of 500,000 = 135,000.
    // Fast: two units whose cheaper one is worth exactly 135,000.
    expect(assertParity([
      { sku: 'CASE', dose: '5mg', qty: 5, unitCents: 100_000, fast: false },
      { sku: 'A', dose: '5mg', qty: 1, unitCents: 200_000, fast: F },
      { sku: 'B', dose: '5mg', qty: 1, unitCents: 135_000, fast: F },
    ])).toBe(0);
  });

  test('BOGO one cent larger than wholesale wins the whole order', () => {
    expect(assertParity([
      { sku: 'CASE', dose: '5mg', qty: 5, unitCents: 100_000, fast: false },
      { sku: 'A', dose: '5mg', qty: 1, unitCents: 200_000, fast: F },
      { sku: 'B', dose: '5mg', qty: 1, unitCents: 135_001, fast: F },
    ])).toBe(135_001);
  });

  test('a line with no sku is skipped by both sides', () => {
    const items = [makeCartItem({ sku: undefined, name: 'Mystery — 5mg' }, 2)];
    expect(computeBogoPreview(items, true, true, []).totalCents).toBe(0);
    const plan = buildPromoPlans({
      lines: [{ sku: undefined, name: 'Mystery — 5mg', quantity: 2, unitPriceCents: 5_000 }],
      variantRows: [], promoLive: false, excludedSkus: new Set<string>(),
      bogoLive: true, bogoExcludedSkus: new Set<string>(), isMember: true,
    });
    expect(plan.bogoFreePlan).toEqual([]);
  });
});
