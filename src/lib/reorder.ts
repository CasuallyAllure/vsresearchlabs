/**
 * reorder — pure mapping from a past order's invoice lines back to catalog
 * (product, dose) pairs the cart can re-add.
 *
 * The cart's dose identity lives in the product NAME (`variantProduct` bakes
 * "Family — 5mg" into the line; see src/lib/cartActions.ts and the
 * cart-variant-dose incident where a bare add() produced $0 order lines).
 * Order lines snapshot that name into `order_lines.product_name`, so the dose
 * is recovered from the stored name the same way fulfillment resolves it
 * (`_resolve_line_dose`, migration 068): normalize with the canonical squash
 * (lowercase, strip whitespace/format/control chars — mirrors
 * place-order/priceCheck.ts) and pick the LONGEST variant dose whose squashed
 * text is contained in the squashed line name. A match that is not nested
 * inside the winner is ambiguous → the line is skipped, never guessed.
 *
 * Pure module: no stores, no I/O — the caller supplies the catalog products
 * and feeds the result through `variantProduct` + `cart.add`.
 */

import type { Product } from '../types';

/** The subset of an order invoice line this mapping needs. */
export interface ReorderLine {
  sku: string;
  product_name: string;
  quantity: number;
}

export interface ReorderPlanItem {
  product: Product;
  /** '' for single-config products (variantProduct passes them through). */
  dose: string;
  quantity: number;
}

export interface ReorderPlan {
  addable: ReorderPlanItem[];
  /** `product_name` of each line that could not be resolved to a variant. */
  skipped: string[];
}

/** Client mirror of `squash_dose_text` (061) / priceCheck.ts `squash`. */
const squashDoseText = (s: string): string =>
  s.toLowerCase().replace(/[\s\p{Cf}\p{Cc}]+/gu, '');

/**
 * Longest-squashed-dose-contained match, mirroring fulfillment's
 * `_resolve_line_dose`. Returns null when nothing matches or the match is
 * ambiguous (another matched dose is not nested inside the winner).
 */
function resolveLineDose(product: Product, productName: string): string | null {
  const nameSq = squashDoseText(productName);
  const matches = product.variants
    .map((v) => v.dose)
    .filter((dose) => {
      const doseSq = squashDoseText(dose);
      return doseSq.length > 0 && nameSq.includes(doseSq);
    })
    .sort((a, b) => squashDoseText(b).length - squashDoseText(a).length);

  if (matches.length === 0) return null;
  const winner = matches[0];
  const winnerSq = squashDoseText(winner);
  const ambiguous = matches.some((m) => !winnerSq.includes(squashDoseText(m)));
  return ambiguous ? null : winner;
}

/**
 * Map order lines to catalog (product, dose, quantity) triples. Lines whose
 * sku is not in the catalog, or whose name resolves to no unambiguous variant
 * dose, land in `skipped` — the caller reports them rather than risking a
 * dose-less (→ $0) cart line.
 */
export function planReorder(lines: ReorderLine[], products: Product[]): ReorderPlan {
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const addable: ReorderPlanItem[] = [];
  const skipped: string[] = [];

  for (const line of lines) {
    const product = bySku.get(line.sku);
    if (!product || line.quantity <= 0) {
      skipped.push(line.product_name);
      continue;
    }

    if (product.variants.length === 0) {
      // Single-config item (e.g. equipment) — dose-less by design; the
      // product carries its own priceCents.
      addable.push({ product, dose: '', quantity: line.quantity });
      continue;
    }

    const dose = resolveLineDose(product, line.product_name);
    if (dose == null) {
      skipped.push(line.product_name);
      continue;
    }
    addable.push({ product, dose, quantity: line.quantity });
  }

  return { addable, skipped };
}
