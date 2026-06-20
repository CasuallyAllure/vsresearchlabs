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
import { variantPriceCents } from './productOverrides';

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
