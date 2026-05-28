/**
 * DoseTierStrip
 * Wave 7c — Compact dose / size tier metadata strip.
 *
 * Renders the available `ProductVariant[]` for a product as a tight
 * inline row of pill-shaped tags. Optionally highlights one tier as
 * "active" — used on ProductCard (the card's product is one tier in
 * its family) and ProductPage (the current product's dose).
 *
 * Aesthetic posture:
 *   - Compact metadata, NOT a control. Tags are non-interactive in
 *     this wave (no click handlers). They communicate availability
 *     so the future inquiry workflow can route to specific tiers.
 *   - 10px tabular-nums caption tier, mirroring AbbreviationChip's
 *     type tier so the two reads as a coherent metadata band.
 *   - Active tier: lifted bg + brighter text (using the same
 *     bg-white/[0.08] vocabulary PillTabs uses for its active pill).
 *   - Inactive tier: hairline-only outline, low text opacity. Reads
 *     as "also available."
 *
 * Empty array → renders nothing. Equipment products with a single
 * configuration carry `variants: []` and the strip is silently absent.
 */

import type { ProductVariant } from '../../types';

interface DoseTierStripProps {
  variants: ProductVariant[];
  /** When provided, the matching variant is rendered with "active" treatment. */
  activeDose?: string;
  /** Optional outer className for layout adjustments. */
  className?: string;
}

export function DoseTierStrip({
  variants,
  activeDose,
  className,
}: DoseTierStripProps) {
  if (!variants || variants.length === 0) return null;

  return (
    <div
      className={[
        'flex items-center gap-1 flex-wrap',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="list"
      aria-label="Available dose tiers"
    >
      {variants.map((v) => {
        const isActive = activeDose && v.dose === activeDose;
        return (
          <span
            key={v.dose}
            role="listitem"
            className={[
              'inline-flex items-center',
              'px-1.5 py-[1px]',
              'rounded',
              'text-[10px] tabular-nums',
              'transition-colors',
              isActive
                ? 'bg-white/[0.08] border border-white/[0.18] text-white/85'
                : 'bg-transparent border border-white/[0.06] text-white/45',
            ].join(' ')}
          >
            {v.dose}
          </span>
        );
      })}
    </div>
  );
}
