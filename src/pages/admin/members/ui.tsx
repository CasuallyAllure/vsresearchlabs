/**
 * Shared house-style atoms for the Members control center — extracted from
 * AdminMembers so the roster, Redemptions and Invites sub-views render as one
 * system (same classes as AdminStatModules / CustomerAccountPanels). Presentation
 * only; no data access.
 */

import { CHIP_BASE } from '../../../components/ui/OrderStatusChip';

export type ChipTone = 'neutral' | 'warn' | 'good' | 'info';

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const cls =
    tone === 'good' ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    tone === 'warn' ? 'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]' :
    tone === 'info' ? 'border-ink/10 text-[color:var(--color-status-info)] bg-[color:var(--color-status-infoMuted)]' :
                      'border-ink/15 text-ink/60 bg-ink/[0.03]';
  return <span className={`${CHIP_BASE} ${cls}`}>{children}</span>;
}

export function Tile({ label, value, meta, emphasis }: { label: string; value: string; meta: string[]; emphasis?: boolean }) {
  return (
    <div className="research-surface-solid px-[var(--space-4)] py-[var(--space-4)]">
      <span className="mb-[var(--space-2)] block holo-text-caption text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <span className={
        emphasis
          ? 'holo-text-display block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums'
          : 'block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums text-ink'
      }>
        {value}
      </span>
      <span className="mt-[var(--space-2)] block space-y-0.5">
        {meta.map((x, i) => (
          <span key={i} className="block truncate font-mono text-[10px] tabular-nums text-ink/45">{x}</span>
        ))}
      </span>
    </div>
  );
}

export function Panel({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">{caption}</p>
      {children}
    </div>
  );
}

/** A quiet, enabled row/section action button (re-invite, void, load more). */
export function RowAction({
  onClick, disabled, danger, children,
}: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'shrink-0 rounded-full border px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'border-red-400/35 text-red-400/80 hover:border-red-400/55 hover:text-red-300'
          : 'border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export interface SubNavItem<T extends string> { value: T; label: string }

/** The Members sub-view switcher (Roster · Redemptions · Invites). Quiet
 *  segmented control in the admin register — a tab strip, not a redesign. */
export function SubNav<T extends string>({
  items, value, onChange,
}: { items: SubNavItem<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label="Members views" className="inline-flex gap-[2px] rounded-full border border-ink/10 bg-ink/[0.02] p-[3px]">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.value)}
            className={[
              'rounded-full px-[var(--space-4)] py-[6px] text-[10px] uppercase tracking-[0.16em] transition-colors',
              on ? 'bg-ink/[0.08] font-medium text-ink' : 'text-ink/50 hover:text-ink',
            ].join(' ')}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
