// supabase/functions/place-order/priceCheck.ts
// Pure server-side price verification for checkout lines.
//
// Mirrors the client's price resolution (src/lib/cartActions.ts lineUnitCents →
// src/lib/productOverrides.ts variantPriceCents): the admin-set per-(sku,dose)
// price from product_variant_stock wins, else the per-sku
// product_stock.price_cents_override. Lines where NEITHER exists are
// formula-priced on the client (src/lib/pricing.ts placeholder) and cannot be
// verified — they are skipped, never flagged.
//
// Dose matching reuses the cart-line convention: the dose is baked into the
// line name ("BPC-157 — 5mg", see src/lib/cartActions.ts variantProduct), so a
// variant row matches when its squashed dose appears in the squashed
// name+note. The LONGEST matching dose wins so "15mg" is never claimed by the
// "5mg" row.
//
// ANTI-EVASION (see security review 2026-07-16): the squash normalizer strips
// Unicode format/control characters (e.g. zero-width U+200B) so a tampered
// name can't hide the dose from the substring match. And a line whose sku HAS
// priced variant rows but matches NONE of them is FLAGGED (serverCents=null),
// not silently skipped — otherwise an attacker keeps a valid sku, rewords the
// dose so nothing matches, and slips past. Only a sku with no priced row
// anywhere (genuinely formula-priced) is skipped.
//
// Kept free of Deno/runtime imports so vitest can unit-test it directly.

export interface PriceCheckLine {
  sku?: string;
  name: string;
  note?: string;
  unitPriceCents: number;
}

export interface VariantPriceRow {
  sku: string;
  dose: string | null;
  price_cents: number | null;
}

export interface SkuOverrideRow {
  sku: string;
  price_cents_override: number | null;
}

/** One order line whose client-sent price could not be reconciled with the
 *  admin-set price. `serverCents` is the authoritative price when known, or
 *  null when the sku is priced but the dose couldn't be resolved (possible
 *  evasion — operator must verify manually). */
export interface PriceMismatch {
  sku: string;
  name: string;
  clientCents: number;
  serverCents: number | null;
}

/** Lowercase, drop all whitespace, and strip Unicode format/control chars
 *  (zero-width spaces, bidi marks, etc.) so they can't be used to hide a dose
 *  token from the substring match below. */
const squash = (s: string): string =>
  s.toLowerCase().replace(/[\s\p{Cf}\p{Cc}]+/gu, "");

/**
 * Resolve a line to its admin-set price and how confident we are:
 *   • {cents}            — a per-dose or per-sku admin price was found.
 *   • {cents:null,priced:true}  — the sku HAS priced variant rows but none
 *                          matched the line's dose text (unverifiable — flag).
 *   • null               — no priced row exists for this sku anywhere
 *                          (genuinely formula-priced — skip).
 */
export function resolveServerPrice(
  line: PriceCheckLine,
  variantRows: VariantPriceRow[],
  overrideBySku: Map<string, number>,
): { cents: number | null; priced: boolean } | null {
  const sku = line.sku;
  if (!sku) return null;

  const skuVariants = variantRows.filter((r) => r.sku === sku && r.price_cents != null);
  const haystack = squash(`${line.name} ${line.note ?? ""}`);
  let matched: { doseLen: number; cents: number } | null = null;
  for (const row of skuVariants) {
    const dose = squash(row.dose ?? "");
    if (dose.length === 0 || !haystack.includes(dose)) continue;
    if (matched == null || dose.length > matched.doseLen) {
      matched = { doseLen: dose.length, cents: row.price_cents as number };
    }
  }
  if (matched != null) return { cents: matched.cents, priced: true };

  const override = overrideBySku.get(sku);
  if (override != null) return { cents: override, priced: true };

  // No dose matched and no per-sku override. If the sku nonetheless carries
  // priced variant rows, the dose was hidden/unresolvable — flag it. If it has
  // no priced row at all, it's a formula-priced catalog line — skip.
  if (skuVariants.length > 0) return { cents: null, priced: true };
  return null;
}

/** Back-compat: the resolved price, or null when unverifiable OR unresolved. */
export function serverPriceForLine(
  line: PriceCheckLine,
  variantRows: VariantPriceRow[],
  overrideBySku: Map<string, number>,
): number | null {
  return resolveServerPrice(line, variantRows, overrideBySku)?.cents ?? null;
}

/**
 * Compare every client-sent line price against the admin-set price. Returns
 * the lines that don't reconcile:
 *   • a matched price that differs from the client's, or
 *   • a priced sku whose dose couldn't be resolved (serverCents=null).
 * Genuinely formula-priced lines (no admin price for the sku) are skipped.
 */
export function findPriceMismatches(
  lines: PriceCheckLine[],
  variantRows: VariantPriceRow[],
  overrideRows: SkuOverrideRow[],
): PriceMismatch[] {
  const overrideBySku = new Map<string, number>();
  for (const row of overrideRows) {
    if (row.price_cents_override != null) overrideBySku.set(row.sku, row.price_cents_override);
  }
  const mismatches: PriceMismatch[] = [];
  for (const line of lines) {
    const resolved = resolveServerPrice(line, variantRows, overrideBySku);
    if (resolved == null) continue; // formula-priced — unverifiable, skip
    if (resolved.cents == null) {
      // priced sku, dose unresolved → possible evasion, flag
      mismatches.push({ sku: line.sku ?? "", name: line.name, clientCents: line.unitPriceCents, serverCents: null });
      continue;
    }
    if (line.unitPriceCents !== resolved.cents) {
      mismatches.push({ sku: line.sku ?? "", name: line.name, clientCents: line.unitPriceCents, serverCents: resolved.cents });
    }
  }
  return mismatches;
}
