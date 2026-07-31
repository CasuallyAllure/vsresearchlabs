/**
 * preparedCart — the pure logic behind an admin-built member cart.
 *
 * A prepared cart is a SHOPPING LIST, NOT A QUOTE: it travels as
 * `(sku, dose, quantity)` and nothing else (migration 081). Everything about
 * money is resolved live — here for DISPLAY, and again server-side at checkout,
 * which is the only figure that bills.
 *
 * Three jobs, all pure so they can be tested without a store, a page or a
 * network:
 *
 *   1. `buildVariantIndex` — the compound → dose enumeration the admin picks
 *      from. Extracted from AdminNewOrder.tsx so the composer never asks an
 *      admin to type a SKU, and so a third hand-rolled copy of that index does
 *      not appear (OrderView's ItemizedEditor is the second; repointing it is a
 *      separate, money-adjacent change and is deliberately not done here).
 *
 *   2. `memberUnitPriceCents` / `priceLines` — what THIS member actually pays,
 *      so the owner sees the real number before sending. Base price is always
 *      `effectiveTierPriceCents` (an admin per-dose override wins); the
 *      formula-only `tierPriceCents` is NEVER used directly — it is the
 *      placeholder hash (`perMg = 7 + hash % 6`) that ignores overrides and has
 *      caused two separate production price bugs.
 *
 *   3. `planPreparedCart` — THE CLAIM SEAM. Maps stored lines back to
 *      `(product, dose, quantity)` triples the cart can add via
 *      `variantProduct(product, dose)`. A bare `add()` drops the dose and wrote
 *      $0 order lines in production (src/lib/cartActions.ts:1-24 is the
 *      incident); this mapper refuses to emit a line it cannot dose, mirroring
 *      `planReorder`'s `skipped` contract rather than guessing.
 *
 * DISPLAY ONLY. Nothing here changes what a member is charged. place-order
 * re-resolves every price, the account discount (effective_customer_discount,
 * 074) and any coupon server-side, and fails closed on a mismatch.
 */

import type { Product } from '../types';
import { effectiveTierPriceCents } from './pricing';
import { doseAvailability, isVariantPublic, type DoseAvailability } from './productOverrides';

/** The stored shape. `dose` is '' for single-config products (equipment), the
 *  same contract `variantProduct` honours by passing those through unchanged. */
export interface PreparedCartLine {
  sku: string;
  dose: string;
  quantity: number;
}

/**
 * The shipping tier of a specific (sku, dose), reusing `doseAvailability`'s own
 * three states verbatim rather than minting a fourth vocabulary for it:
 * `in_stock` is genuine 24-hour supply, `sourced` is the 7–10 business day
 * drop-ship, `unknown` is a dose with no tracked row and must not be labelled
 * either way.
 *
 * It matters to the admin for two reasons the price alone does not show: the
 * two tiers are priced differently, and the automatic B2G1 promo applies to
 * SOURCED lines only — `b2g1Preview.ts` gates on `avail.state === 'sourced'`
 * and place-order's `promoPlan.ts` on the same `isSlow` test, so a 24-hour line
 * never earns a free third unit.
 */
export type DoseTier = DoseAvailability['state'];

/** Long form for the dose `<option>`, verbatim from the customer-facing
 *  AvailabilityBadge — "24 Hour Shipping" was renamed from "Fast" deliberately
 *  and is not paraphrased here. null for an untracked dose. */
const TIER_LABEL: Record<DoseTier, string | null> = {
  in_stock: '24 Hour Shipping',
  sourced: 'Standard Shipping · 7–10 business days',
  unknown: null,
};

/** Chip-sized form for a picked line, the same pair the catalog's per-dose
 *  pill uses (ProductCard). null for an untracked dose. */
const TIER_SHORT: Record<DoseTier, string | null> = {
  in_stock: '24 Hour',
  sourced: 'Sourced',
  unknown: null,
};

/** Compound-level summary — only ever states "all", and only when it is true.
 *  A compound whose doses differ reads `mixed`, never one tier's name. */
const COMPOUND_LABEL: Record<DoseTier | 'mixed', string | null> = {
  in_stock: 'all 24 Hour',
  sourced: 'all Standard',
  unknown: null,
  mixed: 'mixed tiers',
};

export function doseTierLabel(tier: DoseTier): string | null {
  return TIER_LABEL[tier];
}

export function doseTierShort(tier: DoseTier): string | null {
  return TIER_SHORT[tier];
}

/**
 * Summary for the compound dropdown. Returns a label only when every sellable
 * dose of the compound shares a tier ("all 24 Hour" / "all Standard"), and
 * `mixed tiers` when they differ — tier is a property of the (sku, dose) pair,
 * so a compound-level label must never imply its doses agree when they do not.
 * null for an empty list or one whose doses are all untracked.
 */
export function compoundTierLabel(options: VariantOption[]): string | null {
  if (options.length === 0) return null;
  const first = options[0].tier;
  const uniform = options.every((o) => o.tier === first);
  return COMPOUND_LABEL[uniform ? first : 'mixed'];
}

/** One sellable (sku, dose) the admin can pick. `priceCents` is the LIST price
 *  — the member's own price is derived from it by `memberUnitPriceCents`. */
export interface VariantOption {
  sku: string;
  dose: string;
  /** "5-Amino-1MQ — 10mg" — the same label format the order editors use. */
  name: string;
  priceCents: number;
  /** Per-dose shipping tier. Resolved here, at enumeration time, so every
   *  surface that shows an option shows the same tier the catalog does. */
  tier: DoseTier;
}

export interface VariantIndex {
  /** Sorted compound names — the first dropdown. */
  compoundNames: string[];
  /** Compound name → its sellable doses, in catalog order — the second. */
  byCompound: Map<string, VariantOption[]>;
}

/**
 * Enumerate every publicly sellable (sku, dose) with a resolvable price,
 * grouped by compound name. Two filters, both deliberate:
 *   • `isVariantPublic` — a dose the master sheet hides is not offerable.
 *   • a null effective price — an unpriced dose would mint synthetic money.
 * A compound with no surviving dose does not appear at all.
 */
export function buildVariantIndex(products: Product[]): VariantIndex {
  const byCompound = new Map<string, VariantOption[]>();

  for (const product of products) {
    for (const variant of product.variants) {
      if (!isVariantPublic(product.sku, variant.dose)) continue;
      const priceCents = effectiveTierPriceCents(product, variant.dose);
      if (priceCents == null) continue;
      const name = variant.dose ? `${product.name} — ${variant.dose}` : product.name;
      const tier = doseAvailability(product.sku, variant.dose).state;
      const existing = byCompound.get(product.name) ?? [];
      byCompound.set(product.name, [...existing, { sku: product.sku, dose: variant.dose, name, priceCents, tier }]);
    }
  }

  return { compoundNames: [...byCompound.keys()].sort(), byCompound };
}

/** Stable identity for a dose `<option>` — the two selects round-trip through
 *  this string, so no SKU is ever typed or parsed out of a label. */
export function variantOptionKey(option: Pick<VariantOption, 'sku' | 'dose'>): string {
  return `${option.sku}|${option.dose}`;
}

/** Resolve a dose-select value back to its option. Null when the key is empty
 *  or no longer in the index (e.g. the dose was hidden since the page loaded). */
export function findVariantOption(index: VariantIndex, key: string): VariantOption | null {
  if (!key) return null;
  for (const options of index.byCompound.values()) {
    const match = options.find((o) => variantOptionKey(o) === key);
    if (match) return match;
  }
  return null;
}

/**
 * The member's unit price for a list price, using the EXACT rounding the
 * checkout applies to the account slice — `discount = round(base × percent /
 * 100)`, `member = base − discount` — the same expression as
 * orderTotals.ts and memberPricing.ts. Parity is the point: the owner must see
 * the number the invoice will show.
 *
 * Returns null for a missing/non-positive base so callers can skip the display
 * rather than print "$0". A non-finite or out-of-range percent degrades to 0
 * (list price), which is always safe: it never promises less than the member
 * will actually be charged.
 */
export function memberUnitPriceCents(baseCents: number | null, percent: number): number | null {
  if (baseCents == null || !Number.isFinite(baseCents) || baseCents <= 0) return null;
  const pct = Number.isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0;
  const discount = Math.round((baseCents * pct) / 100);
  return Math.max(baseCents - discount, 0);
}

export interface PricedPreparedLine extends PreparedCartLine {
  /** Catalog label, for the composer's summary row. */
  name: string;
  listUnitCents: number;
  memberUnitCents: number;
  listLineCents: number;
  memberLineCents: number;
}

export interface PreparedCartPricing {
  lines: PricedPreparedLine[];
  listTotalCents: number;
  memberTotalCents: number;
  /** listTotal − memberTotal. The standing account discount only. */
  savingsCents: number;
  /** Lines whose (sku, dose) is no longer in the index — priced at nothing and
   *  reported, never silently dropped or priced at zero. */
  unpriced: PreparedCartLine[];
}

/**
 * Price a set of lines for a specific member. `percent` is the member's own
 * effective rate as resolved by `effective_customer_discount` — the roster row
 * already carries it (`MemberRow.effectivePercent`), so no extra read is needed
 * and the composer cannot drift from the server's answer.
 *
 * This is the STANDING account discount only. A coupon attached to the cart, a
 * B2G1 promo, and wholesale/bundle pricing all resolve at checkout and can
 * change the final figure (the account slice and B2G1 never stack — the larger
 * wins; wholesale and bundle pricing suppress the account slice outright).
 */
export function priceLines(
  lines: PreparedCartLine[],
  index: VariantIndex,
  percent: number,
): PreparedCartPricing {
  const priced: PricedPreparedLine[] = [];
  const unpriced: PreparedCartLine[] = [];

  for (const line of lines) {
    const option = findVariantOption(index, variantOptionKey(line));
    const memberUnitCents = option ? memberUnitPriceCents(option.priceCents, percent) : null;
    if (!option || memberUnitCents == null) {
      unpriced.push(line);
      continue;
    }
    priced.push({
      ...line,
      name: option.name,
      listUnitCents: option.priceCents,
      memberUnitCents,
      listLineCents: option.priceCents * line.quantity,
      memberLineCents: memberUnitCents * line.quantity,
    });
  }

  const listTotalCents = priced.reduce((sum, l) => sum + l.listLineCents, 0);
  const memberTotalCents = priced.reduce((sum, l) => sum + l.memberLineCents, 0);

  return {
    lines: priced,
    listTotalCents,
    memberTotalCents,
    savingsCents: listTotalCents - memberTotalCents,
    unpriced,
  };
}

/* ── The claim seam ───────────────────────────────────────────────────────── */

export interface PreparedCartPlanItem {
  product: Product;
  /** '' only for single-config products, which `variantProduct` passes through. */
  dose: string;
  quantity: number;
}

export interface PreparedCartPlan {
  addable: PreparedCartPlanItem[];
  /** "SKU · dose" for every line that could not be resolved to a priced
   *  variant. Reported to the member, never added as a dose-less line. */
  skipped: string[];
}

function skipLabel(line: PreparedCartLine): string {
  return line.dose ? `${line.sku} · ${line.dose}` : line.sku;
}

/**
 * Map stored prepared-cart lines back to catalog `(product, dose, quantity)`
 * triples. The caller feeds each one through `variantProduct(product, dose)`
 * before `cart.add` — that is what bakes the dose into the cart line's id and
 * name, and it is not optional: without it place-order's price check resolves
 * no dose and refuses the whole order (`dose_unresolved`, HTTP 409).
 *
 * A line is SKIPPED, never guessed, when:
 *   • its sku is not in the catalog;
 *   • its quantity is not a positive integer;
 *   • the product has variants but the line carries no dose (the exact shape of
 *     the $0-order-line incident);
 *   • the dose is not one of the product's variants;
 *   • the (sku, dose) has no resolvable effective price.
 */
export function planPreparedCart(lines: PreparedCartLine[], products: Product[]): PreparedCartPlan {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const addable: PreparedCartPlanItem[] = [];
  const skipped: string[] = [];

  for (const line of lines) {
    const product = bySku.get(line.sku);
    if (!product || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      skipped.push(skipLabel(line));
      continue;
    }

    const hasVariants = product.variants.length > 0;
    const dose = line.dose.trim();

    if (hasVariants && !product.variants.some((v) => v.dose === dose)) {
      // Covers both "no dose on a multi-variant product" and "a dose this
      // product does not sell".
      skipped.push(skipLabel(line));
      continue;
    }

    if (effectiveTierPriceCents(product, dose) == null) {
      skipped.push(skipLabel(line));
      continue;
    }

    addable.push({ product, dose: hasVariants ? dose : '', quantity: line.quantity });
  }

  return { addable, skipped };
}
