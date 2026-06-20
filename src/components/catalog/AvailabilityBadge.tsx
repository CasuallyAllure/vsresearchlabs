/**
 * AvailabilityBadge — public per-dose stock pill.
 *
 *   in stock       → "In stock"  (any of: on_hand, inbound, warehouse drop-ship)
 *   out of stock   → "Out of stock"
 *   untracked dose → nothing (the catalog's own stock pip covers it)
 *
 * The public catalog deliberately does NOT distinguish supply sources —
 * shelf, inbound, and drop-ship all read as "in stock". Admin views read
 * the raw fields directly to see the truth.
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
    return (
      <span className={`${pill} border-[#2E7D5B]/35 text-[#2E7D5B] bg-[#2E7D5B]/[0.06] ${className}`}>
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
