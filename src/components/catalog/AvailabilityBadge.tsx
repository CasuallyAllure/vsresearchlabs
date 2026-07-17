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
import { usePromoSettings, b2g1TooltipContent } from '../../lib/promoSettings';
import { Tooltip } from '../ui/Tooltip';

const SOURCED_SHIP_PLAIN = 'Standard shipping — sourced to order, arrives in 7–10 business days.';

interface Props {
  sku: string;
  dose: string;
  className?: string;
}

export function AvailabilityBadge({ sku, dose, className = '' }: Props) {
  // Re-render when admin overrides / promo settings load.
  useProductOverrides((s) => s.variantBySku);
  usePromoSettings((s) => s.b2g1Enabled);
  usePromoSettings((s) => s.b2g1EndsAt);
  const a = doseAvailability(sku, dose);
  if (a.state === 'unknown') return null;

  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border';

  if (a.state === 'in_stock') {
    return (
      <span
        className={`${pill} ${className}`}
        style={{
          borderColor: 'color-mix(in srgb, var(--color-status-success) 45%, transparent)',
          color: 'var(--color-status-success)',
          backgroundColor: 'var(--color-status-successMuted)',
        }}
        title="Physically in stock — ships next business day"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: 'var(--color-status-success)' }}
        />
        24 Hour Shipping
      </span>
    );
  }

  // Hover/tap reveals the slow-ship promo WHEN it's live for this SKU (governed
  // by migration 055); otherwise the plain shipping copy. Checkout enforces the
  // discount server-side. Native title dropped so it can't double the tooltip.
  return (
    <Tooltip
      content={b2g1TooltipContent(sku) ?? SOURCED_SHIP_PLAIN}
      ariaId={`b2g1-${sku}-${dose}`}
    >
      <span className={`${pill} cursor-help border-ink/15 bg-ink/[0.03] text-ink/50 underline decoration-dotted decoration-ink/25 underline-offset-2 ${className}`}>
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: 'rgb(var(--c-ink) / 0.35)' }}
        />
        Standard Shipping
      </span>
    </Tooltip>
  );
}
