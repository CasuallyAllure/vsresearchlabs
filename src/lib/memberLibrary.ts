/**
 * memberLibrary — order lines + catalog records → the member's research
 * documentation library (`/account/library`).
 *
 * Pure. No I/O, no React. The page loads the member's own order lines
 * (`listMyOrderLines`, `src/lib/accountData.ts`) and the catalog
 * (`useProducts`), then hands both to `buildMemberLibrary` here.
 *
 * Honesty boundary: every field on a `LibraryEntry` is copied verbatim from
 * the catalog record (`src/data/products.json`) or derived from the order
 * line the member actually placed. There are no per-batch certificates in
 * this system, so nothing here claims one — this is the compound's
 * SPECIFICATION documentation, not a certificate of analysis.
 */

import type { Product, ProductSpec, ResearchClassification } from '../types/product';
import { deriveProductDose } from '../types/product';
import type { MyOrderLineRow } from './accountData';

/** Order statuses that never produced a supplied record — excluded outright. */
const EXCLUDED_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'refunded']);

/** One catalog record the member has ordered, with their own order context. */
export interface LibraryEntry {
  /** Catalog product id — the `/product/:id` route key. */
  productId: string;
  name: string;
  sku: string;
  family: string;
  researchClassification: ResearchClassification | null;
  /** Purity spec exactly as stated in the catalog record, or null if absent. */
  purity: ProductSpec | null;
  casNumber: string | null;
  molecularWeight: string | null;
  /** Distinct dose labels from the member's own lines, first-seen order. */
  doses: string[];
  /** How many distinct orders included this record. */
  orderCount: number;
}

/**
 * Compounds and everything else are separated: only `productType === 'peptide'`
 * records carry compound documentation (same scope rule as `/research`).
 */
export interface MemberLibrary {
  compounds: LibraryEntry[];
  supplies: LibraryEntry[];
}

interface Accumulator {
  product: Product;
  doses: string[];
  orderNumbers: Set<string>;
}

function purityOf(product: Product): ProductSpec | null {
  return (product.specs ?? []).find((s) => s.label.toLowerCase().startsWith('purity')) ?? null;
}

function toEntry(acc: Accumulator): LibraryEntry {
  const { product } = acc;
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    family: product.family,
    researchClassification: product.researchClassification ?? null,
    purity: purityOf(product),
    casNumber: product.casNumber ?? null,
    molecularWeight: product.molecularWeight ?? null,
    doses: acc.doses,
    orderCount: acc.orderNumbers.size,
  };
}

function byName(a: LibraryEntry, b: LibraryEntry): number {
  return a.name.localeCompare(b.name);
}

/**
 * Distinct catalog records across the member's order lines.
 *
 * - Cancelled/refunded orders are dropped.
 * - A sku with no catalog record is skipped (retired or hand-entered line).
 * - Doses come from the line's `product_name` suffix ("BPC-157 — 5mg"), the
 *   same convention `deriveProductDose` reads everywhere else.
 */
export function buildMemberLibrary(lines: MyOrderLineRow[], products: Product[]): MemberLibrary {
  const bySku = new Map<string, Product>(products.map((p) => [p.sku, p]));
  const acc = new Map<string, Accumulator>();

  for (const line of lines) {
    if (EXCLUDED_STATUSES.has(line.status)) continue;
    const product = bySku.get(line.sku);
    if (!product) continue;

    const dose = deriveProductDose({ name: line.product_name });
    const existing = acc.get(product.id);
    if (!existing) {
      acc.set(product.id, {
        product,
        doses: dose ? [dose] : [],
        orderNumbers: new Set([line.order_number]),
      });
      continue;
    }
    acc.set(product.id, {
      product: existing.product,
      doses: dose && !existing.doses.includes(dose) ? [...existing.doses, dose] : existing.doses,
      orderNumbers: new Set([...existing.orderNumbers, line.order_number]),
    });
  }

  const collected = [...acc.values()];
  return {
    compounds: collected
      .filter((a) => a.product.productType === 'peptide')
      .map(toEntry)
      .sort(byName),
    supplies: collected
      .filter((a) => a.product.productType !== 'peptide')
      .map(toEntry)
      .sort(byName),
  };
}
