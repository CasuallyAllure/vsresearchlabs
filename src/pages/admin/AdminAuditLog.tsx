/**
 * AdminAuditLog
 *
 * Read-only viewer for the append-only audit_log. Filterable by action
 * prefix (e.g. "order.", "stock.", "customer.") and by actor email.
 * Newest entries first.
 *
 * The audit log is the canonical record of "who did what when" — every
 * RPC that mutates state writes an entry. Use this surface for
 * incident review, reconciliation, and audit response.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';

interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before_value: unknown;
  after_value: unknown;
}

const ENTITY_FILTERS = ['all', 'order', 'inquiry', 'stock', 'customer', 'admin_user', 'system'] as const;
type EntityFilter = (typeof ENTITY_FILTERS)[number];

export function AdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [actorFilter, setActorFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('audit_log')
        .select('id, occurred_at, actor_id, actor_email, action, entity_type, entity_id, summary, before_value, after_value')
        .order('occurred_at', { ascending: false })
        .limit(500);
      if (entityFilter !== 'all') q = q.eq('entity_type', entityFilter);
      if (actorFilter.trim()) q = q.ilike('actor_email', `%${actorFilter.trim()}%`);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as AuditRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [entityFilter, actorFilter]);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Audit Log</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <AdminFilterBar
            label=""
            dense
            options={ENTITY_FILTERS.map((f) => ({ value: f, label: f }))}
            value={entityFilter}
            onChange={setEntityFilter}
          />
          <input
            type="search"
            placeholder="Filter by actor email"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="min-w-0 flex-1 h-10 rounded-full border border-ink/10 bg-base-700 px-[var(--space-4)] text-[12px] text-ink placeholder-ink/30 transition-colors focus:border-ink/30 focus:outline-none"
          />
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>
      )}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">
            No audit entries match the current filter. Entries are written
            on every admin-driven state change (stock adjustments, order
            transitions, customer edits).
          </p>
        </div>
      )}

      {/* Mobile: one card per audit entry — same click-to-expand behavior as the table row. */}
      {rows && rows.length > 0 && (
        <div className="md:hidden flex flex-col gap-[var(--space-3)]">
          {rows.map((row) => {
            const isOpen = expanded === row.id;
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : row.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(isOpen ? null : row.id); }}
                className="floating-module p-4 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-[var(--space-3)]">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] tabular-nums text-ink/45">{formatTs(row.occurred_at)}</p>
                    <p className="font-mono text-[11px] text-holo-light/80 mt-0.5">{row.action}</p>
                  </div>
                  <p className="shrink-0 font-mono text-[10.5px] text-ink/55 text-right">
                    {row.actor_email ?? <span className="text-ink/35">system</span>}
                  </p>
                </div>
                <p className="mt-[var(--space-2)] text-[12.5px] text-ink/85">
                  {row.summary ?? <span className="text-ink/35">—</span>}
                  {row.entity_type === 'order' && row.entity_id && (
                    <Link
                      to={`/admin/orders/${row.entity_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 text-[11px] text-holo-light/70 hover:text-holo-light underline underline-offset-2"
                    >
                      Open ↗
                    </Link>
                  )}
                </p>
                {isOpen && (row.before_value !== null || row.after_value !== null) && (
                  <div className="mt-[var(--space-3)] grid grid-cols-1 gap-[var(--space-3)] border-t border-ink/[0.06] pt-[var(--space-3)]">
                    <DetailJson title="Before" value={row.before_value} />
                    <DetailJson title="After"  value={row.after_value} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="hidden md:block research-surface-solid overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b border-ink/[0.08]">
                <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[150px]">
                  When
                </th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[170px]">
                  Action
                </th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal">
                  Summary
                </th>
                <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[170px]">
                  Actor
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = expanded === row.id;
                return (
                  <>
                    <tr
                      key={row.id}
                      className="min-h-[44px] border-b border-ink/[0.04] hover:bg-ink/[0.02] transition-colors cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                    >
                      <td className="py-[var(--space-4)] pl-[var(--space-4)] pr-[var(--space-3)] font-mono text-[10.5px] tabular-nums text-ink/45 align-top">
                        {formatTs(row.occurred_at)}
                      </td>
                      <td className="py-[var(--space-4)] px-[var(--space-3)] font-mono text-[11px] text-holo-light/80 align-top">
                        {row.action}
                      </td>
                      <td className="py-[var(--space-4)] px-[var(--space-3)] text-[12.5px] text-ink/85 align-top">
                        {row.summary ?? <span className="text-ink/35">—</span>}
                        {row.entity_type === 'order' && row.entity_id && (
                          <Link
                            to={`/admin/orders/${row.entity_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-2 text-[11px] text-holo-light/70 hover:text-holo-light underline underline-offset-2"
                          >
                            Open ↗
                          </Link>
                        )}
                      </td>
                      <td className="py-[var(--space-4)] pl-[var(--space-3)] pr-[var(--space-4)] font-mono text-[10.5px] text-ink/55 truncate align-top">
                        {row.actor_email ?? <span className="text-ink/35">system</span>}
                      </td>
                    </tr>
                    {isOpen && (row.before_value !== null || row.after_value !== null) && (
                      <tr key={`${row.id}-detail`} className="bg-ink/40">
                        <td colSpan={4} className="px-[var(--space-4)] pb-[var(--space-4)]">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)] pt-[var(--space-3)]">
                            <DetailJson title="Before" value={row.before_value} />
                            <DetailJson title="After"  value={row.after_value} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-[var(--space-4)] holo-text-caption text-[10px] uppercase tracking-[0.22em]">
        Append-only. Showing latest 500 entries.
      </p>
    </AdminLayout>
  );
}

function DetailJson({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-ink/40 mb-[var(--space-1)]">{title}</p>
        <p className="text-[11px] text-ink/30">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.22em] text-ink/40 mb-[var(--space-1)]">{title}</p>
      <pre className="text-[11px] font-mono text-ink/70 whitespace-pre-wrap break-all bg-ink/60 border border-ink/[0.06] rounded-[12px] p-[var(--space-2)] overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`;
}
