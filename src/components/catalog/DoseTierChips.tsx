/**
 * DoseTierChips — shared shipping-tier dose picker atoms.
 *
 * Extracted from CompoundTile so the same visual (24-hour doses as green
 * "· 24 HR" chips with a delivery-van glyph; sourced doses grouped into one
 * bordered box with a "7–10 Biz Days" footer) can be reused anywhere a dose
 * picker needs to match the catalog tile's shipping-tier treatment —
 * currently CompoundTile and CompoundIntelligenceOverlay.
 *
 * `ShippingVan` / `DoseChip` / `SourcedDoseSegment` are pure presentation —
 * callers own the tier-index state and pass `isActive` / `onClick`.
 */

import { doseAvailability } from '../../lib/productOverrides';

/** Small monochrome delivery-van glyph, inherits text color via currentColor. */
export function ShippingVan() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block shrink-0"
    >
      <path d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" />
      <path d="M14 9h4l3 3.5V17a1 1 0 0 1-1 1h-1" />
      <path d="M9 18h4" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </svg>
  );
}

interface DoseChipProps {
  sku: string;
  dose: string;
  isActive: boolean;
  /** Radio-button behavior (dose picker). Omit for a static single-dose label. */
  interactive?: boolean;
  /** Tighter padding/type for dense surfaces (catalog tile). */
  compact?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

/** One dose pill — interactive (radio, part of the multi-dose picker) or
 *  static (single-dose products, which still need their dose visible). */
export function DoseChip({ sku, dose, isActive, interactive, compact, onClick }: DoseChipProps) {
  const av = doseAvailability(sku, dose);
  const isFast = av.state === 'in_stock' && av.fast;
  const doseTxt = dose.replace(/\s+/g, '').toUpperCase();
  const fontSize = compact ? '9px' : '10px';
  const style = {
    fontSize,
    letterSpacing: '0.12em',
    backgroundColor: isActive ? 'var(--color-content-primary)' : 'var(--color-interactive-secondary)',
    color: isActive ? 'var(--color-surface-base)' : 'var(--color-content-secondary)',
    borderColor: isActive ? 'var(--color-content-primary)' : 'rgb(var(--c-ink) / 0.12)',
  } as const;
  const box = compact ? 'px-1.5 py-[2px]' : 'px-2 py-1';
  const content = (
    <>
      {doseTxt}
      {isFast && (
        <span
          className="ml-1 inline-flex items-center gap-0.5 align-middle"
          style={{
            color: isActive ? 'rgba(155,196,163,1)' : '#2E7D5B',
            fontSize,
            letterSpacing: '0.14em',
          }}
        >
          · 24 HR
          <ShippingVan />
        </span>
      )}
    </>
  );

  if (!interactive) {
    return (
      <span
        className={`font-mono leading-none rounded-full border ${box}`}
        style={style}
        title={isFast ? `${dose} · 24 hour shipping` : dose}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      title={isFast ? `${dose} · 24 hour shipping` : dose}
      className={`font-mono leading-none rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 ${box}`}
      style={style}
    >
      {content}
    </button>
  );
}

interface SourcedDoseSegmentProps {
  dose: string;
  isActive: boolean;
  /** Radio-button behavior (dose picker). Omit for a static single-dose label. */
  interactive?: boolean;
  /** Renders a thin vertical divider on the leading edge (all but the first segment). */
  hasDivider: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

/** One segment of the sourced-dose box — sits flush against its siblings
 *  (no independent border/radius) so the group reads as one bordered module
 *  with the "7–10 Business Days" footer applying to every segment inside. */
export function SourcedDoseSegment({ dose, isActive, interactive, hasDivider, onClick }: SourcedDoseSegmentProps) {
  const doseTxt = dose.replace(/\s+/g, '').toUpperCase();
  const className = [
    'flex-1 font-mono leading-none text-center px-2 py-1.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 focus-visible:ring-inset',
    hasDivider ? 'border-l border-ink/12' : '',
  ].join(' ');
  const style = {
    fontSize: '10px',
    letterSpacing: '0.14em',
    backgroundColor: isActive ? 'var(--color-content-primary)' : 'transparent',
    color: isActive ? 'var(--color-surface-base)' : 'var(--color-content-secondary)',
  } as const;

  if (!interactive) {
    return (
      <span className={className} style={style} title={dose}>
        {doseTxt}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      title={`${dose} · standard shipping, 7–10 business days`}
      className={className}
      style={style}
    >
      {doseTxt}
    </button>
  );
}
