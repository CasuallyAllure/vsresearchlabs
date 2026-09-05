/**
 * convertPreparedCart — the pure logic behind "Convert to order".
 *
 * THE PROBLEM. The owner builds a prepared cart, sends it, and the member pays
 * him directly (Zelle, off-site) without ever completing checkout. No order
 * exists, so there is nothing to fulfil, invoice or mark paid. He converts the
 * cart himself instead — and because the money is ALREADY IN HIS HAND, the
 * figures he sees and edits here are the record, not a suggestion.
 *
 * That inverts the rule preparedCart.ts lives by. A prepared cart carries no
 * price because place-order fails closed on a client-supplied one; this path
 * does not go through place-order. It goes through `admin_create_order` (041,
 * extended by 083), the admin composer's own RPC, which has always recorded a
 * hand-typed unit price. So here — and only here — prices are editable.
 *
 * WHY THE MATHS LIVE IN THIS FILE. The confirmation the owner reads before
 * committing states an exact total, and he is reconciling it against money he
 * has already been paid. That total must be the SAME NUMBER the order ends up
 * carrying, which means this module has to reproduce `recompute_order_totals`
 * exactly rather than approximately:
 *
 *   subtotal = Σ unit × qty                        (integer cents, no floats)
 *   percent  → round(subtotal × pct / 100), capped at subtotal
 *   fixed    → min(amount, subtotal)
 *   total    = subtotal − discount                 (shipping is 0 on a new order)
 *
 * `round` is `Math.round`, which agrees with PostgreSQL's `round(numeric)` on
 * the non-negative values money takes here — both go half-away-from-zero.
 *
 * The single-discount-row shape is not a simplification: the composer offers
 * exactly one discount, so `v_flat`/`v_pct_used`'s multi-row cascade collapses
 * to the two lines above. Anything richer would be modelling a UI that does not
 * exist.
 *
 * PERCENTS ARE WHOLE NUMBERS. Every percent in this system is an integer —
 * effective_customer_discount, memberPricing, orderTotals — and a fractional one
 * would put JavaScript float arithmetic and PostgreSQL exact numeric arithmetic
 * on opposite sides of a half-cent. A negotiated 12.5% is expressed as a fixed
 * amount instead, which is exact on both sides.
 */

import { formatPriceExact } from './pricing';
import { findVariantOption, variantOptionKey, type PreparedCartLine, type VariantIndex } from './preparedCart';

/** How the owner expressed the discount he actually gave. */
export type DiscountKind = 'percent' | 'fixed';

/** One editable order line. `unitPriceCents` is what the order will record. */
export interface ConvertLine {
  sku: string;
  /** '' for single-config products, the same contract the cart stores. */
  dose: string;
  /** Catalog label, written to order_lines.product_name. */
  name: string;
  quantity: number;
  unitPriceCents: number;
}

/**
 * The discount as edited. Both numbers are carried so toggling the kind does not
 * lose the other value mid-edit; only the one matching `kind` is ever applied.
 */
export interface DiscountDraft {
  kind: DiscountKind;
  /** Whole percent, 0–100. Applies when kind === 'percent'. */
  percent: number;
  /** Whole cents. Applies when kind === 'fixed'. */
  amountCents: number;
  /** Appears on the invoice as the coupon code. Never empty when applied. */
  code: string;
}

export interface ConvertTotals {
  subtotalCents: number;
  /** The reward voucher's own cut of `discountCents`, broken out so the panel
   *  can show it separately from the admin's own discount. */
  rewardCents: number;
  discountCents: number;
  totalCents: number;
}

/** A member's reward voucher (40% off one unit of one line), redeemed at
 *  conversion the same way place-order redeems it. */
export interface RewardDraft {
  voucherId: string;
  /** Whole percent the voucher discounts, e.g. 40. */
  percent: number;
  /** Index into the `lines` array of the line it applies to. */
  lineIndex: number;
}

/** Fallback invoice label when the cart carried no coupon code of its own. */
export const ADMIN_DISCOUNT_CODE = 'MEMBER DISCOUNT';

/**
 * Totals for the composer, to the cent, mirroring recompute_order_totals.
 *
 * A discount is never allowed to exceed the subtotal — the server caps it the
 * same way, and a negative total is not a refund, it is a bug that would be
 * recorded as money owed backwards.
 */
export function convertTotals(
  lines: ConvertLine[],
  discount: DiscountDraft | null,
  reward: RewardDraft | null = null,
): ConvertTotals {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.max(0, Math.round(l.unitPriceCents)) * Math.max(0, Math.round(l.quantity)),
    0,
  );

  const rewardLine = reward ? lines[reward.lineIndex] : undefined;
  const rewardPercent = clampPercent(reward?.percent ?? 0);
  const rewardCents = rewardLine
    ? Math.min(Math.round((rewardLine.unitPriceCents * rewardPercent) / 100), subtotalCents)
    : 0;
  // 052's fence: the reward line's post-reward remainder is off-limits to a
  // percent discount, so the same money is never discounted twice.
  const fenceCents = rewardCents > 0
    ? Math.round((rewardCents * (100 - rewardPercent)) / rewardPercent)
    : 0;

  let otherCents = 0;
  if (discount) {
    if (discount.kind === 'percent') {
      const base = Math.max(subtotalCents - rewardCents - fenceCents, 0);
      otherCents = Math.min(Math.round((base * clampPercent(discount.percent)) / 100), base);
    } else {
      otherCents = Math.min(Math.max(0, Math.round(discount.amountCents)), subtotalCents - rewardCents);
    }
  }

  const discountCents = Math.min(rewardCents + otherCents, subtotalCents);
  return { subtotalCents, rewardCents, discountCents, totalCents: subtotalCents - discountCents };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(percent, 100);
}

/**
 * Seed the composer from the cart the owner already built — the whole point of
 * the feature is that he does not retype it.
 *
 * The unit price seeded is the CATALOG list price, with the member's standing
 * rate seeded separately as the discount. That is deliberately the same shape
 * place-order records (lines at list, the account rate as one order_coupons
 * row), so a converted order and a self-checked-out one read identically on the
 * invoice — and so editing the discount changes one number rather than every
 * line.
 *
 * A line whose (sku, dose) has left the catalog is REPORTED, never seeded at
 * zero: a silent $0 line on an order that has already been paid for is the
 * worst possible failure here.
 */
export function prefillConvertLines(
  cartLines: PreparedCartLine[],
  index: VariantIndex,
): { lines: ConvertLine[]; dropped: PreparedCartLine[] } {
  const lines: ConvertLine[] = [];
  const dropped: PreparedCartLine[] = [];

  for (const line of cartLines) {
    const option = findVariantOption(index, variantOptionKey(line));
    if (!option || option.priceCents <= 0 || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      dropped.push(line);
      continue;
    }
    lines.push({
      sku: option.sku,
      dose: option.dose,
      name: option.name,
      quantity: line.quantity,
      unitPriceCents: option.priceCents,
    });
  }

  return { lines, dropped };
}

/**
 * The discount the composer opens with: the member's own standing rate, resolved
 * exactly as the panel already resolves it (`MemberRow.effectivePercent`, which
 * the roster row carries from `effective_customer_discount`) — no second read,
 * no second opinion. The cart's own coupon code becomes the invoice label when
 * it has one, so a bespoke cart still names its deal on the invoice.
 */
export function prefillDiscount(effectivePercent: number, couponCode: string | null): DiscountDraft {
  return {
    kind: 'percent',
    percent: Math.max(0, Math.min(Math.round(effectivePercent), 100)),
    amountCents: 0,
    code: couponCode?.trim() ? couponCode.trim().toUpperCase() : ADMIN_DISCOUNT_CODE,
  };
}

/**
 * The line the reward defaults to: the highest-priced eligible line, ties
 * broken toward the first such line. null when every line is equipment — a
 * reward has nothing to sit on.
 *
 * ponytail: dose === '' is the equipment marker (preparedCart.ts:41); the
 * server enforces no exclusion of its own, the same as place-order.
 */
export function defaultRewardLineIndex(lines: ConvertLine[]): number | null {
  let bestIndex: number | null = null;
  let bestPriceCents = -1;
  lines.forEach((l, i) => {
    if (l.dose === '' || l.unitPriceCents <= bestPriceCents) return;
    bestIndex = i;
    bestPriceCents = l.unitPriceCents;
  });
  return bestIndex;
}

/** The order-line payload `admin_create_order` validates and records. */
export function convertLinesPayload(lines: ConvertLine[]): Array<{
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  item_note: null;
}> {
  return lines.map((l) => ({
    sku: l.sku,
    product_name: l.name,
    quantity: l.quantity,
    unit_price_cents: l.unitPriceCents,
    item_note: null,
  }));
}

/**
 * The discount payload, or null when there is nothing to record.
 *
 * A zero discount sends NULL rather than a zero-valued row: an order_coupons row
 * reading "MEMBER DISCOUNT −$0.00" on an invoice claims a deal that was not
 * given. The server rejects a non-positive value for the same reason.
 */
export function convertDiscountPayload(
  discount: DiscountDraft | null,
): { kind: DiscountKind; code: string; percent?: number; amount_cents?: number } | null {
  if (!discount) return null;
  const code = discount.code.trim().toUpperCase() || ADMIN_DISCOUNT_CODE;

  if (discount.kind === 'percent') {
    const percent = clampPercent(Math.round(discount.percent));
    return percent > 0 ? { kind: 'percent', code, percent } : null;
  }

  const amountCents = Math.max(0, Math.round(discount.amountCents));
  return amountCents > 0 ? { kind: 'fixed', code, amount_cents: amountCents } : null;
}

/**
 * The reward payload `admin_create_order` validates, or null when there is
 * nothing to record — including a stale `lineIndex` the caller failed to keep
 * in range as lines were added or removed.
 */
export function convertRewardPayload(
  reward: RewardDraft | null,
  lineCount: number,
): { voucher_id: string; line_index: number } | null {
  if (!reward || reward.lineIndex < 0 || reward.lineIndex >= lineCount) return null;
  return { voucher_id: reward.voucherId, line_index: reward.lineIndex };
}

/* ── Input parsing ────────────────────────────────────────────────────────── */

/**
 * A dollars-and-cents field to integer cents. Null for anything that is not a
 * non-negative amount — the caller keeps the last good value rather than
 * recording a guess.
 *
 * Rounded, not truncated: `19.999` typed into a price box means twenty dollars,
 * and `Math.trunc` would quietly record $19.99 on an order already paid.
 */
export function parseUsdToCents(input: string): number | null {
  const text = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** A percent field to a whole percent 0–100. Null for anything outside that. */
export function parsePercentInput(input: string): number | null {
  const text = input.trim().replace(/%$/, '');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value);
}

/** A quantity field to a positive whole number. Null for anything else. */
export function parseQuantityInput(input: string): number | null {
  const text = input.trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
  return value;
}

/* ── The confirmation ─────────────────────────────────────────────────────── */

/**
 * The sentence the owner reads before an order is written against money he has
 * already taken. It states the buyer, the line count and THE EXACT TOTAL,
 * because that total is the thing he is reconciling — a confirmation that said
 * "create this order?" would be worthless at exactly the moment it matters.
 *
 * Built here, from the same `convertTotals` the panel renders, so the number in
 * the dialog cannot drift from the number on screen or from the number the order
 * records.
 */
export function convertConfirmMessage(input: {
  buyerName: string;
  lines: ConvertLine[];
  totals: ConvertTotals;
  discount: DiscountDraft | null;
  reward?: RewardDraft | null;
}): string {
  const { buyerName, lines, totals, discount, reward } = input;
  const count = lines.length;
  const applied = convertDiscountPayload(discount);
  const rewardNote = reward && totals.rewardCents > 0 && lines[reward.lineIndex]
    ? ` incl. a ${reward.percent}% reward credit on ${lines[reward.lineIndex].name}`
    : '';
  const discountNote = (applied && totals.discountCents > 0
    ? ` after ${applied.kind === 'percent' ? `${applied.percent}%` : formatPriceExact(totals.discountCents)} off`
    : '') + rewardNote;

  return (
    `Create a real order for ${buyerName} — ${count} line${count === 1 ? '' : 's'}, ` +
    `total ${formatPriceExact(totals.totalCents)}${discountNote}. ` +
    'These prices are recorded exactly as shown, and the cart link is revoked so it ' +
    'cannot be converted or claimed again.'
  );
}
