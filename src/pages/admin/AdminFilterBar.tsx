/**
 * AdminFilterBar
 *
 * Compact, single-line status filter. Replaces the old wrap-everywhere pill
 * rows that ate ~a third of the header. A mono "Filter" label pins to the
 * left; the options live in a horizontally-scrollable strip (hidden
 * scrollbar) so any number of statuses stays on one tidy line — on mobile you
 * swipe through them instead of the bar growing three rows tall.
 *
 * An optional `trailing` slot (e.g. a search box) sits flush to the right on
 * desktop and drops to its own full-width line on mobile, keeping the bar
 * symmetric at every width.
 */

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
}

export function AdminFilterBar<T extends string>({
  label = 'Filter',
  options,
  value,
  onChange,
  trailing,
}: AdminFilterBarProps<T>) {
  return (
    <div className="flex w-full flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:gap-[var(--space-3)]">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/[0.08] bg-base-800/70 py-1 pl-3 pr-1.5">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-ink/40">
          {label}
        </span>
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                aria-pressed={on}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors',
                  on
                    ? 'bg-ink/[0.12] text-ink'
                    : 'text-ink/50 hover:text-ink/85',
                ].join(' ')}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {trailing && <div className="w-full sm:w-auto sm:shrink-0">{trailing}</div>}
    </div>
  );
}
