/**
 * AbbreviationChip
 * Wave 7c — Operational identifier primitive.
 *
 * Renders a product's procurement abbreviation (e.g. "SEM", "TZP",
 * "BAL") as a tight, restrained chip. Used inline beside product
 * names on ProductCard, InventoryRow, InventoryTable's Product cell,
 * and ProductPage.
 *
 * Aesthetic posture:
 *   - Neutral white-tinged surface, NOT gold. Gold is reserved for
 *     CTA / hover-accent semantics elsewhere (Add to Inquiry button,
 *     gallery active border). Using gold here would dilute that.
 *   - Caption tier (10px), uppercase, mild letter-spacing. Reads as
 *     a reference identifier, not a marketing badge.
 *   - tabular-nums for digit alignment when SKU abbreviations include
 *     numeric tails ("SEM-005" style).
 *
 * Surface tokens:
 *   bg     → bg-white/[0.06]   (matches PillTabs / search-input bg)
 *   border → border-white/[0.1]
 *   text   → text-white/70
 */

interface AbbreviationChipProps {
  value: string;
  /** Optional className for layout-level overrides only. */
  className?: string;
}

export function AbbreviationChip({ value, className }: AbbreviationChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center',
        'px-1.5 py-[2px]',
        'rounded',
        'bg-white/[0.05] border border-white/[0.09]',
        'text-white/60',
        'text-[10px] font-medium tracking-[0.1em] uppercase',
        'tabular-nums',
        'shrink-0',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Abbreviation ${value}`}
    >
      {value}
    </span>
  );
}
