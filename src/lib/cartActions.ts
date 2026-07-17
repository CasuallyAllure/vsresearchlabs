/**
 * cartActions — variant-aware add-to-cart helper.
 *
 * The cart stores a `Product` per line and dedupes by `product.id`. On its
 * own that loses the dose the buyer picked: every add site selects an active
 * tier (5mg / 10mg / …) in local state, but `add(product)` threw that choice
 * away. At submit time `deriveProductDose(product)` then parsed the dose back
 * out of `product.name` — which is just the family name ("BPC-157") for any
 * multi-variant compound, so it resolved to "" and the per-(sku,dose) price
 * override lookup missed, falling all the way through to `?? 0`. Result: every
 * order line was written at $0.
 *
 * `variantProduct` fixes this at the source by baking the selected dose into
 * the cart line:
 *   • id    → `${id}::${dose}`  → distinct doses become distinct cart lines
 *             (and the existing id-based dedupe keeps working unchanged)
 *   • name  → `${name} — ${dose}` → deriveProductDose() now resolves the dose,
 *             and the dose rides along into order_lines.product_name / invoice
 *   • priceCents → the resolved per-(sku,dose) override price (admin sheet),
 *             so the line carries a real price even before the submit-time
 *             recompute.
 *
 * No store / schema changes required — the dose travels inside the product the
 * cart already persists.
 */

import type { Product } from '../types';
import { deriveProductDose } from '../types';
import { effectiveTierPriceCents, tierPriceCents } from './pricing';
import { variantPriceCents, doseAvailability, isVariantPublic } from './productOverrides';
import { WHOLESALE_PACKS } from './wholesale';

/** Smallest wholesale pack size (the half kit, 5). At or above this quantity a
 *  line is bought as a wholesale case — the same threshold place-order uses to
 *  detect and discount pack lines. */
const WHOLESALE_MIN_PACK = Math.min(...WHOLESALE_PACKS.map((p) => p.size));

/**
 * Returns a cart-line product for the given (product, dose). When `dose` is
 * empty (e.g. single-config equipment, or a row with no tier) the product is
 * returned unchanged.
 */
export function variantProduct(product: Product, dose?: string): Product {
  const d = (dose ?? '').trim();
  if (!d) return product;

  // If the family name already carries a dose suffix (single-variant products
  // stored as "Name — 5mg"), don't append it twice.
  const baseHasDose = deriveProductDose(product).length > 0;
  const price = effectiveTierPriceCents(product, d);

  return {
    ...product,
    id: `${product.id}::${d}`,
    name: baseHasDose ? product.name : `${product.name} — ${d}`,
    priceCents: price ?? product.priceCents ?? null,
  };
}

/**
 * resolveSellableDose — the dose a quick-add ("+") should actually use.
 *
 * The catalog "+" buttons pass the row's spec headline, which is EMPTY for a
 * multi-dose compound whose display name is just the family ("AOD-9604").
 * Adding with an empty dose drops the line to $0 (see feedback_cart_variant_dose,
 * which has hit production). This resolves the product to a real, priced dose.
 *
 * Precedence:
 *   1. the passed dose, if it already resolves to a real price — equipment /
 *      consumables whose headline IS the sellable spec (e.g. "Benchtop").
 *   2. the first PUBLICLY-PRICED variant dose — multi-dose compounds.
 *   3. the passed dose unchanged — genuine single-config with its own priceCents,
 *      or nothing sellable (the caller guards against adding a $0 line).
 */
export function resolveSellableDose(product: Product, preferredDose?: string): string {
  const d = (preferredDose ?? '').trim();
  if (d && effectiveTierPriceCents(product, d) != null) return d;
  const priced = (product.variants ?? []).find(
    (v) => isVariantPublic(product.sku, v.dose) && effectiveTierPriceCents(product, v.dose) != null,
  );
  return priced?.dose ?? d;
}

/**
 * canQuickAdd — false when a "+" would add a $0 line for a product that has
 * variants (no priced dose could be resolved). Callers should open the dose
 * picker / compound overlay instead of adding a priceless line.
 */
export function canQuickAdd(product: Product, dose: string): boolean {
  if (effectiveTierPriceCents(product, dose) != null) return true;
  // A dose-less resolution is only acceptable for products with no variants
  // (single-config items that carry their own priceCents).
  return (product.variants?.length ?? 0) === 0 && product.priceCents != null;
}

/**
 * Resolved unit price (cents) for a cart line — the single source of truth
 * shared by the cart display and the place-order payload so what the buyer
 * sees equals what gets billed.
 *
 * Resolution order matters:
 *   1. Live admin override for (sku, dose) — authoritative, and reflects any
 *      price change the admin made after the buyer added the item.
 *   2. The price captured on the line at add-time — the admin override snapshot
 *      taken when the catalog was loaded. This is the safety net for the case
 *      where the overrides store hasn't finished loading at price-read time
 *      (e.g. a deep-link straight to /cart): without it the formula below would
 *      wrongly clobber a correct admin price.
 *   3. The placeholder formula — last resort only (should never hit in prod,
 *      where every public variant has an override).
 */
export function lineUnitCents(item: { product: Product }): number {
  const dose = deriveProductDose(item.product);
  const override = variantPriceCents(item.product.sku, dose);
  if (override != null) return override;
  if (item.product.priceCents != null) return item.product.priceCents;
  return tierPriceCents(item.product, dose) ?? 0;
}

/**
 * The cart's display subtotal — Σ lineUnitCents × quantity. The single client
 * source of truth (CartDrawer + CartPage both read this); place-order
 * independently recomputes and verifies the real charge server-side.
 */
export function cartSubtotalCents(
  items: Array<{ product: Product; quantity: number }>,
): number {
  return items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0);
}

/**
 * Is this cart line a wholesale case? Wholesale is ACCOUNT-GATED: only a
 * signed-in buyer transacts at case pricing, and only at pack quantity. Mirrors
 * place-order's server gate (stampedUserId + qty ≥ smallest pack).
 */
export function lineIsWholesale(
  item: { product: Product; quantity?: number },
  isMember = false,
): boolean {
  return isMember && (item.quantity ?? 0) >= WHOLESALE_MIN_PACK;
}

/**
 * Is this cart line a FAST-ship item? Fast = physically reachable supply
 * (on-hand or in-transit) for the (sku, dose) — same definition the catalog
 * FAST badge uses (doseAvailability). Non-fast items ship from the drop-ship
 * warehouse, so a cart that mixes the two will arrive in separate shipments.
 *
 * A wholesale line (see lineIsWholesale) is NEVER fast: the whole case is
 * sourced together and always ships 7–10 business days, even when the dose is a
 * 24-hour retail item. This mirrors place-order and the wholesale rule
 * ("everything is 7–10 business days"), so no wholesale line is ever badged or
 * emailed as ⚡ 24-hour.
 */
export function lineIsFast(
  item: { product: Product; quantity?: number },
  isMember = false,
): boolean {
  if (lineIsWholesale(item, isMember)) return false;
  const av = doseAvailability(item.product.sku, deriveProductDose(item.product));
  return av.state === 'in_stock' && av.fast;
}

/** True when the cart contains BOTH fast-ship and standard (drop-ship) lines —
 *  the buyer should be told the order may arrive in separate shipments. */
export function cartHasMixedShipping(
  items: Array<{ product: Product; quantity?: number }>,
  isMember = false,
): boolean {
  let fast = false;
  let standard = false;
  for (const i of items) {
    if (lineIsFast(i, isMember)) fast = true;
    else standard = true;
    if (fast && standard) return true;
  }
  return false;
}
