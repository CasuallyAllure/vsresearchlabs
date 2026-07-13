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

  return (
    <span
      className={`${pill} border-ink/15 text-ink/50 bg-ink/[0.03] ${className}`}
      title="Sourced to order — ships in 7–10 business days"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: 'rgb(var(--c-ink) / 0.35)' }}
      />
      Shipping 7–10 business days
    </span>
  );
}
