/**
 * AvailabilityBadge — per-dose fulfillment state.
 *
 *   in stock        → "In stock"
 *   order-on-demand → "Ships in N days" + "Buy 2, get 1 free" (the lead-time
 *                     incentive; applied by admin at invoice, no cart math)
 *   out of stock    → "Out of stock"
 *   untracked dose  → nothing (the catalog's own stock pip covers it)
 *
 * Subscribes to the override store so it updates when admin overrides load.
 */

import { useProductOverrides, doseAvailability } from '../../lib/productOverrides';

interface Props {
  sku: string;
  dose: string;
  /** Show the "Buy 2, get 1 free" chip alongside a lead-time state. */
  showOffer?: boolean;
  className?: string;
}

export function AvailabilityBadge({ sku, dose, showOffer = true, className = '' }: Props) {
  // Re-render when admin overrides load.
  useProductOverrides((s) => s.variantBySku);
  const a = doseAvailability(sku, dose);
  if (a.state === 'unknown') return null;

  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border';

  if (a.state === 'in_stock') {
    return (
      <span className={`${pill} border-[#2E7D5B]/35 text-[#2E7D5B] bg-[#2E7D5B]/[0.06] ${className}`}>
        In stock
      </span>
    );
  }

  if (a.state === 'lead') {
    return (
      <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
        <span className={`${pill} border-[#B5904B]/40 text-[#8a6d34] bg-[#B5904B]/[0.08]`}>
          Ships in {a.leadDays} days
        </span>
        {showOffer && (
          <span className={`${pill} border-[#34727A]/40 text-[#34727A] bg-[#34727A]/[0.08]`}>
            Buy 2, get 1 free
          </span>
        )}
      </span>
    );
  }

  // out
  return (
    <span className={`${pill} border-ink/15 text-ink/45 bg-ink/[0.02] ${className}`}>
      Out of stock
    </span>
  );
}
