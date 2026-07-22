/**
 * MemberPrice — the shared, single-sourced display of an account holder's
 * automatic member price, shown as a compact gold accent NEXT TO the normal
 * price. Used by every shopper-facing price surface (catalog tiles, featured
 * spotlight, compound overlay) so the treatment and copy never fork.
 *
 * DISPLAY ONLY — the amount comes from src/lib/memberPricing.ts, which mirrors
 * the checkout's account-slice math exactly (round(base × 15 / 100)); the money
 * a buyer is charged is unchanged and still resolved server-side.
 *
 * The normal price stays the primary figure; this is a secondary accent. The
 * chip itself is a link into the account / sign-in flow — that is the nudge
 * toward creating a profile. Hover (desktop) or tap (touch) surfaces the
 * existing membership wording via the shared <Tooltip>, which is position:fixed
 * (so it escapes the tile's overflow) and mounts instantly (no motion — it
 * already respects prefers-reduced-motion). Renders nothing when the product
 * isn't eligible or the base price is missing, so bundles and wholesale simply
 * omit it.
 */

import { useId } from 'react';
import { Link } from 'react-router-dom';
import { MEMBER_DISCOUNT_PERCENT, memberPriceCents } from '../../lib/memberPricing';
import { formatPriceExact } from '../../lib/pricing';
import { Tooltip } from '../ui/Tooltip';

interface MemberPriceProps {
  /** Normal price in cents. The member price is derived from this. */
  baseCents: number | null;
  /** Whether this product advertises a member price (isMemberPriceEligible). */
  eligible: boolean;
  /** Visual scale. `sm` for dense catalog tiles, `md` for spotlight/overlay. */
  size?: 'sm' | 'md';
  className?: string;
}

const ACCENT = 'var(--color-accent)';

export function MemberPrice({ baseCents, eligible, size = 'sm', className = '' }: MemberPriceProps) {
  const ariaId = useId();
  const member = memberPriceCents(baseCents);

  if (!eligible || member == null) return null;

  const priceText = size === 'md' ? 'text-[13px]' : 'text-[11px]';
  const tagText = size === 'md' ? 'text-[8.5px]' : 'text-[8px]';

  return (
    <Tooltip
      ariaId={ariaId}
      maxWidth={230}
      content={
        <>
          Automatic {MEMBER_DISCOUNT_PERCENT}% off at checkout for account holders · excludes
          bundles &amp; wholesale.{' '}
          <span className="whitespace-nowrap font-medium" style={{ color: ACCENT }}>
            Create a profile ↗
          </span>
        </>
      }
    >
      <Link
        to="/account"
        aria-label={`Member price ${formatPriceExact(member)} — automatic ${MEMBER_DISCOUNT_PERCENT}% off for account holders; create a profile`}
        className={`group inline-flex items-center gap-1 rounded-full border px-1.5 py-[3px] font-mono tabular-nums no-underline leading-none transition-colors hover:brightness-105 focus:outline-none focus-visible:ring-1 ${className}`}
        style={{
          borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--color-accent) 9%, transparent)',
        }}
      >
        <span
          className={`font-medium uppercase tracking-[0.14em] ${tagText}`}
          style={{ color: ACCENT }}
        >
          Members
        </span>
        <span className={`font-semibold ${priceText}`} style={{ color: ACCENT }}>
          {formatPriceExact(member)}
        </span>
      </Link>
    </Tooltip>
  );
}
