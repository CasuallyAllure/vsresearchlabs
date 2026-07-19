/**
 * ClassificationFilter — compact filter bar: smart search + category dropdown
 * (+ optional in-stock toggle), with a readable description underneath.
 *
 * One tight row: an optional typeahead search (type "re" → Retatrutide…), the
 * category dropdown (hidden until opened so the list never sprawls), and the
 * in-stock toggle. Below, a single plain-English description of the selected
 * category with a "Technical detail" swap.
 *
 * Search is optional: pass `onSearch` (+ `search`) to show it, and `suggestions`
 * (the candidate items) to power the typeahead.
 */

import { useEffect, useRef, useState } from 'react';
import { CLASSIFICATION_LAYMAN, CLASSIFICATION_DEFINITIONS } from '../../lib/compoundIntelligence';
import type { ResearchClassification } from '../../types';
import { Tooltip } from '../ui/Tooltip';
import { usePromoSettings, isB2G1Active, b2g1TooltipContent } from '../../lib/promoSettings';
import { WHOLESALE_TOOLTIP } from '../../lib/wholesale';

const FAST_SHIP_TOOLTIP = 'Ships within 24 hours — same-day delivery available for select ZIP codes.';
const SOURCED_SHIP_PLAIN = 'Standard shipping — sourced to order, arrives in 7–10 business days.';

/** Grid density for the catalog: one detailed tile per row → more tiles,
 *  less detail. Owned here (the control), consumed by CompoundSection. */
export type CatalogDensity = 'detail' | 'standard' | 'compact';

const DENSITY_OPTIONS: { id: CatalogDensity; label: string; hint: string }[] = [
  { id: 'detail', label: 'Detail', hint: 'One compound at a time with the full write-up' },
  { id: 'standard', label: 'Grid', hint: 'The standard tile grid' },
  { id: 'compact', label: 'Dense', hint: 'More tiles per row — scan the catalog faster' },
];

function DensityGlyph({ kind }: { kind: CatalogDensity }) {
  const s = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'detail') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" {...s} aria-hidden="true">
        <rect x="3" y="4" width="18" height="7" rx="1.5" />
        <rect x="3" y="14" width="18" height="7" rx="1.5" />
      </svg>
    );
  }
  if (kind === 'standard') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" {...s} aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...s} aria-hidden="true">
      <rect x="2.5" y="2.5" width="5.4" height="5.4" rx="1" />
      <rect x="9.3" y="2.5" width="5.4" height="5.4" rx="1" />
      <rect x="16.1" y="2.5" width="5.4" height="5.4" rx="1" />
      <rect x="2.5" y="9.3" width="5.4" height="5.4" rx="1" />
      <rect x="9.3" y="9.3" width="5.4" height="5.4" rx="1" />
      <rect x="16.1" y="9.3" width="5.4" height="5.4" rx="1" />
      <rect x="2.5" y="16.1" width="5.4" height="5.4" rx="1" />
      <rect x="9.3" y="16.1" width="5.4" height="5.4" rx="1" />
      <rect x="16.1" y="16.1" width="5.4" height="5.4" rx="1" />
    </svg>
  );
}

/** Single-icon layout control (owner's rule: one small grid icon, not a
 *  segmented row). Shows the CURRENT layout's glyph; each tap cycles
 *  detail → grid → dense. The tooltip/labels always say what a tap does. */
function DensityCycleButton({
  value,
  onChange,
}: {
  value: CatalogDensity;
  onChange: (d: CatalogDensity) => void;
}) {
  const i = DENSITY_OPTIONS.findIndex((o) => o.id === value);
  const current = DENSITY_OPTIONS[i === -1 ? 1 : i];
  const next = DENSITY_OPTIONS[(i + 1) % DENSITY_OPTIONS.length];
  return (
    <Tooltip content={`${current.label} layout — tap for ${next.label}`} ariaId="density-cycle">
      <button
        type="button"
        aria-label={`Catalog layout: ${current.label}. Tap to switch to ${next.label}.`}
        title={`${current.label} layout — tap for ${next.label}`}
        onClick={() => onChange(next.id)}
        className="inline-flex shrink-0 min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-ink/15 p-[6px] text-ink/55 transition-colors hover:border-ink/30 hover:text-ink/85 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
      >
        <DensityGlyph kind={current.id} />
      </button>
    </Tooltip>
  );
}

interface Tab {
  id: string;
  label: string;
}

interface Suggestion {
  id: string;
  label: string;
}

interface ClassificationFilterProps {
  tabs: Tab[]; // tabs[0] is the "All" option
  value: string;
  onChange: (id: string) => void;
  allLayman: string;
  allTechnical?: string;
  describe?: (id: string) => { layman: string; technical?: string } | undefined;
  inStock?: { on: boolean; toggle: () => void; color?: string };
  /** Two independent shipping-tier chips (24-hour vs 7–10 business days).
   *  Takes precedence over `inStock` when both are passed. Pass `wholesale`
   *  to append a separated WHOLESALE pill after the speed chips; while it's
   *  active the speed chips render dimmed (the page ignores them). */
  shippingTiers?: {
    fast: boolean;
    sourced: boolean;
    onToggleFast: () => void;
    onToggleSourced: () => void;
    wholesale?: { on: boolean; toggle: () => void };
  };
  /** Grid-density picker (detail / grid / dense), rendered after the
   *  shipping-tier chips behind its own separator. */
  density?: { value: CatalogDensity; onChange: (d: CatalogDensity) => void };
  // ── Optional smart search ──
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  /** Candidate items for the typeahead (e.g. products). */
  suggestions?: Suggestion[];
}

export function ClassificationFilter({
  tabs,
  value,
  onChange,
  allLayman,
  allTechnical,
  describe,
  inStock,
  shippingTiers,
  density,
  search,
  onSearch,
  searchPlaceholder = 'Search compounds…',
  suggestions,
}: ClassificationFilterProps) {
  const allId = tabs[0]?.id;
  const stockColor = inStock?.color ?? 'var(--color-status-success)';

  // Subscribe so the 7–10-day chip's tooltip flips to the promo-term copy the
  // moment promo settings load (or an admin toggles the promo).
  usePromoSettings((s) => s.b2g1Enabled);
  usePromoSettings((s) => s.b2g1EndsAt);
  // Category-level chip → not SKU-specific, so gate on the global promo only.
  const sourcedShipTooltip = (isB2G1Active() ? b2g1TooltipContent() : null) ?? SOURCED_SHIP_PLAIN;

  const [open, setOpen] = useState(false);       // category dropdown
  const [sugOpen, setSugOpen] = useState(false); // search typeahead
  const [showTech, setShowTech] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // close dropdowns on outside-click / Escape
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSugOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setSugOpen(false); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const isAll = value === allId;
  const currentLabel = tabs.find((t) => t.id === value)?.label ?? tabs[0]?.label ?? 'All';
  const custom = describe?.(value);
  const layman = isAll
    ? allLayman
    : custom?.layman ?? CLASSIFICATION_LAYMAN[value as ResearchClassification] ?? allLayman;
  const technical = isAll
    ? allTechnical
    : custom?.technical ?? CLASSIFICATION_DEFINITIONS[value as ResearchClassification];
  const hasTech = !!technical && technical !== layman;

  const q = (search ?? '').trim().toLowerCase();
  const matches =
    suggestions && q.length > 0
      ? suggestions.filter((s) => s.label.toLowerCase().includes(q)).slice(0, 7)
      : [];

  return (
    <>
    <div className="catalog-filter-glass mb-[var(--space-3)] rounded-[var(--radius-procurement)] p-3">
      {/* One compact row on every breakpoint: the search field grows, the
          in-stock toggle + category dropdown stay pinned right. The category
          menu is right-anchored (and viewport-width-capped) so it can never
          run off the left edge on a narrow phone. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {onSearch && (
          <div ref={searchRef} className="relative min-w-0 flex-1">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              inputMode="search"
              autoComplete="off"
              aria-label="Search"
              value={search ?? ''}
              onChange={(e) => { onSearch(e.target.value); setSugOpen(true); }}
              onFocus={() => setSugOpen(true)}
              placeholder={searchPlaceholder}
              className="w-full min-h-[40px] sm:min-h-0 rounded-[var(--radius-procurement)] border border-ink/15 bg-base-700 py-1.5 pl-8 pr-7 text-[12.5px] text-ink placeholder:text-ink/35 transition-colors hover:border-ink/25 focus:outline-none focus:border-holo/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => { onSearch(''); setSugOpen(false); }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 focus:outline-none"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            {sugOpen && matches.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-40 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[var(--radius-procurement)] border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.3)]"
                style={{ backgroundColor: 'var(--color-surface-elevated)', backdropFilter: 'blur(8px)' }}
              >
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => { onSearch(m.label); setSugOpen(false); }}
                      className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] text-ink/75 transition-colors hover:bg-ink/[0.05] hover:text-ink"
                    >
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {inStock && (
          <button
            type="button"
            role="switch"
            aria-checked={inStock.on}
            onClick={inStock.toggle}
            title={inStock.on ? 'Showing in-stock only — tap to show all' : 'Tap to show in-stock only'}
            // Off-state colors use the theme-bound `ink` tokens (NOT a hardcoded
            // dark rgba) so the control stays visible in dark mode — a fixed
            // near-black border/text was invisible on the black surface.
            className={`inline-flex shrink-0 min-h-[40px] sm:min-h-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 ${
              inStock.on ? '' : 'border-ink/25 text-ink/55'
            }`}
            style={
              inStock.on
                ? { borderColor: `${stockColor}99`, color: stockColor, backgroundColor: `${stockColor}14` }
                : undefined
            }
          >
            <span
              aria-hidden="true"
              className={`inline-block h-[6px] w-[6px] rounded-full transition-colors ${inStock.on ? '' : 'bg-ink/35'}`}
              style={
                inStock.on
                  ? { backgroundColor: stockColor, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.35)' }
                  : undefined
              }
            />
            In stock
          </button>
        )}

        <div ref={catRef} className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-[40px] sm:min-h-0 min-w-[68px] max-w-[40vw] items-center justify-between gap-1.5 rounded-[var(--radius-procurement)] border border-ink/15 bg-base-700 px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
          >
            <span className="truncate font-medium">{currentLabel}</span>
            <span aria-hidden="true" className={`shrink-0 text-[10px] text-ink/45 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {open && (
            <ul
              role="listbox"
              aria-label="Categories"
              className="absolute right-0 z-40 mt-1 max-h-[min(60vh,300px)] w-[min(240px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-[var(--radius-procurement)] border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.3)]"
              style={{ backgroundColor: 'var(--color-surface-elevated)', backdropFilter: 'blur(8px)' }}
            >
              {tabs.map((tab) => {
                const active = tab.id === value;
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { onChange(tab.id); setOpen(false); setShowTech(false); }}
                      className={[
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors',
                        active ? 'bg-holo/[0.10] text-holo font-medium' : 'text-ink/70 hover:bg-ink/[0.05] hover:text-ink',
                      ].join(' ')}
                    >
                      <span className="truncate">{tab.label}</span>
                      {active && <span aria-hidden="true" className="shrink-0 text-[11px] text-holo">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Layout picker sits inline with the category dropdown on surfaces
            with no shipping chips (the research library). On procurement
            surfaces it rides the second row instead, after the chips, so the
            two controls read as one group. */}
        {density && !shippingTiers && (
          <DensityCycleButton value={density.value} onChange={density.onChange} />
        )}
      </div>

      {/* Second row: shipping-tier chips (procurement surfaces only), followed
          by the layout picker. Only rendered where shipping chips exist —
          otherwise the picker lives inline above. */}
      {shippingTiers && (
        <div className="mt-2 flex flex-nowrap items-center justify-end gap-1.5">
          {shippingTiers && (
          <>
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-ink/40"
          >
            <rect x="1" y="7" width="12.5" height="9" rx="1.2" />
            <path d="M13.5 10h3.6L20 13.4V16h-2.7" />
            <circle cx="5.7" cy="17.2" r="1.5" />
            <circle cx="16.3" cy="17.2" r="1.5" />
          </svg>
          <span className="sr-only">Shipping speed</span>

          {/* No overflow container here: it clipped the hover tooltips AND hid
              the Wholesale chip off-screen at 375px. Slim chips + the single
              layout icon fit on one visible line instead. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={`flex shrink-0 items-center gap-1.5 transition-opacity ${
                shippingTiers.wholesale?.on ? 'opacity-45' : ''
              }`}
            >
            <Tooltip content={FAST_SHIP_TOOLTIP} ariaId="ship-24hr">
            <button
              type="button"
              role="switch"
              aria-checked={shippingTiers.fast}
              aria-label={shippingTiers.fast ? '24-hour shipping — tap to hide' : 'Tap to show 24-hour shipping compounds'}
              onClick={shippingTiers.onToggleFast}
              className={`inline-flex min-h-[40px] sm:min-h-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10px] uppercase tracking-[0.06em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 ${
                shippingTiers.fast ? '' : 'border-ink/25 text-ink/55'
              }`}
              style={
                shippingTiers.fast
                  ? {
                      borderColor: 'color-mix(in srgb, var(--color-status-success) 60%, transparent)',
                      color: 'var(--color-status-success)',
                      backgroundColor: 'var(--color-status-successMuted)',
                    }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className={`inline-block h-[6px] w-[6px] rounded-full shrink-0 transition-colors ${shippingTiers.fast ? '' : 'bg-ink/35'}`}
                style={shippingTiers.fast ? { backgroundColor: 'var(--color-status-success)' } : undefined}
              />
              24 HR
            </button>
            </Tooltip>
            <Tooltip content={sourcedShipTooltip} ariaId="ship-sourced">
            <button
              type="button"
              role="switch"
              aria-checked={shippingTiers.sourced}
              aria-label={
                shippingTiers.sourced
                  ? 'Standard shipping (7–10 business days) — tap to hide'
                  : 'Tap to show standard-shipping (7–10 business day) compounds'
              }
              onClick={shippingTiers.onToggleSourced}
              className={`inline-flex min-h-[40px] sm:min-h-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10px] uppercase tracking-[0.06em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 ${
                shippingTiers.sourced ? '' : 'border-ink/25 text-ink/55'
              }`}
              style={
                shippingTiers.sourced
                  ? {
                      borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 60%, transparent)',
                      color: 'var(--color-accent-gold-dark)',
                      backgroundColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 10%, transparent)',
                    }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className={`inline-block h-[6px] w-[6px] rounded-full shrink-0 transition-colors ${shippingTiers.sourced ? '' : 'bg-ink/35'}`}
                style={shippingTiers.sourced ? { backgroundColor: 'var(--color-accent-gold-dark)' } : undefined}
              />
              STANDARD
            </button>
            </Tooltip>
            </div>

            {shippingTiers.wholesale && (
              <>
                <span aria-hidden="true" className="h-[16px] w-px shrink-0 bg-ink/15" />
                <Tooltip content={WHOLESALE_TOOLTIP} ariaId="ship-wholesale">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shippingTiers.wholesale.on}
                    aria-label={
                      shippingTiers.wholesale.on
                        ? 'Wholesale business pricing — tap to return to the regular catalog'
                        : 'Switch to volume pricing (case of 10)'
                    }
                    onClick={shippingTiers.wholesale.toggle}
                    className={`inline-flex shrink-0 min-h-[40px] sm:min-h-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10px] uppercase tracking-[0.06em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 ${
                      shippingTiers.wholesale.on ? '' : 'border-ink/25 text-ink/55'
                    }`}
                    style={
                      shippingTiers.wholesale.on
                        ? {
                            borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 60%, transparent)',
                            color: 'var(--color-accent-gold-dark)',
                            backgroundColor: 'color-mix(in srgb, var(--color-accent-gold-dark) 10%, transparent)',
                          }
                        : undefined
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-[6px] w-[6px] rounded-full shrink-0 transition-colors ${
                        shippingTiers.wholesale.on ? '' : 'bg-ink/35'
                      }`}
                      style={shippingTiers.wholesale.on ? { backgroundColor: 'var(--color-accent-gold-dark)' } : undefined}
                    />
                    {/* Plain label — a procurement control, not a promotion.
                        The hover tooltip carries the volume-pricing detail. */}
                    <span className="font-medium">Wholesale</span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          </>
          )}

          {density && (
            <>
              {shippingTiers && <span aria-hidden="true" className="h-[16px] w-px shrink-0 bg-ink/15" />}
              <DensityCycleButton value={density.value} onChange={density.onChange} />
            </>
          )}
        </div>
      )}

      {/* Description — compact, wraps, with plain/technical swap */}
      <div className="mt-[var(--space-2)] border-t border-ink/[0.07] pt-[var(--space-2)]">
        {hasTech && (
          <div className="mb-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowTech(false)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${!showTech ? 'bg-ink text-base-900 font-medium' : 'text-ink/40 hover:text-ink/65'}`}
            >
              Plain terms
            </button>
            <button
              type="button"
              onClick={() => setShowTech(true)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${showTech ? 'bg-ink text-base-900 font-medium' : 'text-ink/40 hover:text-ink/65'}`}
            >
              Technical detail
            </button>
          </div>
        )}
        <p className="flex gap-1.5 text-[13px] leading-relaxed text-ink/60">
          <span aria-hidden="true" className="text-ink/35">—</span>
          <span>{showTech && hasTech ? technical : layman}</span>
        </p>
      </div>
    </div>
    <style>{`
      .catalog-filter-glass {
        background: color-mix(in srgb, var(--color-surface-elevated) 82%, transparent);
        -webkit-backdrop-filter: var(--glass-blur);
        backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border);
        box-shadow: var(--surface-highlight-strong), var(--elev-2);
      }
    `}</style>
    </>
  );
}
