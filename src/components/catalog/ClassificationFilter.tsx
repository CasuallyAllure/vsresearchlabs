/**
 * ClassificationFilter — vertical, click-to-expand classification filter.
 *
 * Replaces the old horizontal swipe-row of pills. Tap a category and it
 * expands DOWN (accordion) to reveal what it is — in PLAIN ENGLISH first,
 * with the full technical definition one swipe to the right (a 2-slide
 * carousel). Selecting a category also filters the grid (via onChange).
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

  // reset to the plain slide whenever the content changes
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

  const hasTech = !!technical && technical !== layman;

  return (
    <div className="mt-[var(--space-2)]">
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
        <p className="min-w-full shrink-0 snap-start pr-4 text-[12.5px] leading-relaxed text-ink/70">
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

  return (
    <div className="mb-[var(--space-6)] rounded-xl border border-ink/[0.09] bg-ink/[0.025] p-[var(--space-3)]">
      {/* Header row — label + optional in-stock toggle */}
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

      {/* Vertical accordion of categories */}
      <ul className="mt-[var(--space-3)] flex flex-col divide-y divide-ink/[0.06]">
        {tabs.map((tab) => {
          const active = tab.id === value;
          const isAll = tab.id === allId;
          const layman = isAll ? allLayman : CLASSIFICATION_LAYMAN[tab.id as ResearchClassification] ?? allLayman;
          const technical = isAll
            ? allTechnical
            : CLASSIFICATION_DEFINITIONS[tab.id as ResearchClassification];
          return (
            <li key={tab.id}>
              <button
                type="button"
                aria-expanded={active}
                onClick={() => onChange(tab.id)}
                className={[
                  'flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors focus:outline-none',
                  active ? 'text-ink' : 'text-ink/65 hover:text-ink',
                ].join(' ')}
              >
                <span className={`text-[13px] tracking-tight ${active ? 'font-medium' : ''}`}>{tab.label}</span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-[11px] transition-transform duration-200 ${active ? 'rotate-180 text-holo' : 'text-ink/35'}`}
                >
                  ▾
                </span>
              </button>
              {active && <div className="pb-[var(--space-3)]"><DescriptionCarousel layman={layman} technical={technical} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
