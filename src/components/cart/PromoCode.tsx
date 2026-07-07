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
import { useCart } from '../../hooks/useCart';
import { checkCoupon, couponDiscountCents, couponStillQualifies } from '../../lib/coupons';
import { formatUsd } from '../../lib/payment';

interface PromoCodeProps {
  /** Current cart subtotal in cents (caller computes it with lineUnitCents). */
  subtotalCents: number;
  /** drawer = tighter type scale to match the slide-out footer. */
  variant: 'drawer' | 'page';
}

export function PromoCode({ subtotalCents, variant }: PromoCodeProps) {
  const coupon = useCart((s) => s.coupon);
  const setCoupon = useCart((s) => s.setCoupon);
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

  const discount = couponDiscountCents(coupon, subtotalCents);
  const qualifies = couponStillQualifies(coupon, subtotalCents);
  const netTotal = Math.max(subtotalCents - (qualifies ? discount : 0), 0);

  async function handleApply() {
    if (isChecking || draft.trim().length === 0) return;
    setIsChecking(true);
    setError(null);
    const result = await checkCoupon(draft, subtotalCents);
    setIsChecking(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setCoupon(result.coupon);
    setDraft('');
  }

  function handleRemove() {
    setCoupon(null);
    setError(null);
  }

  function couponSummaryLabel(): string {
    if (!coupon) return '';
    if (coupon.kind === 'percent') return `${coupon.percent}% off`;
    if (coupon.kind === 'fixed') return `${formatUsd(coupon.amountCents ?? 0)} off`;
    return coupon.freeLabel ? `Free — ${coupon.freeLabel}` : 'Free item';
  }

  return (
    <div className={compact ? 'mb-2.5' : 'mb-4'}>
      {!coupon && (
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
            placeholder="PROMO CODE"
            aria-label="Promo code"
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
            {isChecking ? 'Checking…' : 'Apply'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`mt-1.5 text-ink/60 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
          {error}
        </p>
      )}

      {coupon && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className={labelCls}>
              Code <span className="font-mono normal-case tracking-[0.08em] text-ink/70">{coupon.code}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className={valueCls}>
                {coupon.kind === 'free_item' ? 'FREE ITEM' : `−${formatUsd(qualifies ? discount : 0)}`}
              </span>
              <button
                type="button"
                onClick={handleRemove}
                aria-label={`Remove code ${coupon.code}`}
                className="text-[9px] uppercase tracking-[0.2em] text-ink/35 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
              >
                Remove
              </button>
            </span>
          </div>

          {coupon.kind === 'free_item' && qualifies && (
            <p className={`mt-1 text-ink/55 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
              {couponSummaryLabel()} will be added to your order at checkout.
            </p>
          )}
          {!qualifies && (
            <p role="alert" className={`mt-1 text-ink/60 ${compact ? 'text-[10px]' : 'text-[11.5px]'}`}>
              {coupon.kind === 'free_item'
                ? `Add a product to your order to use ${coupon.code}.`
                : `Your order no longer meets the minimum for ${coupon.code}.`}
            </p>
          )}

          {coupon.kind !== 'free_item' && qualifies && discount > 0 && (
            <div className={`flex items-baseline justify-between ${compact ? 'mt-1.5' : 'mt-2'}`}>
              <span className={labelCls}>Total</span>
              <span className={valueCls}>{formatUsd(netTotal)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The code string checkout should submit — null when nothing applies. */
export function submittableCouponCode(subtotalCents: number): string | null {
  const { coupon } = useCart.getState();
  if (!coupon) return null;
  return couponStillQualifies(coupon, subtotalCents) ? coupon.code : null;
}
