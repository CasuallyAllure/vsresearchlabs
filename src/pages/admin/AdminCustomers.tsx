/**
 * AdminCustomers
 *
 * Customer directory deduped by lowercase(contact). Each row clicks
 * through to AdminCustomerDetail. Counts are maintained by triggers
 * (see migration 004 — trg_upsert_customer_on_inquiry and
 * trg_bump_customer_order_count).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';

interface CustomerRow {
  id: string;
  contact_key: string;
  display_name: string;
  contact: string;
  organization: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'blocked';
  first_seen_at: string;
  last_seen_at: string;
  inquiry_count: number;
  order_count: number;
  last_inquiry_at: string | null;
  last_order_at:   string | null;
}

const STATUS_FILTERS: Array<CustomerRow['status'] | 'all'> = [
  'all', 'active', 'inactive', 'blocked',
];

export function AdminCustomers() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('customer_with_history')
        .select('id, contact_key, display_name, contact, organization, phone, status, first_seen_at, last_seen_at, inquiry_count, order_count, last_inquiry_at, last_order_at')
        .order('last_seen_at', { ascending: false })
        .limit(500);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as CustomerRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.display_name.toLowerCase().includes(q) ||
      r.contact.toLowerCase().includes(q) ||
      (r.organization?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, query]);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Customers</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <AdminFilterBar
            label=""
            dense
            options={STATUS_FILTERS.map((s) => ({ value: s, label: s }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <input
            type="search"
            placeholder="Name / email / org"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 min-h-[40px] flex-1 rounded-full border border-ink/10 bg-base-700 px-[var(--space-3)] py-[5px] text-[12px] text-ink placeholder-ink/30 transition-colors focus:border-ink/30 focus:outline-none"
          />
        </div>
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">
            No customers on file yet. Records are auto-created when the
            first inquiry from a contact lands.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {filtered.map((row) => (
            <li key={row.id}>
              <Link
                to={`/admin/customers/${row.id}`}
                className="block min-h-[44px] px-[var(--space-5)] py-[var(--space-4)] hover:bg-ink/[0.015] focus:outline-none focus-visible:bg-ink/[0.02] transition-colors"
              >
                <div className="flex items-start gap-[var(--space-4)]">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-ink truncate">{row.display_name}</p>
                    <p className="font-mono text-[11px] text-ink/55 truncate">
                      {row.contact}
                      {row.organization && (
                        <span className="text-ink/35"> · {row.organization}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] text-ink/70 tabular-nums">
                      {row.inquiry_count} inq · {row.order_count} ord
                    </p>
                    <p className="font-mono text-[10px] text-ink/35 tabular-nums">
                      last seen {formatDate(row.last_seen_at)}
                    </p>
                  </div>
                  <span className={`${CHIP_BASE} ${statusChipStyles(row.status)}`}>
                    {row.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
              No matches for "{query}"
            </li>
          )}
        </ul>
      )}
    </AdminLayout>
  );
}

function statusChipStyles(status: CustomerRow['status']): string {
  switch (status) {
    case 'active':   return 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]';
    case 'inactive': return 'border-ink/15 text-ink/55 bg-ink/[0.02]';
    case 'blocked':  return 'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
