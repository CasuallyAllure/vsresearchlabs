/**
 * cartIncentives — what the cart panel is allowed to tell a buyer they are
 * getting, and what is genuinely within reach.
 *
 * The hard part is not the copy, it is the precedence. On a real order these
 * offers do NOT add up, and a panel that lists them additively would quote a
 * discount the buyer never receives. place-order resolves it in this order,
 * and so does this module:
 *
 *   1. WHOLESALE wins anywhere in the cart → final price order-wide. It
 *      suppresses the bundle, BOGO, B2G1 and the member percentage on every line.
 *   2. BUNDLE (Reta + GHK-Cu) → final price. Suppresses BOGO, B2G1 and the
 *      member percentage.
 *   3. Otherwise the LARGER of {BOGO, B2G1} — they are mutually exclusive by
 *      construction (BOGO pairs 24-hour lines, B2G1 frees sourced ones) and the
 *      caller hands in at most one non-zero.
 *   4. That winner vs the member percentage — the LARGER bills, tie → the promo
 *      (owner policy 2026-07-22, extended to BOGO). They never stack.
 *
 * Free shipping sits outside that ladder: it is a membership perk, not a
 * discount, so it applies alongside whichever of the above wins.
 *
 * DISPLAY ONLY. Every figure here is a preview of what place-order will
 * independently recompute from the verified session; nothing is billed from
 * this module. When a value cannot be determined confidently the row is
 * omitted rather than estimated — under-promising is the only safe direction.
 */

import { GUEST_SHIPPING_CENTS } from './shipping';
import { SAME_DAY_MINIMUM_CENTS, centsToSameDay, sameDayProgress } from './sameDayDelivery';

export type IncentiveKind = 'applied' | 'reachable' | 'invitation';

export interface IncentiveRow {
  id: string;
  kind: IncentiveKind;
  label: string;
  detail: string;
  /** Worth right now for `applied`; worth once unlocked for the others. */
  valueCents?: number;
  /** 0..1 rail for threshold rows. Absent when there is no threshold. */
  progress?: number;
  /** Threshold rows only: the cart has already cleared the bar. */
  met?: boolean;
}

export interface CartIncentiveInput {
  /** Cart subtotal before discounts and shipping. */
  subtotalCents: number;
  /** Signed-in account holder. */
  isMember: boolean;
  /** The percentage this buyer receives (or would, as a guest). */
  memberPercent: number;
  /** B2G1 value for this cart, already gated by promo liveness + ship speed. */
  b2g1Cents: number;
  /** LAUNCH DAY BOGO value, already gated by promo liveness + membership +
   *  24-hour supply. Mutually exclusive with b2g1Cents — the caller has already
   *  stood the loser down, so at most one of the two is non-zero. Absent on
   *  callers predating the promo, which reads as 0. */
  bogoCents?: number;
  /** A wholesale pack line won somewhere → final price order-wide. */
  wholesaleApplies: boolean;
  /** Bundle discount value; 0 when no complete pair is in the cart. */
  bundleCents: number;
}

export interface CartIncentives {
  applied: IncentiveRow[];
  reachable: IncentiveRow[];
  /** Total the buyer is saving on this cart right now. */
  savingCents: number;
  /** For guests: what an account would add on THIS cart, exclusivity applied.
   *  0 for members and whenever a final price already outranks the member
   *  percentage. */
  memberUpliftCents: number;
}

const fmt = (cents: number): string =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

/** The member percentage's cash value on this subtotal. */
function memberValueCents(subtotalCents: number, percent: number): number {
  if (subtotalCents <= 0 || percent <= 0) return 0;
  return Math.round((subtotalCents * percent) / 100);
}

/**
 * Which discount actually bills, following the precedence ladder above.
 * Exported for tests and so the panel can label the winner without
 * re-deriving the rules.
 */
export function winningDiscount(input: CartIncentiveInput): {
  kind: 'wholesale' | 'bundle' | 'bogo' | 'b2g1' | 'member' | 'none';
  valueCents: number;
} {
  if (input.wholesaleApplies) return { kind: 'wholesale', valueCents: 0 };
  if (input.bundleCents > 0) return { kind: 'bundle', valueCents: input.bundleCents };

  const memberCents = input.isMember
    ? memberValueCents(input.subtotalCents, input.memberPercent)
    : 0;

  // Owner policy: larger wins, tie → the automatic promo. BOGO is checked
  // first only for determinism — it and B2G1 are never both non-zero.
  const bogoCents = input.bogoCents ?? 0;
  if (bogoCents > 0 && bogoCents >= memberCents) {
    return { kind: 'bogo', valueCents: bogoCents };
  }
  if (input.b2g1Cents > 0 && input.b2g1Cents >= memberCents) {
    return { kind: 'b2g1', valueCents: input.b2g1Cents };
  }
  if (memberCents > 0) return { kind: 'member', valueCents: memberCents };
  return { kind: 'none', valueCents: 0 };
}

/**
 * What a guest would gain by creating an account on THIS cart: the shipping
 * waiver, plus the member percentage but ONLY to the extent it beats what
 * they are already getting. A guest already receiving a bigger B2G1 term
 * gains nothing but the shipping — and the panel says so rather than
 * inflating the number.
 */
export function memberUpliftCents(input: CartIncentiveInput): number {
  if (input.isMember) return 0;

  // A final price outranks the member percentage entirely — shipping only.
  if (input.wholesaleApplies || input.bundleCents > 0) return GUEST_SHIPPING_CENTS;

  const memberCents = memberValueCents(input.subtotalCents, input.memberPercent);
  // Guests already receive B2G1; an account only helps where the percentage
  // is worth strictly more (tie → B2G1, which the guest already has).
  const discountGain = Math.max(0, memberCents - input.b2g1Cents);
  return discountGain + GUEST_SHIPPING_CENTS;
}

function appliedRows(input: CartIncentiveInput): IncentiveRow[] {
  const rows: IncentiveRow[] = [];
  const win = winningDiscount(input);

  if (win.kind === 'wholesale') {
    rows.push({
      id: 'wholesale',
      kind: 'applied',
      label: 'Wholesale pack pricing',
      detail:
        'Your case quantity prices as wholesale — a final price, so it replaces the member percentage ' +
        'and the buy-2-get-1 term rather than adding to them. Pack orders ship in 7–10 business days.',
    });
  } else if (win.kind === 'bundle') {
    rows.push({
      id: 'bundle',
      kind: 'applied',
      label: 'RTT + GHK-Cu bundle',
      detail:
        'Your complete pair prices as a bundle — a final price, so it replaces the member percentage ' +
        'and the buy-2-get-1 term rather than adding to them.',
      valueCents: win.valueCents,
    });
  } else if (win.kind === 'bogo') {
    rows.push({
      id: 'bogo',
      kind: 'applied',
      label: 'Launch Day BOGO — buy one, get one free',
      detail:
        'Eligible 24-Hour Shipping items pair two at a time and the cheaper item of each pair comes ' +
        'off the order. Promotions never combine — this is worth at least as much as your member ' +
        'percentage on this cart, so it is the one that bills.',
      valueCents: win.valueCents,
    });
  } else if (win.kind === 'b2g1') {
    rows.push({
      id: 'b2g1',
      kind: 'applied',
      label: 'Buy 2, get 1 free',
      detail: input.isMember
        ? 'Your third unit is supplied at no charge. This is worth more to you than your member ' +
          'percentage on this cart, so it is the one that bills — the two never stack.'
        : 'Your third unit is supplied at no charge, applied at checkout.',
      valueCents: win.valueCents,
    });
  } else if (win.kind === 'member') {
    rows.push({
      id: 'member-discount',
      kind: 'applied',
      label: `Member pricing · ${input.memberPercent}% off`,
      detail: 'Applied automatically at checkout — no code needed.',
      valueCents: win.valueCents,
    });
  }

  if (input.isMember) {
    rows.push({
      id: 'member-shipping',
      kind: 'applied',
      label: 'Free shipping',
      detail: 'Shipping is waived on every member order — no minimums, no codes.',
      valueCents: GUEST_SHIPPING_CENTS,
    });
  }

  return rows;
}

function reachableRows(input: CartIncentiveInput): IncentiveRow[] {
  const rows: IncentiveRow[] = [];

  // Same-day: a fulfilment term, never stated as a guarantee — the buyer's
  // address is usually unknown at this point, so the zones stay in the copy.
  const remaining = centsToSameDay(input.subtotalCents);
  if (input.wholesaleApplies) {
    // Wholesale case orders are explicitly excluded from the term.
  } else if (remaining > 0) {
    rows.push({
      id: 'same-day',
      kind: 'reachable',
      label: `Add ${fmt(remaining)} for same-day delivery`,
      detail:
        `Orders over ${fmt(SAME_DAY_MINIMUM_CENTS)} delivering to our Bay Area zones qualify for ` +
        `same- to next-day delivery. Wholesale case orders are excluded.`,
      progress: sameDayProgress(input.subtotalCents),
      met: false,
    });
  } else {
    rows.push({
      id: 'same-day',
      kind: 'reachable',
      label: 'Qualifies for same-day delivery',
      detail:
        'This order clears the same-day floor. Delivering to one of our Bay Area zones? It qualifies ' +
        'for same- to next-day delivery.',
      progress: 1,
      met: true,
    });
  }

  if (!input.isMember) {
    const uplift = memberUpliftCents(input);
    rows.push({
      id: 'member-invite',
      kind: 'invitation',
      label: `Create an account — save ${fmt(uplift)} on this order`,
      detail:
        `Account holders get ${input.memberPercent}% off automatically and ship free, with no code and ` +
        `no minimum. Guest checkout always stays open.`,
      valueCents: uplift,
    });
  }

  return rows;
}

/** The full panel model for a cart. */
export function cartIncentives(input: CartIncentiveInput): CartIncentives {
  const applied = appliedRows(input);
  const reachable = reachableRows(input);
  const savingCents = applied.reduce((sum, r) => sum + (r.valueCents ?? 0), 0);
  return {
    applied,
    reachable,
    savingCents,
    memberUpliftCents: memberUpliftCents(input),
  };
}
