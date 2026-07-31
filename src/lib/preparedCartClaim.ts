/**
 * preparedCartClaim — the pure half of redeeming a prepared-cart link.
 *
 * The page (src/pages/account/AccountPreparedCart.tsx) owns rendering and the
 * cart writes; everything decidable without React lives here, both because
 * `src/pages/**` is outside the coverage globs and because every rule below is
 * a security or correctness rule that deserves a test naming it.
 *
 * ── THE TOKEN RIDES IN THE HASH, AND LEAVES IT IMMEDIATELY ──────────────────
 * `preparedCartClaimUrl` (081's contract, src/pages/admin/members/
 * usePreparedCart.ts) puts the token in the URL FRAGMENT — `#t=<token>` —
 * never a query string. That is not cosmetic:
 *
 *   • a fragment is never sent to a server, so the token is not in any access
 *     log, CDN log or edge-function request;
 *   • a fragment is stripped from the `Referer` header, so the token does not
 *     leak to the first third-party asset the page loads.
 *
 * The remaining exposures are the address bar, the browser's own history, and
 * anything that later reads `location.href`. `takeClaimToken` closes all three
 * on first mount: it reads the fragment once, rewrites the URL with
 * `history.replaceState` (replace, not push — a `pushState` would leave the
 * tokenised URL one Back press away), and hands the token to sessionStorage.
 *
 * ── WHY SESSIONSTORAGE, DELIBERATELY ────────────────────────────────────────
 * A member who has never signed in on this device gets AccountLayout's AuthCard
 * instead of the claim, and the claim UI does not mount until they are through
 * it. In-page sign-in (password or OTP) does not remount the route, so a ref
 * would survive — but the sign-UP path does not stay in the page:
 * customerAuth's `emailRedirectTo` is `${origin}/account`, so confirming by
 * e-mail lands the member on a different route in a fresh document, and a ref
 * (or any in-memory value) is gone. sessionStorage survives that, is scoped to
 * the one tab, and dies when the tab does — the right lifetime for a
 * credential. `clearStoredClaimToken` runs the moment the claim reaches a
 * terminal answer, so a redeemed or rejected token is not left lying around for
 * the rest of the session.
 */

import type { PreparedCartLine } from './preparedCart';

/** The fragment key `preparedCartClaimUrl` writes. */
export const CLAIM_TOKEN_KEY = 't';

/** Tab-scoped holding pen for the token across the sign-in round trip. */
export const CLAIM_TOKEN_STORAGE_KEY = 'vsrl_prepared_cart_token';

/**
 * Every reason `claim_prepared_cart` (082) can answer with, plus the two the
 * client itself can conclude. `not_found` deliberately covers a wrong-user
 * token as well as a nonexistent one — the RPC cannot tell them apart by
 * design, and neither can this.
 */
export type ClaimReason =
  | 'not_signed_in'
  | 'not_found'
  | 'revoked'
  | 'expired'
  /** No `#t=` anywhere — someone reached the route without a link. */
  | 'no_token'
  /** The RPC failed, timed out, or answered something unrecognisable. */
  | 'unavailable';
// There is deliberately NO `already_claimed`. The cart this page fills is
// zustand-persisted into localStorage (src/hooks/useCart.ts), so it is
// PER-DEVICE: a member who opens the mail on a phone and buys on a laptop must
// be able to open the same link twice. Refusing the second open would point
// them at an empty cart — indistinguishable from the broken link this page
// exists to replace. Convergence comes instead from SETTING each prepared
// quantity rather than adding to it, so a second or third open lands on the
// same cart.

export interface ClaimSuccess {
  ok: true;
  cartId: string;
  couponCode: string | null;
  note: string | null;
  expiresAt: string | null;
  /** False when the member has opened this link before. Copy only — the apply
   *  is idempotent either way. */
  firstClaim: boolean;
  lines: PreparedCartLine[];
}

export interface ClaimFailure {
  ok: false;
  reason: ClaimReason;
}

export type ClaimResult = ClaimSuccess | ClaimFailure;

/* ── Token capture ─────────────────────────────────────────────────────────── */

/** Pull the token out of a raw `location.hash`. Tolerates the leading `#`,
 *  multiple `&`-joined keys and percent-encoding; returns null for anything
 *  that does not carry a non-empty `t`. */
export function parseClaimToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get(CLAIM_TOKEN_KEY);
  const trimmed = (token ?? '').trim();
  return trimmed ? trimmed : null;
}

/**
 * First-mount token capture. Idempotent and safe to call on a page reached
 * without a link.
 *
 * Order matters: the token is stored BEFORE the URL is rewritten, so a rewrite
 * that throws (some embedded webviews refuse `replaceState`) cannot lose the
 * token — it can only fail to hide it, which the caller cannot do anything
 * about anyway.
 *
 * Returns the token from the fragment, or the one a previous visit stored, or
 * null.
 */
export function takeClaimToken(win: Window): string | null {
  const fromHash = parseClaimToken(win.location?.hash ?? '');

  if (fromHash) {
    try {
      win.sessionStorage?.setItem(CLAIM_TOKEN_STORAGE_KEY, fromHash);
    } catch {
      // Private mode / storage disabled. The claim still works in this
      // document; only the sign-up-by-email round trip loses it.
    }
    scrubClaimToken(win);
    return fromHash;
  }

  try {
    const stored = (win.sessionStorage?.getItem(CLAIM_TOKEN_STORAGE_KEY) ?? '').trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

/** Rewrite the address bar without the fragment. `replaceState`, never
 *  `pushState`: a pushed entry would leave the tokenised URL one Back press
 *  away, and would put it in the session history a later `location.href` read
 *  could still reach. */
export function scrubClaimToken(win: Window): void {
  try {
    const { pathname, search } = win.location;
    win.history?.replaceState(null, '', `${pathname}${search}`);
  } catch {
    // Nothing actionable: the token is already captured either way.
  }
}

export function clearStoredClaimToken(win: Window): void {
  try {
    win.sessionStorage?.removeItem(CLAIM_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

/* ── RPC boundary ──────────────────────────────────────────────────────────── */

const KNOWN_REASONS: ReadonlySet<string> = new Set<ClaimReason>([
  'not_signed_in',
  'not_found',
  'revoked',
  'expired',
  'no_token',
  'unavailable',
]);

function normalizeLine(raw: unknown): PreparedCartLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Record<string, unknown>;
  const sku = typeof line.sku === 'string' ? line.sku.trim() : '';
  const dose = typeof line.dose === 'string' ? line.dose.trim() : '';
  const quantity = typeof line.quantity === 'number' ? line.quantity : Number.NaN;
  if (!sku || !Number.isInteger(quantity) || quantity <= 0) return null;
  return { sku, dose, quantity };
}

/**
 * Validate what `claim_prepared_cart` returned before a single line reaches the
 * cart. Never trust a response shape: an unrecognised body is `unavailable`,
 * not an empty success, so the member is told something went wrong instead of
 * being shown a cheerful "0 items added".
 */
export function normalizeClaimResult(raw: unknown): ClaimResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'unavailable' };
  const body = raw as Record<string, unknown>;

  if (body.ok !== true) {
    const reason = typeof body.reason === 'string' ? body.reason : '';
    return { ok: false, reason: KNOWN_REASONS.has(reason) ? (reason as ClaimReason) : 'unavailable' };
  }

  const lines = Array.isArray(body.lines)
    ? body.lines.map(normalizeLine).filter((l): l is PreparedCartLine => l !== null)
    : [];

  return {
    ok: true,
    cartId: typeof body.cart_id === 'string' ? body.cart_id : '',
    couponCode: typeof body.coupon_code === 'string' && body.coupon_code.trim() ? body.coupon_code.trim() : null,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
    // Absent (an older function, a partial body) reads as a re-open, which is
    // the quieter of the two copy paths — never a false "first time".
    firstClaim: body.first_claim === true,
    lines,
  };
}

/* ── Failure copy ──────────────────────────────────────────────────────────── */

export interface ClaimCopy {
  headline: string;
  detail: string;
  /** Which recovery affordance the page should offer alongside the message. */
  action: 'cart' | 'contact' | 'shop' | 'none';
}

/**
 * Plain English for every way a claim can fail. No blank screens and no silent
 * redirects — a member who followed a link the owner sent them is owed a
 * sentence that says what happened and what to do next.
 *
 * `not_found` is the one that carries real weight. It is returned both for a
 * token that does not exist AND for a real token opened by the wrong account,
 * and the second is far and away the likeliest thing to actually happen: the
 * member has two mailboxes, or a partner's browser is signed in, or they
 * created a second account. So the copy leads with THAT reading and names the
 * account they are currently signed in as — the one fact that makes the
 * mismatch obvious. It stops short of confirming the link is real, because the
 * RPC deliberately does not tell us.
 */
export function claimFailureCopy(reason: ClaimReason, signedInEmail?: string | null): ClaimCopy {
  switch (reason) {
    case 'not_found':
      return {
        headline: 'This cart isn’t on this account',
        detail: signedInEmail
          ? `You’re signed in as ${signedInEmail}. A prepared cart only opens for the account it was built for, ` +
            'so if the link came to a different email address, sign out and sign back in with that one. ' +
            'If this is the right address, the link may have been mistyped or replaced — ask us for a fresh one.'
          : 'A prepared cart only opens for the account it was built for. Sign in with the email address the ' +
            'link was sent to, or ask us for a fresh one.',
        action: 'contact',
      };
    case 'expired':
      return {
        headline: 'This link has expired',
        detail:
          'Prepared carts stay open for 14 days so the prices you were quoted stay honest. Nothing is lost — ' +
          'ask us to rebuild it and you’ll get a new link.',
        action: 'contact',
      };
    case 'revoked':
      return {
        headline: 'This link was withdrawn',
        detail:
          'We turned this cart off, usually because it was replaced by a newer one. Check for a more recent ' +
          'email, or ask us and we’ll send a fresh link.',
        action: 'contact',
      };
    case 'no_token':
      return {
        headline: 'No cart link here',
        detail:
          'This page opens a cart we prepared for you, and it needs the full link from your email. Open the ' +
          'link again — copying just the address from the top of the browser leaves the important part behind.',
        action: 'shop',
      };
    case 'not_signed_in':
      return {
        headline: 'Sign in to open this cart',
        detail: 'Sign in with the email address the link was sent to and it will open automatically.',
        action: 'none',
      };
    case 'unavailable':
    default:
      return {
        headline: 'We couldn’t open this cart',
        detail:
          'Something went wrong on our side, not yours — the link is probably fine. Try again in a moment, ' +
          'and tell us if it keeps happening.',
        action: 'contact',
      };
  }
}

/* ── Outcome summary ───────────────────────────────────────────────────────── */

export interface ClaimOutcomeSummary {
  /** Total units this prepared cart accounts for, after the apply. */
  addedUnits: number;
  /** Distinct catalog lines applied. */
  addedLines: number;
  /** Applied lines that were ALREADY at the prepared quantity — nothing moved. */
  unchangedLines: number;
  /** Applied lines whose pre-existing quantity was replaced by the prepared one. */
  replacedLines: number;
  /** "SKU · dose" for each line planPreparedCart refused to guess at. */
  skipped: string[];
  /** True when the cart held items that are NOT part of this prepared cart.
   *  Deliberately not "the cart was non-empty" — on a re-open the cart is full
   *  of this very cart, and saying "you already had items" would be noise. */
  mergedIntoExistingCart: boolean;
}

/**
 * One sentence describing what landed in the cart.
 *
 * Three things are worth saying and are all said:
 *
 *   • THE MERGE. The member's own cart is theirs; we add to it rather than
 *     wiping it. But a silent merge is its own trap — the total would not match
 *     the quote with nothing on screen to explain it — so a cart holding OTHER
 *     items says so outright.
 *   • THE RE-OPEN. The link stays openable (the cart is device-local, so
 *     phone-then-laptop is normal), and the apply SETS quantities rather than
 *     adding to them. Re-opening on the same device therefore changes nothing,
 *     and the copy says exactly that instead of claiming a fresh add.
 *   • THE REPLACEMENT. If the member had picked their own quantity for a line
 *     this cart also contains, the prepared amount wins — that is what makes
 *     re-opens converge — but it is their number being overwritten, so it is
 *     named rather than done quietly.
 */
export function claimOutcomeMessage(summary: ClaimOutcomeSummary): string {
  const { addedUnits, addedLines, unchangedLines, replacedLines, skipped, mergedIntoExistingCart } = summary;

  if (addedLines === 0) {
    return skipped.length > 0
      ? 'None of the items in this cart are available any more. Nothing was added — please get in touch and ' +
          'we’ll put together a replacement.'
      : 'This cart is empty — nothing was added.';
  }

  const units = `${addedUnits} item${addedUnits === 1 ? '' : 's'}`;
  const lines = `${addedLines} line${addedLines === 1 ? '' : 's'}`;

  let head: string;
  if (unchangedLines === addedLines) {
    // Same device, opened again. Nothing moved, and saying "added" would be a
    // lie the totals would immediately contradict.
    head =
      `This cart is already in your cart — ${units} across ${lines}, exactly as prepared. ` +
      'Opening the link again never doubles anything, so use it from whichever device you like.';
  } else if (mergedIntoExistingCart) {
    head =
      `Added ${units} across ${lines} to the cart you already had — your existing items are still there, so ` +
      'the total below covers both.';
  } else {
    head = `Added ${units} across ${lines} to your cart.`;
  }

  const parts = [head];

  // The merge is still worth saying on a re-open — those other items are still
  // in the total — but it belongs after "nothing changed", not instead of it.
  if (unchangedLines === addedLines && mergedIntoExistingCart) {
    parts.push('The other items you had in your cart are still there too, so the total below covers both.');
  }

  if (replacedLines > 0) {
    parts.push(
      `${replacedLines} line${replacedLines === 1 ? '' : 's'} ${
        replacedLines === 1 ? 'was' : 'were'
      } already in your cart at a different quantity and ${
        replacedLines === 1 ? 'has' : 'have'
      } been set to the prepared amount — change it back any time.`,
    );
  }

  if (skipped.length > 0) {
    parts.push(
      `${skipped.length} item${skipped.length === 1 ? '' : 's'} (${skipped.join(', ')}) ${
        skipped.length === 1 ? 'is' : 'are'
      } no longer available and ${skipped.length === 1 ? 'was' : 'were'} left out.`,
    );
  }

  return parts.join(' ');
}

/**
 * What to tell a member whose promised code did not take. Never silent: the
 * code is the whole reason the price was worth quoting, and a member who checks
 * out without it pays more than they were told they would.
 */
export function couponFailureMessage(code: string, reason: string): string {
  return (
    `The code ${code} that came with this cart didn’t apply — ${reason} ` +
    'Please don’t check out at this price; tell us and we’ll fix it first.'
  );
}
