/**
 * ClassificationFilter — collapsed dropdown + readable description.
 *
 * Categories are HIDDEN inside a dropdown (click to open, pick one, it closes)
 * so the list never sprawls across the page. Below the dropdown a single
 * description shows the selected category in PLAIN ENGLISH, full-width and
 * wrapping (no horizontal scroll); a "Technical detail" toggle swaps the text
 * in place for the full mechanism.
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
  allLayman: string;
  allTechnical?: string;
  inStock?: { on: boolean; toggle: () => void; color?: string };
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

  const [open, setOpen] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close dropdown on outside-click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // reset to plain whenever the category changes
  useEffect(() => {
    setShowTech(false);
  }, [value]);

  const isAll = value === allId;
  const currentLabel = tabs.find((t) => t.id === value)?.label ?? tabs[0]?.label ?? 'All';
  const layman = isAll ? allLayman : CLASSIFICATION_LAYMAN[value as ResearchClassification] ?? allLayman;
  const technical = isAll ? allTechnical : CLASSIFICATION_DEFINITIONS[value as ResearchClassification];
  const hasTech = !!technical && technical !== layman;

  return (
    <div className="mb-[var(--space-6)] rounded-xl border border-ink/[0.09] bg-ink/[0.025] p-[var(--space-3)]">
      {/* Header — label + optional in-stock toggle */}
      <div className="mb-[var(--space-3)] flex items-center justify-between gap-3">
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

      {/* Dropdown selector — categories stay hidden until opened */}
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink/15 bg-base-700 px-3 py-2.5 text-left text-[13px] text-ink transition-colors hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
        >
          <span className="truncate font-medium">{currentLabel}</span>
          <span aria-hidden="true" className={`shrink-0 text-[11px] text-ink/45 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Categories"
            className="absolute z-30 mt-1 max-h-[260px] w-full overflow-y-auto rounded-lg border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.3)]"
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
                    onClick={() => {
                      onChange(tab.id);
                      setOpen(false);
                    }}
                    className={[
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors',
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

      {/* Description — full width, wraps, readable. Toggle swaps text in place. */}
      <div className="mt-[var(--space-3)] border-t border-ink/[0.07] pt-[var(--space-3)]">
        {hasTech && (
          <div className="mb-1.5 flex items-center gap-1">
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
        <p className="text-[12.5px] leading-relaxed text-ink/70">
          {showTech && hasTech ? technical : layman}
        </p>
      </div>
    </div>
  );
}
