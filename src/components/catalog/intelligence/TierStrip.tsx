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

type TierStripProps =
  | {
      mode?: 'read';
      variants: ProductVariant[];
      /** When set, the matching variant is rendered with the "active" treatment. */
      activeDose?: string;
      className?: string;
    }
  | {
      mode: 'select';
      variants: ProductVariant[];
      selectedIndex: number;
      onSelect: (i: number) => void;
      /** 'sm' is a daintier control for dense surfaces like grid cards. */
      size?: 'sm' | 'md';
      className?: string;
    };

export function TierStrip(props: TierStripProps) {
  if (!props.variants || props.variants.length === 0) return null;

  if (props.mode === 'select') {
    const { variants, selectedIndex, onSelect, className } = props;
    const sm = props.size === 'sm';
    return (
      <div className={['flex flex-wrap', sm ? 'gap-1' : 'gap-1.5', className ?? ''].filter(Boolean).join(' ')}>
        {variants.map((v, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={v.dose}
              type="button"
              onClick={() => onSelect(i)}
              className="rounded-[2px] font-mono tabular-nums leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.95]"
              style={{
                padding: sm ? '3px 7px' : '4px 10px',
                fontSize: sm ? '9.5px' : '11px',
                backgroundColor: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.025)',
                border: active ? '1px solid rgba(255,255,255,0.24)' : '1px solid rgba(255,255,255,0.07)',
                color: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)',
                transition: 'background-color 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out, transform 100ms ease-out',
              }}
            >
              {v.dose}
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
