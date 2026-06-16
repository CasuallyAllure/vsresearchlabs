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
  search,
  onSearch,
  searchPlaceholder = 'Search compounds…',
  suggestions,
}: ClassificationFilterProps) {
  const allId = tabs[0]?.id;
  const stockColor = inStock?.color ?? '#2E7D5B';

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
    <div className="mb-[var(--space-4)] rounded-xl border border-ink/[0.09] bg-ink/[0.025] p-[var(--space-2)]">
      {/* One compact row: search · category · in-stock */}
      <div className="flex flex-wrap items-center gap-2">
        {onSearch && (
          <div ref={searchRef} className="relative min-w-[160px] flex-1">
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
              className="w-full rounded-lg border border-ink/15 bg-base-700 py-1.5 pl-8 pr-7 text-[12.5px] text-ink placeholder:text-ink/35 transition-colors hover:border-ink/25 focus:outline-none focus:border-holo/40"
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
                className="absolute z-40 mt-1 max-h-[240px] w-full overflow-y-auto rounded-lg border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.3)]"
                style={{ backgroundColor: 'rgba(251,249,244,0.99)', backdropFilter: 'blur(8px)' }}
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

        {/* Category + in-stock — grouped so they stay on one line together */}
        <div className="flex items-center gap-2 shrink-0">
        <div ref={catRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-[140px] items-center justify-between gap-2 rounded-lg border border-ink/15 bg-base-700 px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
          >
            <span className="truncate font-medium">{currentLabel}</span>
            <span aria-hidden="true" className={`shrink-0 text-[10px] text-ink/45 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {open && (
            <ul
              role="listbox"
              aria-label="Categories"
              className="absolute right-0 z-40 mt-1 max-h-[260px] w-[220px] max-w-[80vw] overflow-y-auto rounded-lg border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.3)]"
              style={{ backgroundColor: 'rgba(251,249,244,0.99)', backdropFilter: 'blur(8px)' }}
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
                        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
                        active ? 'bg-holo/[0.10] text-holo font-medium' : 'text-ink/70 hover:bg-ink/[0.05] hover:text-ink',
                      ].join(' ')}
                    >
                      {tab.label}
                      {active && <span aria-hidden="true" className="text-[11px] text-holo">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {inStock && (
          <button
            type="button"
            role="switch"
            aria-checked={inStock.on}
            onClick={inStock.toggle}
            title={inStock.on ? 'Showing in-stock only — tap to show all' : 'Tap to show in-stock only'}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            style={
              inStock.on
                ? { borderColor: `${stockColor}99`, color: stockColor, backgroundColor: `${stockColor}14`, boxShadow: `0 0 9px ${stockColor}55` }
                : { borderColor: 'rgba(26,23,20,0.18)', color: 'rgba(26,23,20,0.4)' }
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-[6px] w-[6px] rounded-full transition-all"
              style={{
                backgroundColor: inStock.on ? stockColor : 'rgba(26,23,20,0.28)',
                boxShadow: inStock.on ? `0 0 5px ${stockColor}cc, inset 0 0 0 0.5px rgba(255,255,255,0.35)` : undefined,
              }}
            />
            In stock
          </button>
        )}
        </div>
      </div>

      {/* Description — compact, wraps, with plain/technical swap */}
      <div className="mt-[var(--space-2)] border-t border-ink/[0.07] pt-[var(--space-2)]">
        {hasTech && (
          <div className="mb-1 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowTech(false)}
              className={`rounded-full px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em] transition-colors ${!showTech ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/70'}`}
            >
              Plain terms
            </button>
            <button
              type="button"
              onClick={() => setShowTech(true)}
              className={`rounded-full px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em] transition-colors ${showTech ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/70'}`}
            >
              Technical detail
            </button>
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-ink/65">
          {showTech && hasTech ? technical : layman}
        </p>
      </div>
    </div>
  );
}
