/**
 * InvitesView — makes the invite funnel measurable and actionable. Lists sent
 * invites with conversion status, and drives the bulk-invite workflow over the
 * server-computed set of guests with unclaimed points. Single re-invites reuse
 * the existing InviteSheet; bulk sends reuse the same send-invite edge function
 * — no duplicated email or logging path.
 */

import { useState } from 'react';
import { AdminFilterBar } from '../AdminFilterBar';
import { Button } from '../../../components/ui/Button';
import { InviteSheet } from '../CustomerInvite';
import { Chip, RowAction, Tile } from './ui';
import { shortDate } from './format';
import {
  bulkInvite, useInvitableGuests, useInvites,
  type BulkProgress, type InviteFilter, type InviteRow,
} from './useInvites';

const FILTER_OPTIONS: Array<{ value: InviteFilter; label: string }> = [
  { value: 'all', label: 'All invites' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'converted', label: 'Converted' },
];

/** Stale outstanding invites (>7 days, no signup) read as needing follow-up. */
function inviteTone(row: InviteRow): { tone: 'good' | 'warn' | 'neutral'; label: string } {
  if (row.converted) return { tone: 'good', label: 'converted' };
  if ((row.staleDays ?? 0) > 7) return { tone: 'warn', label: `${row.staleDays}d outstanding` };
  return { tone: 'neutral', label: 'outstanding' };
}

export function InvitesView() {
  const [filter, setFilter] = useState<InviteFilter>('all');
  const { rows, total, summary, loading, error, unmigrated, reload } = useInvites(filter);
  const [reinvite, setReinvite] = useState<InviteRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  if (unmigrated) {
    return (
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="text-[13px] text-ink/55">
          Invite data layer not migrated yet — apply migration 073 to enable this view.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
        <Tile emphasis label="Sent" value={String(summary?.sent ?? 0)} meta={['invites logged']} />
        <Tile label="Converted" value={String(summary?.converted ?? 0)} meta={['signed up']} />
        <Tile label="Conversion" value={`${summary?.conversionPct ?? 0}%`} meta={['of sent invites']} />
        <Tile label="Outstanding" value={String(summary?.outstanding ?? 0)} meta={['awaiting signup']} />
      </div>

      <div className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <AdminFilterBar label="" dense options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        <Button type="button" variant="primary" size="sm" onClick={() => setBulkOpen(true)}>
          Invite eligible guests
        </Button>
      </div>

      {loading ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {rows.map((r) => {
            const t = inviteTone(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-1 px-[var(--space-5)] py-[var(--space-4)]">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] text-ink">
                    <span className="truncate font-mono text-[12px]">{r.email}</span>
                    <Chip tone={t.tone}>{t.label}</Chip>
                  </span>
                  <span className="block font-mono text-[10px] text-ink/45">
                    {r.pointsPromised.toLocaleString()} pts · sent {shortDate(r.sentIso)} · {r.channel}
                    {r.converted && r.convertedIso && <> · converted {shortDate(r.convertedIso)}</>}
                  </span>
                </span>
                {!r.converted && (
                  <RowAction onClick={() => setReinvite(r)}>Re-invite</RowAction>
                )}
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
              No invites{filter !== 'all' ? ` (${filter})` : ''} yet.
            </li>
          )}
          {rows.length > 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-3)] font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">
              Showing {rows.length} of {total}
            </li>
          )}
        </ul>
      )}

      {reinvite && (
        <InviteSheet
          target={{ display_name: reinvite.email, contact: reinvite.email }}
          points={reinvite.pointsPromised}
          onClose={() => { setReinvite(null); reload(); }}
        />
      )}

      {bulkOpen && (
        <BulkInviteDialog onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); reload(); }} />
      )}
    </div>
  );
}

/* ── Bulk invite — server-computed eligibility, throttled sends ────────────── */

function BulkInviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { guests, total, loading, error } = useInvitableGuests(true);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const final = await bulkInvite(guests, setProgress);
    setRunning(false);
    setProgress(final);
  }

  return (
    <>
      <div aria-hidden="true" onClick={running ? undefined : onClose} className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" aria-label="Invite eligible guests" className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[440px] research-surface-solid p-[var(--space-5)]">
          <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">Invite eligible guests</p>

          {loading ? (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Finding eligible guests…</p>
          ) : error ? (
            <p role="alert" className="text-[12px] text-red-400">{error}</p>
          ) : progress?.done ? (
            <p className="mb-[var(--space-4)] text-[13px] text-ink/80">
              Done — {progress.sent} sent{progress.failed > 0 ? `, ${progress.failed} failed` : ''}.
            </p>
          ) : progress ? (
            <p className="mb-[var(--space-4)] text-[13px] text-ink/80 tabular-nums">
              Sending… {progress.sent + progress.failed} / {progress.total}
            </p>
          ) : (
            <p className="mb-[var(--space-4)] text-[13px] text-ink/80">
              {total} {total === 1 ? 'guest has' : 'guests have'} banked points and no account yet
              {total > guests.length ? ` (${guests.length} in this batch)` : ''}. Each gets the standard
              invite email and is logged. This can’t be undone.
            </p>
          )}

          <div className="flex items-center justify-end gap-[var(--space-2)]">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={running}>
              {progress?.done ? 'Close' : 'Cancel'}
            </Button>
            {!progress?.done && (
              <Button type="button" variant="primary" size="sm" onClick={run} disabled={running || loading || guests.length === 0}>
                {running ? 'Sending…' : `Send ${guests.length} invite${guests.length === 1 ? '' : 's'}`}
              </Button>
            )}
            {progress?.done && (
              <Button type="button" variant="primary" size="sm" onClick={onDone}>Done</Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
