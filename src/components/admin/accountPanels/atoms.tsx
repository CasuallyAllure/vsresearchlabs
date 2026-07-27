/**
 * accountPanels/atoms — the small presentational atoms the three management
 * panels share (labels, panel caption, submit button, inline error/success,
 * muted note, badge). Kept in their own component-only module so fast-refresh
 * stays happy; the non-component helpers live in ./shared.
 *
 * Extracted verbatim from the former CustomerAccountPanels — same house style.
 */

import { Button } from '../../ui/Button';
import { CHIP_BASE } from '../../ui/OrderStatusChip';

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]">{children}</label>;
}

export function PanelCaption({ children }: { children: React.ReactNode }) {
  return <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">{children}</p>;
}

export function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
      {children}
    </Button>
  );
}

export function InlineError({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{children}</p>;
}

export function InlineSuccess({ children }: { children: React.ReactNode }) {
  return <p className="mb-[var(--space-3)] text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-status-success)]">{children}</p>;
}

export function MutedNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink/40">{children}</p>;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'good' }) {
  const cls =
    tone === 'good' ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    tone === 'warn' ? 'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]' :
                       'border-ink/15 text-ink/60 bg-ink/[0.03]';
  return (
    <span className={`${CHIP_BASE} ${cls}`}>
      {children}
    </span>
  );
}
