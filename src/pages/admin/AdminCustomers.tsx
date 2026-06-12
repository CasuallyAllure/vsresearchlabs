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
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          Customers
        </p>
        <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap">
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-white">
            <span className="font-light text-white/85">Directory </span>
            <span className="font-medium text-white">on file.</span>
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={[
                  'rounded-full px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] transition-colors',
                  statusFilter === s
                    ? 'bg-white/[0.10] text-white border border-white/25'
                    : 'border border-white/[0.08] text-white/55 hover:text-white/90',
                ].join(' ')}
              >
                {s}
              </button>
            ))}
            <input
              type="search"
              placeholder="Name / email / org"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ml-[var(--space-2)] w-[220px] px-[var(--space-3)] py-[var(--space-1)] bg-black border border-white/10 rounded-full text-[11px] text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
          </div>
        </div>
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-white/55">
            No customers on file yet. Records are auto-created when the
            first inquiry from a contact lands.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-white/[0.04]">
          {filtered.map((row) => (
            <li key={row.id}>
              <Link
                to={`/admin/customers/${row.id}`}
                className="block px-[var(--space-5)] py-[var(--space-4)] hover:bg-white/[0.015] focus:outline-none focus-visible:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-start gap-[var(--space-4)]">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white truncate">{row.display_name}</p>
                    <p className="font-mono text-[11px] text-white/55 truncate">
                      {row.contact}
                      {row.organization && (
                        <span className="text-white/35"> · {row.organization}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] text-white/70 tabular-nums">
                      {row.inquiry_count} inq · {row.order_count} ord
                    </p>
                    <p className="font-mono text-[10px] text-white/35 tabular-nums">
                      last seen {formatDate(row.last_seen_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border ${statusChipStyles(row.status)}`}>
                    {row.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-white/40">
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
    case 'active':   return 'border-[#7CD992]/40 text-[#7CD992]/90 bg-[#7CD992]/[0.06]';
    case 'inactive': return 'border-white/15 text-white/55 bg-white/[0.02]';
    case 'blocked':  return 'border-red-400/40 text-red-300/80 bg-red-400/[0.06]';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
