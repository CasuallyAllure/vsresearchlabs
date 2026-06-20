/**
 * TierStrip — canonical product-variant tier renderer
 *
 * Unifies the two prior tier renderers (read-only DoseTierStrip and the
 * Overlay's interactive TierSelector) into a single primitive with
 * mode-discriminated rendering. The visual posture differs because the
 * intents differ: `read` is compact metadata, `select` is a control.
 *
 * Modes:
 *   - `read` (default): non-interactive pills. Used on ProductCard
 *     (announces "also available in") and ProductPage's metadata band
 *     (announces the current product's tier).
 *   - `select`: interactive buttons. Used in the Overlay (drives the
 *     active tier — which changes the passport, CTA context, and vial
 *     dose label). Will be reused by the E3 ProductPage rebuild.
 *
 * Empty array → renders nothing.
 */

import type { ProductVariant } from '../../../types';
import { doseAvailability } from '../../../lib/productOverrides';

type TierStripProps =
  | {
      mode?: 'read';
      variants: ProductVariant[];
      /** Optional — when set, fast-ship variants render a small "· FAST" suffix. */
      sku?: string;
      /** When set, the matching variant is rendered with the "active" treatment. */
      activeDose?: string;
      className?: string;
    }
  | {
      mode: 'select';
      variants: ProductVariant[];
      /** Optional — when set, fast-ship variants render a small "· FAST" suffix. */
      sku?: string;
      selectedIndex: number;
      onSelect: (i: number) => void;
      /** 'sm' is a daintier control for dense surfaces like grid cards. */
      size?: 'sm' | 'md';
      className?: string;
    };

// Brand chip — same visual language as CompactProductTile + the row inside
// BiopeptideInventoryModal. Mono caps, ink fill on active, hairline border
// on inactive, optional green "· FAST" suffix when the dose ships fast.
function dosePresentation(dose: string): string {
  return dose.replace(/\s+/g, '').toUpperCase();
}

function FastBadge({ active, size }: { active: boolean; size: 'sm' | 'md' }) {
  return (
    <span
      style={{
        marginLeft: '4px',
        color: active ? 'rgba(155,196,163,1)' : '#2E7D5B',
        fontSize: size === 'sm' ? '7.5px' : '8.5px',
        letterSpacing: '0.20em',
      }}
    >
      · FAST
    </span>
  );
}

export function TierStrip(props: TierStripProps) {
  if (!props.variants || props.variants.length === 0) return null;

  const sku = props.sku;

  if (props.mode === 'select') {
    const { variants, selectedIndex, onSelect, className } = props;
    const sm = props.size === 'sm';
    return (
      <div
        role="radiogroup"
        aria-label="Select dose"
        className={['flex flex-wrap', sm ? 'gap-1' : 'gap-1.5', className ?? ''].filter(Boolean).join(' ')}
      >
        {variants.map((v, i) => {
          const active = i === selectedIndex;
          const av = sku ? doseAvailability(sku, v.dose) : { state: 'unknown' as const };
          const isFast = av.state === 'in_stock' && av.fast;
          return (
            <button
              key={v.dose}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(i)}
              title={isFast ? `${v.dose} · ships fast` : v.dose}
              className="rounded-[3px] font-mono leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 active:scale-[0.96] transition-colors"
              style={{
                padding: sm ? '3px 7px' : '5px 10px',
                fontSize: sm ? '8.5px' : '10px',
                letterSpacing: '0.16em',
                backgroundColor: active ? '#1A1714' : 'rgba(26,23,20,0.02)',
                color: active ? '#FBF9F4' : 'rgba(26,23,20,0.78)',
                border: active ? '1px solid #1A1714' : '1px solid rgba(26,23,20,0.12)',
              }}
            >
              {dosePresentation(v.dose)}
              {isFast && <FastBadge active={active} size={sm ? 'sm' : 'md'} />}
            </button>
          );
        })}
      </div>
    );
  }

  // read mode (default)
  const { variants, activeDose, className } = props;
  return (
    <div
      className={['flex items-center gap-1 flex-wrap', className ?? ''].filter(Boolean).join(' ')}
      role="list"
      aria-label="Available dose tiers"
    >
      {variants.map((v) => {
        const isActive = !!(activeDose && v.dose === activeDose);
        const av = sku ? doseAvailability(sku, v.dose) : { state: 'unknown' as const };
        const isFast = av.state === 'in_stock' && av.fast;
        return (
          <span
            key={v.dose}
            role="listitem"
            className="font-mono leading-none rounded-[3px]"
            style={{
              padding: '2px 6px',
              fontSize: '9px',
              letterSpacing: '0.16em',
              backgroundColor: isActive ? '#1A1714' : 'transparent',
              color: isActive ? '#FBF9F4' : 'rgba(26,23,20,0.50)',
              border: isActive ? '1px solid #1A1714' : '1px solid rgba(26,23,20,0.10)',
            }}
          >
            {dosePresentation(v.dose)}
            {isFast && <FastBadge active={isActive} size="sm" />}
          </span>
        );
      })}
    </div>
  );
}
