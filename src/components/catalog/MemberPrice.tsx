/**
 * MemberPrice — the shared, single-sourced display of an account holder's
 * automatic member price, shown as a compact gold accent NEXT TO the normal
 * price. Used by every shopper-facing price surface (catalog tiles, featured
 * spotlight, compound overlay) so the treatment and copy never fork.
 *
 * LAYOUT: a hairline vertical rule then the member price, with a very small
 * "members" caption stacked underneath it — i.e. `$60 │ $51` with the label
 * below the second figure. Deliberately borderless and narrow: the earlier
 * bordered pill was wide enough to collide with the tile's Add button on
 * mobile. Parents align this with `items-baseline` so the member figure sits on
 * the same baseline as the normal price and the caption hangs below.
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
import { useSignedIn } from '../../lib/authPresence';
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
  // GUESTS ONLY. This chip is the join incentive ("create a profile") at the
  // base member rate — shown to a signed-in member it understates a Pro's 20%
  // and tells a profile-holder to create a profile (release audit). Members
  // see their true rate in the cart preview; presence check is zero-query.
  const signedIn = useSignedIn();
  const member = memberPriceCents(baseCents);

  if (signedIn || !eligible || member == null) return null;

  const priceText = size === 'md' ? 'text-[15px]' : 'text-[12px]';
  const tagText = size === 'md' ? 'text-[7.5px]' : 'text-[7px]';

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
        // The hairline rule is a LEFT BORDER on this column, not a separate
        // element. An empty divider span would be the first flex item and the
        // browser would take the link's baseline from it (its full stretched
        // height), dropping the normal price well below the member price under
        // `items-baseline`. As a border, the first in-flow line is the member
        // price, so the two figures share one baseline.
        className={`inline-flex flex-col items-start border-l pl-1.5 font-mono tabular-nums no-underline leading-none transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 ${className}`}
        style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)' }}
      >
        <span className={`font-semibold ${priceText}`} style={{ color: ACCENT }}>
          {formatPriceExact(member)}
        </span>
        <span
          className={`mt-[2px] uppercase tracking-[0.1em] ${tagText}`}
          style={{ color: 'color-mix(in srgb, var(--color-accent) 75%, transparent)' }}
        >
          members
        </span>
      </Link>
    </Tooltip>
  );
}
