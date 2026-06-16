/**
 * AdminFilterBar
 *
 * A real dropdown select — NOT a swipe strip. The trigger shows a mono label
 * + the current selection; clicking drops a vertical column of every option
 * down over the page (the way a normal select works), so you pick from a list
 * instead of scrolling pills left/right. Collapses after a pick.
 *
 * An optional `trailing` slot (e.g. a search box) sits to the right on desktop
 * and drops to its own full-width line on mobile. Shared by every admin list
 * (filters) and the AdminLayout section nav.
 */

import { useEffect, useState } from 'react';

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface AdminFilterBarProps<T extends string> {
  label?: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Optional right-aligned control (search input, toggle, etc.). */
  trailing?: React.ReactNode;
  /** Width of the dropdown trigger. */
  widthClass?: string;
  /**
   * Compact inline trigger — smaller height/type, auto width, no rounded
   * "field" look. Used by the AdminLayout section nav so it reads as a tiny
   * control in the top bar rather than a full-width form field.
   */
  dense?: boolean;
}

export function AdminFilterBar<T extends string>({
  label = 'Filter',
  options,
  value,
  onChange,
  trailing,
  widthClass = 'sm:w-[260px]',
  dense = false,
}: AdminFilterBarProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div
      className={
        dense
          ? 'flex items-center gap-[var(--space-2)]'
          : 'flex w-full flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:gap-[var(--space-3)]'
      }
    >
      <div className={dense ? 'relative' : `relative w-full ${widthClass}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={
            dense
              ? 'flex items-center gap-1.5 rounded-full border border-ink/[0.12] bg-ink/[0.02] py-1 pl-2.5 pr-2 text-left transition-colors hover:border-ink/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30'
              : 'flex w-full items-center gap-2 rounded-[10px] border border-ink/[0.12] bg-base-800/70 py-2 pl-3 pr-2.5 text-left transition-colors hover:border-ink/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30'
          }
        >
          <span className={`shrink-0 font-mono uppercase tracking-[0.22em] text-ink/40 ${dense ? 'text-[8.5px]' : 'text-[9px]'}`}>
            {label}
          </span>
          <span className={`min-w-0 truncate uppercase tracking-[0.14em] text-ink ${dense ? 'text-[10px]' : 'flex-1 text-[11px]'}`}>
            {current?.label ?? '—'}
          </span>
          <svg
            width={dense ? '10' : '11'} height={dense ? '10' : '11'} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-ink/45 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[120] cursor-default"
            />
            <ul
              role="listbox"
              className={`no-scrollbar absolute top-full z-[121] mt-1.5 max-h-[60vh] overflow-y-auto rounded-[10px] border border-ink/[0.12] bg-display py-1 shadow-[0_18px_44px_-14px_rgba(26,23,20,0.45)] ${dense ? 'left-0 min-w-[200px]' : 'left-0 right-0'}`}
            >
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[11.5px] uppercase tracking-[0.12em] transition-colors',
                        on ? 'bg-ink/[0.06] text-ink' : 'text-ink/65 hover:bg-ink/[0.04] hover:text-ink',
                      ].join(' ')}
                    >
                      <span className="truncate">{o.label}</span>
                      {on && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-holo">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {trailing && <div className="w-full sm:w-auto sm:shrink-0">{trailing}</div>}
    </div>
  );
}
