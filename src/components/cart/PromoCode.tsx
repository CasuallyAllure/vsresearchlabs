/**
 * PromoCode — shared promo-code field + discount summary rows.
 *
 * Rendered by BOTH cart surfaces (CartDrawer + /cart page) so the two UIs
 * can't drift: one input, one applied-chip, one set of summary rows.
 *
 * The Apply button hits the anon `validate_coupon` RPC for a live check and
 * stores the snapshot in useCart (persisted, so the code survives moving
 * between drawer and cart page). Billing stays server-side — checkout sends
 * only the CODE and place-order re-validates + re-prices it.
 *
 * Monochrome direction: no accent colors — ink tones only.
 */

import { useState } from 'react';
import { useCart, type AppliedCoupon } from '../../hooks/useCart';
import {
  checkCoupon,
  couponBreakdown,
  couponStillQualifies,
  freeItemLineValue,
  submittableCouponCodes as pickSubmittableCodes,
} from '../../lib/coupons';
import { formatUsd } from '../../lib/payment';

interface PromoCodeProps {
  /** Current cart subtotal in cents (caller computes it with lineUnitCents). */
  subtotalCents: number;
  /** drawer = tighter type scale to match the slide-out footer. */
  variant: 'drawer' | 'page';
}

export function PromoCode({ subtotalCents, variant }: PromoCodeProps) {
  const coupons = useCart((s) => s.coupons);
  const items = useCart((s) => s.items);
  const addCoupon = useCart((s) => s.addCoupon);
  const removeCoupon = useCart((s) => s.removeCoupon);
  const [draft, setDraft] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compact = variant === 'drawer';
  const labelCls = compact
    ? 'text-[9px] uppercase tracking-[0.25em] text-ink/45'
    : 'text-[11px] uppercase tracking-[0.25em] text-ink/45';
  const valueCls = compact
    ? 'font-mono text-[12.5px] tabular-nums text-ink'
    : 'font-mono text-sm tabular-nums text-ink';

  const hasApplied = coupons.length > 0;
  const breakdown = couponBreakdown(coupons, subtotalCents, items);
  const stackedDiscount = breakdown.total;
  const netTotal = Math.max(subtotalCents - stackedDiscount, 0);

  async function handleApply() {
    const code = draft.trim().toUpperCase();
    if (isChecking || code.length === 0) return;
    if (coupons.some((c) => c.code === code)) {
      setError('That code is already applied.');
      return;
    }
    setIsChecking(true);
    setError(null);
    const result = await checkCoupon(code, subtotalCents);
    setIsChecking(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    addCoupon(result.coupon);
    setDraft('');
  }

  function appliedValue(c: AppliedCoupon, qualifies: boolean): string {
    const v = qualifies ? (breakdown.perCode[c.code] ?? 0) : 0;
    // free_item with the item NOT in the cart contributes $0 here (it's added
    // free) — show FREE ITEM; otherwise show the dollar value coming off.
    if (c.kind === 'free_item' && v === 0) return 'FREE ITEM';
    return `−${formatUsd(v)}`;
  }

  return (
    <div className={compact ? 'mb-2.5' : 'mb-4'}>
      {/* Applied codes — each independently removable (stackable) */}
      {coupons.map((c) => {
        const qualifies = couponStillQualifies(c, subtotalCents);
        return (
          <div key={c.code} className={compact ? 'mb-1.5' : 'mb-2'}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={labelCls}>
                Code <span className="font-mono normal-case tracking-[0.08em] text-ink/70">{c.code}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className={valueCls}>{appliedValue(c, qualifies)}</span>
                <button
                  type="button"
                  onClick={() => removeCoupon(c.code)}
                  aria-label={`Remove code ${c.code}`}
                  className="text-[9px] uppercase tracking-[0.2em] text-ink/35 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                >
                  Remove
                </button>
              </span>
            </div>
            {c.kind === 'free_item' && qualifies && (
              <p className={`mt-1 text-ink/55 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
                {freeItemLineValue(c, items) > 0
                  ? `One ${c.freeLabel ?? 'item'} in your order is free.`
                  : `Free — ${c.freeLabel ?? 'item'} will be added to your order at checkout.`}
              </p>
            )}
            {!qualifies && (
              <p role="alert" className={`mt-1 text-ink/60 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
                {c.kind === 'free_item'
                  ? `Add a product to your order to use ${c.code}.`
                  : `Your order no longer meets the minimum for ${c.code}.`}
              </p>
            )}
          </div>
        );
      })}

      {/* Code input — always available so buyers can stack another code */}
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.toUpperCase());
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleApply();
            }
          }}
          placeholder={hasApplied ? 'ADD ANOTHER CODE' : 'PROMO CODE'}
          aria-label={hasApplied ? 'Add another promo code' : 'Promo code'}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          className={`min-w-0 flex-1 rounded-[5px] border border-ink/15 bg-transparent px-2.5 font-mono uppercase tracking-[0.12em] text-ink placeholder:text-ink/30 focus:border-ink/40 focus:outline-none ${
            compact ? 'py-1.5 text-[11px]' : 'py-2 text-[13px]'
          }`}
        />
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={isChecking || draft.trim().length === 0}
          className={`shrink-0 rounded-[5px] border border-ink/20 px-3 uppercase tracking-[0.2em] text-ink/70 transition-colors hover:border-ink/45 hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 ${
            compact ? 'text-[9px]' : 'text-[10px]'
          }`}
        >
          {isChecking ? 'Checking…' : hasApplied ? 'Add' : 'Apply'}
        </button>
      </div>
      {error && (
        <p role="alert" className={`mt-1.5 text-ink/60 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
          {error}
        </p>
      )}

      {/* Stacked total after all qualifying discounts */}
      {hasApplied && stackedDiscount > 0 && (
        <div className={`flex items-baseline justify-between ${compact ? 'mt-2' : 'mt-2.5'}`}>
          <span className={labelCls}>Total</span>
          <span className={valueCls}>{formatUsd(netTotal)}</span>
        </div>
      )}
    </div>
  );
}

/** The codes checkout should submit — the qualifying, deduped set (may be empty). */
export function submittableCouponCodes(subtotalCents: number): string[] {
  return pickSubmittableCodes(useCart.getState().coupons, subtotalCents);
}
