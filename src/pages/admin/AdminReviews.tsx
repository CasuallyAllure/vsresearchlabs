/**
 * AdminReviews — the moderation queue for completed-order reviews (089).
 *
 * Every review lands `pending` and is invisible until approved here. Approving
 * and rejecting both go through admin_moderate_review, which writes audit_log,
 * so the decision trail matches every other admin verb.
 *
 * Reject anything that describes use of the material: published third-party
 * text about effects is an intended-use claim on a research-supply catalog.
 * That rule is stated on the page, not just in this comment.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { supabase } from '../../lib/supabase';
import { StarRating } from '../../components/ui/StarRating';
import { Chip, RowAction, Tile } from './members/ui';
import { getErrorMessage, isMissingBackend } from './members/backend';

type QueueStatus = 'pending' | 'approved' | 'rejected' | 'all';

interface ReviewRow {
  id: string;
  orderId: string;
  orderNumber: string;
  contact: string | null;
  name: string;
  rating: number;
  comment: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdIso: string;
}

interface Summary {
  pending: number;
  approved: number;
  rejected: number;
  average: number | null;
}

const STATUS_OPTIONS: Array<{ value: QueueStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export function AdminReviews() {
  const [status, setStatus] = useState<QueueStatus>('pending');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_review_queue', {
      p_status: status,
      p_limit: 100,
    });
    if (rpcError) {
      if (isMissingBackend(rpcError)) setUnmigrated(true);
      else setError(getErrorMessage(rpcError));
      setLoading(false);
      return;
    }
    const payload = data as unknown as { rows: ReviewRow[]; summary: Summary } | null;
    setRows(payload?.rows ?? []);
    setSummary(payload?.summary ?? null);
    setLoading(false);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function moderate(id: string, next: 'approved' | 'rejected') {
    if (!supabase) return;
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc('admin_moderate_review', { p_id: id, p_status: next });
    setBusyId(null);
    if (rpcError) { setError(getErrorMessage(rpcError)); return; }
    await load();
  }

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Reviews</h2>
        <AdminFilterBar label="" dense options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </header>

      {unmigrated ? (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">
            Review data layer not migrated yet — apply migration 089 to enable this page.
          </p>
        </div>
      ) : (
        <>
          {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

          <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
            <Tile emphasis label="Pending" value={String(summary?.pending ?? 0)} meta={['awaiting a decision']} />
            <Tile label="Published" value={String(summary?.approved ?? 0)} meta={['live on the catalog']} />
            <Tile label="Rejected" value={String(summary?.rejected ?? 0)} meta={['never shown']} />
            <Tile
              label="Average"
              value={summary?.average != null ? summary.average.toFixed(1) : '—'}
              meta={['of published']}
            />
          </div>

          <p className="mb-[var(--space-4)] text-[11.5px] leading-relaxed text-ink/45">
            Publish feedback about fulfilment — packing, transit, paperwork, communication. Reject anything
            describing use of the material: once published it reads as a claim about what the compound does.
          </p>

          {loading ? (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
          ) : (
            <ul className="research-surface-solid divide-y divide-ink/[0.04]">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-4)]">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <StarRating value={r.rating} />
                      <span className="font-mono text-[11px] text-ink/60">{r.orderNumber}</span>
                      <Chip tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'warn' : 'neutral'}>
                        {r.status}
                      </Chip>
                    </span>
                    {r.comment ? (
                      <span className="mt-[var(--space-2)] block whitespace-pre-wrap text-[13px] leading-relaxed text-ink/75">
                        {r.comment}
                      </span>
                    ) : (
                      <span className="mt-[var(--space-2)] block text-[12px] italic text-ink/35">Rating only, no comment.</span>
                    )}
                    <span className="mt-[var(--space-2)] block font-mono text-[10px] text-ink/35">
                      {r.name} · {r.contact ?? 'no contact'} · {r.createdIso}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-[var(--space-2)]">
                    {r.status !== 'approved' && (
                      <RowAction disabled={busyId === r.id} onClick={() => void moderate(r.id, 'approved')}>
                        Publish
                      </RowAction>
                    )}
                    {r.status !== 'rejected' && (
                      <RowAction danger disabled={busyId === r.id} onClick={() => void moderate(r.id, 'rejected')}>
                        Reject
                      </RowAction>
                    )}
                  </span>
                </li>
              ))}
              {rows.length === 0 && (
                <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
                  Nothing here.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </AdminLayout>
  );
}
