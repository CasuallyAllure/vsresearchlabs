/**
 * AvailabilityBadge — public per-dose stock pill.
 *
 *   in stock + fast → "In stock · fast ship"  (on_hand or inbound)
 *   in stock        → "In stock"              (warehouse drop-ship only)
 *   out of stock    → "Out of stock"
 *   untracked dose  → nothing
 *
 * The fast variant uses a brighter green pill so the buyer can scan a
 * dose list and pick the one that'll get there sooner. Warehouse-only
 * variants still read as "In stock" — we don't expose the 5-10 day
 * SLA to the buyer, just signal that the other doses are faster.
 *
 * Subscribes to the override store so it updates when admin overrides load.
 */

import { useProductOverrides, doseAvailability } from '../../lib/productOverrides';

interface Props {
  sku: string;
  dose: string;
  className?: string;
}

export function AvailabilityBadge({ sku, dose, className = '' }: Props) {
  // Re-render when admin overrides load.
  useProductOverrides((s) => s.variantBySku);
  const a = doseAvailability(sku, dose);
  if (a.state === 'unknown') return null;

  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border';

  if (a.state === 'in_stock') {
    return a.fast ? (
      <span
        className={`${pill} border-[#2E7D5B]/45 text-[#1F5A40] bg-[#2E7D5B]/[0.10] ${className}`}
        title="Physically in stock — ships next business day"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: '#2E7D5B' }}
        />
        24 Hour Shipping
      </span>
    ) : (
      <span
        className={`${pill} border-[#2E7D5B]/25 text-[#2E7D5B]/85 bg-[#2E7D5B]/[0.04] ${className}`}
        title="In stock"
      >
        In stock
      </span>
    );
  }

  return (
    <span className={`${pill} border-ink/15 text-ink/45 bg-ink/[0.02] ${className}`}>
      Out of stock
    </span>
  );
}
