// supabase/functions/place-order/priceCheck.ts
// Pure server-side price authority for checkout lines.
//
// POLICY (2026-07-16, P0-1): FAIL CLOSED. A line whose client-sent price does
// not match the admin-set price EXACTLY (to the cent, no tolerance) rejects the
// whole order. The deployed build declared a `priceMismatches` array and never
// populated it, so a buyer could invoice themselves any amount; the interim
// build populated it but only flagged. Flagging relies on an operator noticing
// a number before releasing goods — the money moves out-of-band (manual Zelle),
// so the only control that actually holds is refusing to create the order.
//
// The server's source of truth, in precedence order (mirrors the client's
// src/lib/cartActions.ts lineUnitCents → src/lib/productOverrides.ts
// variantPriceCents):
//   1. product_variant_stock.price_cents for the matched (sku, dose)
//   2. product_stock.price_cents_override for the sku
//
// Dose matching reuses the cart-line convention: the dose is baked into the
// line name ("BPC-157 — 5mg", see src/lib/cartActions.ts variantProduct), so a
// variant row matches when its squashed dose appears in the squashed name+note.
// The LONGEST matching dose wins, so "15mg" is never claimed by the "5mg" row.
//
// ANTI-EVASION: the squash normalizer strips Unicode format/control characters
// (e.g. zero-width U+200B) so a tampered name can't hide the dose from the
// substring match.
//
// WHY THE RESOLVER MATCHES UNPRICED ROWS TOO (and why that is not a hole):
// the previous version filtered to `price_cents != null` BEFORE matching, so a
// legitimately unpriced dose on a partially-priced sku matched nothing and came
// back "unresolved". Under flag-only that was a documented false positive; under
// FAIL CLOSED it would refuse real orders — live examples today: TB-500 5mg
// (8 on hand, ships 24hr) sits on VSR-RS-TB4-005 whose 10mg IS priced; same
// shape for Kisspeptin-10 5mg and Thymosin α-1 5mg. So the resolver matches
// against ALL rows for the sku and branches on the matched row's price:
//   • matched + priced   → verify (reject on any difference)
//   • matched + no price → genuinely formula-priced → UNVERIFIABLE: allowed and
//     recorded on the order timeline. This is the residual gap, and it closes
//     for free the moment the operator imports a price for those doses.
//   • matched nothing    → the sku IS in the catalog but the line's dose text
//     resolves to no real dose → evasion → reject
// This NARROWS the old false positive rather than widening it.
//
// Kept free of Deno/runtime imports so vitest can unit-test it directly.

/** The catalog's sku charset. supabase-js does not escape embedded quotes
 *  inside a filter value, so only well-formed skus may enter the batched .in()
 *  query — a crafted sku could otherwise malform the query and fail the check
 *  open for the WHOLE order. A line whose sku falls outside this charset can
 *  never be reconciled with the catalog, so it is rejected, never skipped. */
export const SKU_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const isQueryableSku = (sku: string | undefined): sku is string =>
  !!sku && SKU_RE.test(sku);

/** Lowercase, drop all whitespace, and strip Unicode format/control chars
 *  (zero-width spaces, bidi marks, etc.) so they can't be used to hide a dose
 *  token from the substring match. THE one definition — the promo/wholesale
 *  matcher imports this rather than keeping its own weaker copy, so a line can
 *  never resolve to different doses in the price check vs the discount path. */
export const squash = (s: string): string =>
  s.toLowerCase().replace(/[\s\p{Cf}\p{Cc}]+/gu, "");

export interface PriceCheckLine {
  sku?: string;
  name: string;
  note?: string;
  unitPriceCents: number;
}

/** Any product_variant_stock row. Generic so the wholesale path can resolve the
 *  same (sku, dose) row and then read its own columns off it. */
export interface VariantRow {
  sku: string;
  dose: string | null;
}

export interface VariantPriceRow extends VariantRow {
  price_cents: number | null;
}

export interface SkuOverrideRow {
  sku: string;
  price_cents_override: number | null;
}

/**
 * The variant row a line refers to: the LONGEST dose whose squashed text
 * appears in the line's squashed text, among the rows for this sku. Null when
 * no dose matches, or when the text names more than one dose (see below).
 *
 * Shared by the price check and the wholesale/B2G1 planner so the two can never
 * disagree about which dose a line is.
 *
 * LONGEST MATCH handles doses that nest by construction: on the live sku
 * VSR-RS-IGF, squash("IGF-1 LR3 — 0.1mg") contains "1mg", so a first-match
 * resolver would price the 0.1mg line off the 1mg row. "0.1mg" is longer, so it
 * wins. Same reason "15mg" is never claimed by the "5mg" row.
 *
 * DISJOINT MATCHES ARE AMBIGUOUS, and ambiguous means unresolved (⇒ the caller
 * refuses the order). Longest-match alone is exploitable: squashing removes the
 * whitespace that separates tokens, so
 *     name "IGF-1 LR3 — 1mg" + note "0.1mg"   → "igf-1lr3—1mg0.1mg"
 * matches BOTH rows, and the longer one wins — billing an honest-looking 1mg
 * line at the 0.1mg price. Putting the second token in the name reaches the same
 * place, so ignoring `note` does not close it.
 * The tell is POSITION, which squashing preserves: a real cart line names its
 * dose ONCE, so every match overlaps the winner (a nested dose sits inside it).
 * Two matches on non-overlapping regions mean the text names two different
 * doses — that is never a line this cart builds. Verified against all 138 live
 * catalog variant lines: every one resolves to its own dose, none ambiguous.
 */
interface Span {
  start: number;
  end: number;
}

/** Every place `needle` occurs in `haystack`, including overlapping hits. */
function spansOf(haystack: string, needle: string): Span[] {
  const spans: Span[] = [];
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
    spans.push({ start: i, end: i + needle.length });
  }
  return spans;
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

export function resolveVariantRow<T extends VariantRow>(
  sku: string,
  lineText: string,
  rows: readonly T[],
): T | null {
  const haystack = squash(lineText);
  const found: { dose: string; row: T; spans: Span[] }[] = [];
  for (const row of rows) {
    if (row.sku !== sku) continue;
    const dose = squash(row.dose ?? "");
    if (dose.length === 0) continue;
    const spans = spansOf(haystack, dose);
    if (spans.length > 0) found.push({ dose, row, spans });
  }
  if (found.length === 0) return null;

  const best = found.reduce((a, b) => (b.dose.length > a.dose.length ? b : a));
  // Every occurrence of a DIFFERENT dose must sit inside the winner (a nested
  // dose like "1mg" within "0.1mg"). One that stands on its own region means the
  // text names a second dose.
  const namesASecondDose = found.some((f) =>
    f !== best && f.spans.some((span) => !best.spans.some((b) => overlaps(span, b)))
  );
  return namesASecondDose ? null : best.row;
}

/** The text a line is resolved against: ONLY the name.
 *
 *  cartActions.variantProduct bakes the dose into the name by construction
 *  ("BPC-157 — 5mg"), and the name is also what the operator reads when picking
 *  the vial to ship — so it is the one field where "what you're billed for" and
 *  "what you're sent" are the same string. `note` is a free-text message to the
 *  seller and must never be an identity signal: it used to be able to flip B2G1
 *  eligibility (note "5mg" on a "X — 20mg" line) and to steer this resolver onto
 *  a cheaper dose. */
export const lineText = (line: PriceCheckLine): string => line.name;

export type PriceResolution =
  /** An admin-set price exists and is authoritative. */
  | { kind: "priced"; cents: number }
  /** The dose is a real catalog row carrying no admin price — the client
   *  formula-prices it and the server has nothing to compare against. */
  | { kind: "unpriced" }
  /** The sku is in the catalog but the line's text matches no dose. */
  | { kind: "unresolved" }
  /** No variant rows and no per-sku override — not a catalog sku. */
  | { kind: "unknown" };

export function resolveLinePrice(
  line: PriceCheckLine,
  variantRows: readonly VariantPriceRow[],
  overrideBySku: ReadonlyMap<string, number>,
): PriceResolution {
  const sku = line.sku;
  if (!sku) return { kind: "unknown" };

  const matched = resolveVariantRow(sku, lineText(line), variantRows);
  if (matched != null) {
    return matched.price_cents != null
      ? { kind: "priced", cents: matched.price_cents }
      : { kind: "unpriced" };
  }

  const override = overrideBySku.get(sku);
  if (override != null) return { kind: "priced", cents: override };

  // Nothing matched. If the sku nonetheless has catalog rows, the dose text was
  // reworded or hidden — evasion, not an unpriced product.
  return variantRows.some((r) => r.sku === sku)
    ? { kind: "unresolved" }
    : { kind: "unknown" };
}

export type PriceFailureReason =
  | "price_mismatch"
  | "zero_price"
  | "missing_sku"
  | "malformed_sku"
  | "unknown_sku"
  | "dose_unresolved";

/** A line that failed verification — the order is refused. `serverCents` is the
 *  authoritative price when one is known, else null. */
export interface PriceFailure {
  sku: string;
  name: string;
  clientCents: number;
  serverCents: number | null;
  reason: PriceFailureReason;
}

/** A line the server genuinely cannot price (formula-priced catalog dose).
 *  Allowed through, but recorded on the admin order timeline — a silent skip
 *  must never be indistinguishable from a verified line. */
export interface UnverifiedLine {
  sku: string;
  name: string;
  clientCents: number;
}

export interface PriceVerdict {
  /** False ⇒ refuse the order. */
  ok: boolean;
  failures: PriceFailure[];
  unverified: UnverifiedLine[];
}

/**
 * Verify every client-sent line price against the admin-set price.
 *
 * Rejects (fail closed):
 *   • a matched admin price the client's price differs from — exact cents, no
 *     tolerance
 *   • unitPriceCents <= 0 — the client never legitimately sends a free line
 *     (server-generated free promo lines are appended AFTER this check)
 *   • a missing or malformed sku — unverifiable by construction; every catalog
 *     product has a well-formed sku
 *   • an unknown sku — no variant rows and no per-sku override anywhere
 *   • a priced sku whose dose text resolves to no real dose — evasion
 *
 * Allows, and reports as `unverified`:
 *   • a real dose row that carries no admin price (formula-priced)
 */
export function verifyLinePrices(
  lines: readonly PriceCheckLine[],
  variantRows: readonly VariantPriceRow[],
  overrideRows: readonly SkuOverrideRow[],
): PriceVerdict {
  const overrideBySku = new Map<string, number>();
  for (const row of overrideRows) {
    if (row.price_cents_override != null) overrideBySku.set(row.sku, row.price_cents_override);
  }

  const failures: PriceFailure[] = [];
  const unverified: UnverifiedLine[] = [];

  for (const line of lines) {
    const fail = (reason: PriceFailureReason, serverCents: number | null = null) => {
      failures.push({
        sku: line.sku ?? "",
        name: line.name,
        clientCents: line.unitPriceCents,
        serverCents,
        reason,
      });
    };

    if (!line.sku) { fail("missing_sku"); continue; }
    if (!isQueryableSku(line.sku)) { fail("malformed_sku"); continue; }
    if (!(line.unitPriceCents > 0)) { fail("zero_price"); continue; }

    const resolved = resolveLinePrice(line, variantRows, overrideBySku);
    switch (resolved.kind) {
      case "priced":
        if (line.unitPriceCents !== resolved.cents) fail("price_mismatch", resolved.cents);
        break;
      case "unpriced":
        unverified.push({ sku: line.sku, name: line.name, clientCents: line.unitPriceCents });
        break;
      case "unresolved":
        fail("dose_unresolved");
        break;
      case "unknown":
        fail("unknown_sku");
        break;
    }
  }

  return { ok: failures.length === 0, failures, unverified };
}

/** Buyer-facing explanation of a refusal. Catalog prices are public, so naming
 *  the real price is not a leak — and it is the honest message for the common
 *  legitimate case: the admin repriced while the buyer's cart sat open. */
export function priceFailureMessage(failures: readonly PriceFailure[]): string {
  const repriced = failures.filter((f) => f.reason === "price_mismatch");
  if (repriced.length > 0 && repriced.length === failures.length) {
    const what = repriced.length === 1 ? `“${repriced[0].name}”` : `${repriced.length} items in your cart`;
    return `The price of ${what} changed while you were checking out. Refresh your cart to see the current price, then place the order again.`;
  }
  return "We couldn't verify every line in this order against the catalog. Refresh your cart and try again — if it keeps happening, contact us and we'll place the order for you.";
}
