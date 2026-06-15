/**
 * ClassificationFilter — compact category filter.
 *
 * All categories are visible at once as wrapping pills (no horizontal swipe,
 * no long vertical list). Click a title to select it (filters the grid); a
 * single small description below swaps to that category — PLAIN ENGLISH first,
 * with the full technical definition one swipe to the right (2-slide carousel).
 */

import { useEffect, useRef, useState } from 'react';
import { CLASSIFICATION_LAYMAN, CLASSIFICATION_DEFINITIONS } from '../../lib/compoundIntelligence';
import type { ResearchClassification } from '../../types';

interface Tab {
  id: string;
  label: string;
}

interface ClassificationFilterProps {
  tabs: Tab[]; // tabs[0] is the "All" option
  value: string;
  onChange: (id: string) => void;
  /** Plain + technical copy for the "All" option. */
  allLayman: string;
  allTechnical?: string;
  /** Optional in-stock toggle (shown in the header row). */
  inStock?: { on: boolean; toggle: () => void; color?: string };
}

function DescriptionCarousel({ layman, technical }: { layman: string; technical?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(0);
  const hasTech = !!technical && technical !== layman;

  // reset to the plain slide whenever the selected category changes
  useEffect(() => {
    setView(0);
    if (trackRef.current) trackRef.current.scrollTo({ left: 0 });
  }, [layman, technical]);

  const goto = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    setView(i);
  };

  return (
    <div>
      {hasTech && (
        <div className="mb-1.5 flex items-center gap-1">
          {['Plain terms', 'Technical'].map((lbl, i) => (
            <button
              key={lbl}
              type="button"
              onClick={() => goto(i)}
              className={[
                'rounded-full px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em] transition-colors',
                view === i ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/70',
              ].join(' ')}
            >
              {lbl}
            </button>
          ))}
          <span aria-hidden="true" className="ml-auto font-mono text-[8px] uppercase tracking-[0.16em] text-ink/30">
            swipe →
          </span>
        </div>
      )}
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setView(el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0);
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <p className="min-w-full shrink-0 snap-start pr-4 text-[12px] leading-relaxed text-ink/65">
          {layman}
        </p>
        {hasTech && (
          <p className="min-w-full shrink-0 snap-start pr-4 text-[12px] leading-relaxed text-ink/55">
            {technical}
          </p>
        )}
      </div>
    </div>
  );
}

export function ClassificationFilter({
  tabs,
  value,
  onChange,
  allLayman,
  allTechnical,
  inStock,
}: ClassificationFilterProps) {
  const allId = tabs[0]?.id;
  const stockColor = inStock?.color ?? '#2E7D5B';

  const isAll = value === allId;
  const layman = isAll ? allLayman : CLASSIFICATION_LAYMAN[value as ResearchClassification] ?? allLayman;
  const technical = isAll ? allTechnical : CLASSIFICATION_DEFINITIONS[value as ResearchClassification];

  return (
    <div className="mb-[var(--space-6)] rounded-xl border border-ink/[0.09] bg-ink/[0.025] p-[var(--space-3)]">
      {/* Header — label + optional in-stock toggle */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.28em] text-ink/45">Filter by category</span>
        {inStock && (
          <button
            type="button"
            role="switch"
            aria-checked={inStock.on}
            onClick={inStock.toggle}
            className={[
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
              inStock.on ? 'text-ink' : 'border-ink/15 text-ink/50 hover:text-ink/80 hover:border-ink/25',
            ].join(' ')}
            style={
              inStock.on
                ? { borderColor: `${stockColor}80`, backgroundColor: `${stockColor}18`, boxShadow: `0 0 10px ${stockColor}33` }
                : undefined
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-[6px] w-[6px] rounded-full"
              style={{ backgroundColor: inStock.on ? stockColor : 'rgba(26,23,20,0.25)', boxShadow: inStock.on ? `0 0 5px ${stockColor}aa` : undefined }}
            />
            In stock only
          </button>
        )}
      </div>

      {/* Category pills — all visible, wrap to new rows (no swipe / no long list) */}
      <div role="tablist" aria-label="Filter by category" className="mt-[var(--space-3)] flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className={[
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40',
                active
                  ? 'border border-holo/40 bg-holo/[0.12] text-holo font-medium'
                  : 'border border-ink/12 text-ink/55 hover:text-ink/85 hover:border-ink/25',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Single description for the selected category — small, swaps on click */}
      <div className="mt-[var(--space-3)] border-t border-ink/[0.07] pt-[var(--space-3)]">
        <DescriptionCarousel layman={layman} technical={technical} />
      </div>
    </div>
  );
}
