/**
 * AutomationsView — the admin window into the membership automation stack
 * (migration 075 + the member-automations edge function). The stack ships
 * DARK: every kind is seeded disabled and nothing sends until it is enabled
 * here. This view lists the five kinds with their audited toggles (behind the
 * ConfirmModal pattern — never a native confirm), per-kind sent counts, and
 * the recent email_log trail (recipients masked on screen). Reuses the
 * Members house-style atoms.
 */

import { useState } from 'react';
import { useConfirm } from '../../../components/admin/ConfirmModal';
import { Chip, RowAction, Tile } from './ui';
import { shortDate } from './format';
import {
  AUTOMATION_KIND_META, maskRecipient, setAutomationKind, useAutomations,
  type AutomationKindMeta,
} from './useAutomations';

const KIND_NAME: Record<string, string> = Object.fromEntries(
  AUTOMATION_KIND_META.map((m) => [m.kind, m.name]),
);

export function AutomationsView() {
  const { enabled, logRows, logTotal, sentByKind, loading, error, unmigrated, reload } =
    useAutomations();
  const { confirm, modal } = useConfirm();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (unmigrated) {
    return (
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="text-[13px] text-ink/55">
          Automations data layer not migrated yet — apply migration 075 to enable this view.
        </p>
      </div>
    );
  }

  async function handleToggle(meta: AutomationKindMeta, isOn: boolean) {
    const message = isOn
      ? `Disable "${meta.name}"? The daily run will stop sending these emails.`
      : `Enable "${meta.name}"? The daily run will start sending these emails to eligible recipients.`;
    const ok = await confirm(message, { confirmLabel: isOn ? 'Disable' : 'Enable' });
    if (!ok) return;
    setBusyKind(meta.kind);
    setToggleError(null);
    const res = await setAutomationKind(meta.kind, !isOn);
    setBusyKind(null);
    if (!res.ok) { setToggleError(res.error); return; }
    reload();
  }

  return (
    <div>
      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}
      {toggleError && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{toggleError}</p>}

      {/* Per-kind sent counts — from admin_email_log's summary */}
      <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-5">
        {AUTOMATION_KIND_META.map((m) => (
          <Tile
            key={m.kind}
            label={m.name}
            value={String(sentByKind[m.kind] ?? 0)}
            meta={['emails sent']}
            emphasis={enabled[m.kind] === true}
          />
        ))}
      </div>

      {/* Dark-by-default posture, stated plainly */}
      <p className="mb-[var(--space-4)] font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
        All kinds ship disabled · nothing sends until enabled here · one email per recipient per period, claimed before sending
      </p>

      {loading ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : (
        <>
          {/* The five kinds + audited toggles */}
          <ul className="mb-[var(--space-5)] research-surface-solid divide-y divide-ink/[0.04]">
            {AUTOMATION_KIND_META.map((m) => {
              const isOn = enabled[m.kind] === true;
              return (
                <li key={m.kind} className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-1 px-[var(--space-5)] py-[var(--space-4)]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] text-ink">
                      <span className="truncate">{m.name}</span>
                      <Chip tone={isOn ? 'good' : 'neutral'}>{isOn ? 'enabled' : 'off'}</Chip>
                    </span>
                    <span className="block text-[11px] leading-relaxed text-ink/55">{m.description}</span>
                  </span>
                  <RowAction
                    danger={isOn}
                    disabled={busyKind !== null}
                    onClick={() => handleToggle(m, isOn)}
                  >
                    {busyKind === m.kind ? 'Saving…' : isOn ? 'Disable' : 'Enable'}
                  </RowAction>
                </li>
              );
            })}
          </ul>

          {/* Recent email_log trail */}
          <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">Recent sends</p>
          <ul className="research-surface-solid divide-y divide-ink/[0.04]">
            {logRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-1 px-[var(--space-5)] py-[var(--space-3)]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-ink/70">{maskRecipient(row.recipient)}</span>
                </span>
                <Chip tone="info">{KIND_NAME[row.kind] ?? row.kind}</Chip>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink/40">{shortDate(row.sentIso)}</span>
              </li>
            ))}
            {logRows.length === 0 && (
              <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
                No automated emails sent yet.
              </li>
            )}
            {logRows.length > 0 && (
              <li className="px-[var(--space-5)] py-[var(--space-3)] font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">
                Showing {logRows.length} of {logTotal}
              </li>
            )}
          </ul>
        </>
      )}

      {modal}
    </div>
  );
}
