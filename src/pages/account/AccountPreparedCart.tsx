/**
 * AccountPreparedCart — /account/prepared
 *
 * The member-facing half of the prepared cart. The owner builds a cart from the
 * roster row (081 + PreparedCartPanel), we email a link, and this page is what
 * the link opens. It did not exist when the first link went out, which is why a
 * real client hit a 404 — so the one thing it must never do is show nothing.
 *
 * ── SIGN-IN COMES FOR FREE ──────────────────────────────────────────────────
 * It renders inside AccountLayout like every other portal page, so a signed-out
 * visitor gets the existing AuthCard in place, on this URL, and lands back here
 * the moment the session appears. There is no bespoke gate and no redirect.
 *
 * The TOKEN CAPTURE lives in the outer component, ABOVE AccountLayout, because
 * the inner content does not mount at all while the visitor is signed out — a
 * capture on the inside would miss the very case it exists for. It runs once,
 * scrubs the fragment, and parks the token in sessionStorage so it also
 * survives the sign-up-by-email round trip, which leaves the document entirely.
 * See src/lib/preparedCartClaim.ts for why the fragment (and not a query
 * param), and why sessionStorage.
 *
 * ── THE DOSE IS THE WHOLE BALLGAME ──────────────────────────────────────────
 * Every line goes into the cart through `variantProduct(product, dose)`. A bare
 * `add()` drops the dose, `deriveProductDose` then resolves "" from the family
 * name, the per-(sku,dose) price lookup misses, and the order line is written at
 * $0 — that happened in production (src/lib/cartActions.ts:1-24). `planPrepared
 * Cart` refuses to emit any line it cannot dose, and this page never adds one
 * it did not get from that plan.
 *
 * ── ADD, DON'T WIPE — AND OPENING TWICE IS SAFE ─────────────────────────────
 * The member's own cart is theirs. We merge into it rather than replacing it,
 * and when it held unrelated items we SAY SO — a silent merge would make the
 * total disagree with the quote with nothing on screen to explain it.
 *
 * Within that merge, each PREPARED line's quantity is SET to the prepared
 * amount rather than added to. The link stays openable until it expires or is
 * revoked (082), and it has to: this cart lives in localStorage, so it is
 * per-device, and opening the mail on a phone then buying on a laptop is the
 * normal path rather than an edge case. Setting is what makes the second and
 * third open converge on the same cart instead of compounding into a doubled
 * order. Where that overwrites a quantity the member chose themselves, the copy
 * names it.
 *
 * Nothing here is authoritative for money. place-order re-resolves every price,
 * the account discount and the coupon server-side and fails closed on a
 * mismatch; this page only assembles a cart.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { useAccountSession } from '../../lib/accountSession';
import { supabase } from '../../lib/supabase';
import { useCart } from '../../hooks/useCart';
import { variantProduct, cartSubtotalCents } from '../../lib/cartActions';
import { checkCoupon } from '../../lib/coupons';
import { planPreparedCart } from '../../lib/preparedCart';
import { RPC_TIMEOUT_SECONDS, rpcWithTimeout, withTimeout } from '../../lib/rpcTimeout';
import {
  claimFailureCopy,
  claimOutcomeMessage,
  clearStoredClaimToken,
  couponFailureMessage,
  normalizeClaimResult,
  takeClaimToken,
  type ClaimCopy,
  type ClaimReason,
} from '../../lib/preparedCartClaim';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/system/ErrorState';

/** The full catalog, enumerated exactly as the admin composer does. */
const CATALOG = [...productsData, ...generatedCompounds] as unknown as Product[];

const TIMEOUT_MESSAGE =
  `The cart didn’t open within ${RPC_TIMEOUT_SECONDS} seconds. Your connection may have dropped — ` +
  'try the link again.';

const COUPON_TIMEOUT_MESSAGE = `The code check did not answer within ${RPC_TIMEOUT_SECONDS} seconds.`;

/** Reason text for a coupon check that never came back at all — phrased to
 *  slot into `couponFailureMessage`'s sentence like the server's own reasons. */
const COUPON_UNREACHABLE = 'we couldn’t reach the code checker just now.';

type Phase = 'idle' | 'working' | 'done' | 'failed';

interface Outcome {
  message: string;
  couponApplied: string | null;
  couponProblem: string | null;
}

function PreparedCartContent({ token }: { token: string | null }) {
  const { user } = useAccountSession();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<ClaimCopy | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // The claim has a side effect (it stamps claimed_at and fills a cart), so it
  // must fire exactly once per mount even under StrictMode's double-invoke.
  const started = useRef(false);

  const fail = useCallback(
    (reason: ClaimReason) => {
      setFailure(claimFailureCopy(reason, user?.email ?? null));
      setPhase('failed');
    },
    [user?.email],
  );

  const runClaim = useCallback(async () => {
    if (!token) {
      fail('no_token');
      return;
    }
    if (!supabase) {
      fail('unavailable');
      return;
    }

    setPhase('working');

    /* ── 1. Claim ─────────────────────────────────────────────────────────
       Its own try/catch, so a timeout or a rejection here is answered as a
       failure state and never as a hang. */
    let data: unknown;
    try {
      const res = await rpcWithTimeout(supabase, 'claim_prepared_cart', { p_token: token }, TIMEOUT_MESSAGE);
      if (res.error) {
        console.error('[preparedCart] claim_prepared_cart failed', res.error);
        fail('unavailable');
        return;
      }
      data = res.data;
    } catch (err) {
      console.error('[preparedCart] claim_prepared_cart threw', err);
      fail('unavailable');
      return;
    }

    const result = normalizeClaimResult(data);
    // Terminal either way: the token has now been either spent or refused, so
    // it must not sit in sessionStorage waiting to surprise a later visit.
    clearStoredClaimToken(window);

    if (!result.ok) {
      fail(result.reason);
      return;
    }

    /* ── 2. Fill the cart — IDEMPOTENTLY ──────────────────────────────────
       Each prepared line's quantity is SET to the prepared amount, never added
       to it. That is what makes the link safe to open more than once, and it
       has to be safe: the cart is device-local (localStorage), so opening the
       mail on a phone and buying on a laptop is the NORMAL path, and a second
       or third open must converge on the same cart rather than compound into a
       doubled order. */
    const before = useCart.getState().items;
    const plan = planPreparedCart(result.lines, CATALOG);

    let unchangedLines = 0;
    let replacedLines = 0;
    const preparedIds = new Set<string>();

    for (const item of plan.addable) {
      // NOT a bare add(): variantProduct bakes the dose into the line id, name
      // and price. Without it the order line is written at $0.
      const line = variantProduct(item.product, item.dose);
      preparedIds.add(line.id);

      const existing = before.find((i) => i.product.id === line.id);
      if (existing?.quantity === item.quantity) unchangedLines += 1;
      else if (existing) replacedLines += 1;

      // add() creates the line (qty 1) or bumps an existing one; the SET that
      // follows lands the prepared quantity in ONE write — both idempotent and
      // cheaper than calling add() up to 9,999 times.
      useCart.getState().add(line);
      useCart.getState().updateQuantity(line.id, item.quantity);
    }

    // "You already had items" must mean items that are NOT part of this cart.
    // Otherwise a re-open — whose cart is full of this very cart — would report
    // a merge that did not happen.
    const mergedIntoExistingCart = before.some((i) => !preparedIds.has(i.product.id));

    const message = claimOutcomeMessage({
      addedUnits: plan.addable.reduce((sum, i) => sum + i.quantity, 0),
      addedLines: plan.addable.length,
      unchangedLines,
      replacedLines,
      skipped: plan.skipped,
      mergedIntoExistingCart,
    });

    /* ── 3. Apply the promised code ───────────────────────────────────────
       Separately guarded ON PURPOSE: the cart is already filled by this point,
       and a code checker that is slow or down must not throw that away. Only
       the CODE travels — validate_coupon (031) resolves it server-side, and
       place-order re-prices it again at checkout. */
    let couponApplied: string | null = null;
    let couponProblem: string | null = null;
    if (result.couponCode) {
      try {
        const state = useCart.getState();
        const check = await withTimeout(
          checkCoupon(result.couponCode, cartSubtotalCents(state.items), {
            appliedCodes: state.coupons.map((c) => c.code),
            hasAccount: true,
          }),
          COUPON_TIMEOUT_MESSAGE,
        );
        if (check.ok) {
          useCart.getState().addCoupon(check.coupon);
          couponApplied = check.coupon.code;
        } else {
          // Never silent. A member who checks out without the code they were
          // promised pays more than they were told they would.
          couponProblem = couponFailureMessage(result.couponCode, check.reason);
        }
      } catch (err) {
        console.error('[preparedCart] coupon check failed', err);
        couponProblem = couponFailureMessage(result.couponCode, COUPON_UNREACHABLE);
      }
    }

    setOutcome({ message, couponApplied, couponProblem });
    setPhase('done');

    // Straight to the cart ONLY when there is nothing they need to read first.
    // A merge with unrelated items, or a quantity of theirs we replaced, always
    // stops here: the total is about to disagree with the quote, and that has to
    // be said rather than discovered.
    const nothingToRead =
      plan.addable.length > 0 && plan.skipped.length === 0 && !couponProblem &&
      !mergedIntoExistingCart && replacedLines === 0;
    if (nothingToRead) navigate('/cart');
  }, [token, fail, navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runClaim();
  }, [runClaim]);

  if (phase === 'idle' || phase === 'working') {
    return (
      <p role="status" className="py-[var(--space-8)] text-[13px] text-ink/50">
        Opening the cart we prepared for you…
      </p>
    );
  }

  if (phase === 'failed' && failure) {
    return (
      <section>
        <header className="mb-[var(--space-4)]">
          <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/35">
            Prepared cart
          </p>
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink">
            {failure.headline}
          </h2>
        </header>
        <ErrorState message={failure.detail} action={<FailureAction copy={failure} />} />
      </section>
    );
  }

  return (
    <section>
      <header className="mb-[var(--space-4)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/35">
          Prepared cart
        </p>
        <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink">
          Your cart is ready
        </h2>
      </header>

      <div className="floating-module p-[var(--space-4)] sm:p-[var(--space-5)]">
        <p role="status" className="text-[13px] leading-relaxed text-ink/70">
          {outcome?.message}
        </p>

        {outcome?.couponApplied && (
          <p className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/60">
            Code{' '}
            <span className="font-mono tracking-[0.08em] text-ink/80">{outcome.couponApplied}</span>{' '}
            is applied. Your account discount is automatic and is applied at checkout.
          </p>
        )}

        {outcome?.couponProblem && (
          <p role="alert" className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/70">
            {outcome.couponProblem}
          </p>
        )}

        <p className="mt-[var(--space-3)] text-[11.5px] leading-relaxed text-ink/40">
          Prices are resolved live and again at checkout — nothing was locked in when this cart was
          built.
        </p>

        <div className="mt-[var(--space-5)] flex flex-wrap items-center gap-[var(--space-3)]">
          <Button type="button" variant="primary" size="sm" onClick={() => navigate('/cart')}>
            Go to cart
          </Button>
          <Link
            to="/contact"
            className="text-[11px] uppercase tracking-[0.18em] text-ink/45 transition-colors hover:text-ink/75"
          >
            Something look wrong?
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The one recovery affordance that fits the failure — never a dead end. */
function FailureAction({ copy }: { copy: ClaimCopy }) {
  if (copy.action === 'cart') {
    return (
      <Link
        to="/cart"
        className="text-[11px] uppercase tracking-[0.18em] text-ink/45 transition-colors hover:text-ink/75"
      >
        View your cart
      </Link>
    );
  }
  if (copy.action === 'contact') {
    return (
      <Link
        to="/contact"
        className="text-[11px] uppercase tracking-[0.18em] text-ink/45 transition-colors hover:text-ink/75"
      >
        Ask us for a new link
      </Link>
    );
  }
  if (copy.action === 'shop') {
    return (
      <Link
        to="/store"
        className="text-[11px] uppercase tracking-[0.18em] text-ink/45 transition-colors hover:text-ink/75"
      >
        Browse the catalog
      </Link>
    );
  }
  return null;
}

export function AccountPreparedCart() {
  // Captured HERE, outside AccountLayout, because the content below does not
  // mount while the visitor is signed out — and the signed-out visitor is
  // exactly the one arriving with a token in the URL. Once only, in a ref, so
  // a re-render (or the session arriving) cannot re-read an already-scrubbed
  // fragment and conclude there was never a token.
  const [token] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : takeClaimToken(window),
  );

  return (
    <AccountLayout>
      <PreparedCartContent token={token} />
    </AccountLayout>
  );
}

export default AccountPreparedCart;
