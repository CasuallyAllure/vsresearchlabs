/**
 * AvailabilityBadge — public per-dose stock pill.
 *
 *   24-hour        → "24 Hour Shipping"          (on_hand or inbound)
 *   sourced        → "Shipping 7–10 business days" (still orderable)
 *   untracked dose → nothing
 *
 * There is no "out of stock" tier — every tracked dose is orderable, just
 * on a different timeline. The sourced pill is muted (not just a color
 * swap) so it never reads as an error state.
 *
 * Subscribes to the override store so it updates when admin overrides load.
 */

import { useProductOverrides, doseAvailability } from '../../lib/productOverrides';
import { Tooltip } from '../ui/Tooltip';

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
    );
  }

  // Hover/tap reveals the slow-ship promo; checkout enforces it server-side
  // (Buy 2 Get 1 Free, migration 053). The native title is dropped so it
  // can't double up with the tooltip on desktop.
  return (
    <Tooltip
      content="Buy 2, Get 1 Free — order 3 of this item and the 3rd is free at checkout. Sourced to order, ships in 7–10 business days."
      ariaId={`b2g1-${sku}-${dose}`}
    >
      <span className={`${pill} cursor-help border-ink/15 bg-ink/[0.03] text-ink/50 underline decoration-dotted decoration-ink/25 underline-offset-2 ${className}`}>
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: 'rgb(var(--c-ink) / 0.35)' }}
        />
        Shipping 7–10 business days
      </span>
    </Tooltip>
  );
}
