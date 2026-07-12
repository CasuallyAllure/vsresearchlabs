/**
 * AdminOrders
 *
 * Order pipeline. Compact header (title + sort + status + date filters on one
 * line). Each row opens the order as a floating module — the same <OrderView>
 * that serves the full /admin/orders/:id page — so the whole lifecycle (invoice
 * → paid → ship → deliver, notes, printable invoice) is handled right here
 * without leaving the list.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { OrderView } from './OrderView';
import { OrderStatusChip } from '../../components/ui/OrderStatusChip';

type OrderStatus =
  | 'pending_review'   // migration 020 — new buyer-placed order awaiting admin look
  | 'pending_invoice'
  | 'invoice_sent'
  | 'payment_claimed'  // migration 020 — buyer clicked "I've sent payment"
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  invoice_amount_cents: number | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

type FilterValue = OrderStatus | 'ALL' | 'OPEN';

const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ALL', label: 'All' },
  { value: 'pending_review', label: 'New' },
  { value: 'pending_invoice', label: 'To invoice' },
  { value: 'invoice_sent', label: 'Sent' },
  { value: 'payment_claimed', label: 'Claims paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'fulfilled', label: 'Shipped' },
  { value: 'cancelled', label: 'Cancelled' },
];

const OPEN_STATUSES: OrderStatus[] = [
  'pending_review',
  'pending_invoice',
  'invoice_sent',
  'payment_claimed',
  'paid',
];

type DateValue = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom';

const DATE_OPTIONS: Array<{ value: DateValue; label: string }> = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom…' },
];

/** ISO cutoff for a preset date filter, or null for "any date" / "custom". */
function dateCutoff(v: DateValue): string | null {
  if (v === 'all' || v === 'custom') return null;
  const d = new Date();
  if (v === 'today') d.setHours(0, 0, 0, 0);
  else if (v === '7d') d.setDate(d.getDate() - 7);
  else if (v === '30d') d.setDate(d.getDate() - 30);
  else if (v === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}

type SortValue = 'recent' | 'oldest' | 'price_high' | 'price_low';

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'recent', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price_high', label: 'Price ↓' },
  { value: 'price_low', label: 'Price ↑' },
];

function sortRows(rows: OrderRow[], sort: SortValue): OrderRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'recent':     copy.sort((a, b) => b.created_at.localeCompare(a.created_at)); break;
    case 'oldest':     copy.sort((a, b) => a.created_at.localeCompare(b.created_at)); break;
    case 'price_high': copy.sort((a, b) => (b.invoice_amount_cents ?? -1) - (a.invoice_amount_cents ?? -1)); break;
    case 'price_low':  copy.sort((a, b) => (a.invoice_amount_cents ?? Infinity) - (b.invoice_amount_cents ?? Infinity)); break;
  }
  return copy;
}

export function AdminOrders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('OPEN');
  const [dateFilter, setDateFilter] = useState<DateValue>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState<SortValue>('recent');
  const [refreshKey, setRefreshKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('orders')
        .select('id, order_number, status, buyer_name, buyer_contact, buyer_organization, invoice_amount_cents, delivered_at, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (filter === 'OPEN') q = q.in('status', OPEN_STATUSES);
      else if (filter !== 'ALL') q = q.eq('status', filter);
      if (dateFilter === 'custom') {
        if (customFrom) q = q.gte('created_at', new Date(`${customFrom}T00:00:00`).toISOString());
        if (customTo) q = q.lte('created_at', new Date(`${customTo}T23:59:59`).toISOString());
      } else {
        const cutoff = dateCutoff(dateFilter);
        if (cutoff) q = q.gte('created_at', cutoff);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as OrderRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filter, dateFilter, customFrom, customTo, refreshKey]);

  const sortedRows = useMemo(() => (rows ? sortRows(rows, sort) : null), [rows, sort]);

  const reload = () => setRefreshKey((k) => k + 1);

  return (
    <AdminLayout>
      {/* Admin header grammar: line 1 = title + primary action, line 2 =
          dense filter row. Same structure as AdminInventory. */}
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Orders</h2>
          <Link
            to="/admin/orders/new"
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-ink/20 bg-ink/[0.04] px-[var(--space-4)] py-2 text-[10px] uppercase tracking-[0.16em] text-ink/80 transition-colors hover:border-ink/35 hover:text-ink"
          >
            + New order
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <AdminFilterBar label="" options={SORT_OPTIONS} value={sort} onChange={setSort} dense />
          <AdminFilterBar label="" options={FILTER_OPTIONS} value={filter} onChange={setFilter} dense />
          <AdminFilterBar label="" options={DATE_OPTIONS} value={dateFilter} onChange={setDateFilter} dense menuAlign="right" />
        </div>
        {dateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/45">
            <span>From</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-10 rounded-field border border-ink/12 bg-base-700 px-3 text-[11px] tracking-normal text-ink transition-[border-color,box-shadow] duration-150 hover:border-ink/20 focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15"
            />
            <span>to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-10 rounded-field border border-ink/12 bg-base-700 px-3 text-[11px] tracking-normal text-ink transition-[border-color,box-shadow] duration-150 hover:border-ink/20 focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15"
            />
          </div>
        )}
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">
            No orders in this filter. New orders are created from the Inquiries tab.
          </p>
        </div>
      )}

      {sortedRows && sortedRows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {sortedRows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setOpenId(row.id)}
                className="flex w-full items-stretch gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-4)] text-left transition-colors hover:bg-ink/[0.012] focus:outline-none focus-visible:bg-ink/[0.02] sm:px-[var(--space-5)]"
              >
                <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-[11px] tracking-[0.04em] text-holo-light/80">{row.order_number}</span>
                    <OrderStatusChip status={row.status} deliveredAt={row.delivered_at} />
                  </span>
                  <span className="truncate text-[13px] text-ink">{row.buyer_name}</span>
                  <span className="truncate text-[11px] text-ink/45">
                    {row.buyer_contact}
                    {row.buyer_organization && ` · ${row.buyer_organization}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end justify-center gap-1 text-right">
                  <span className="font-mono text-[12px] tabular-nums text-ink/80">{formatCents(row.invoice_amount_cents)}</span>
                  <span className="hidden font-mono text-[10px] tabular-nums text-ink/35 sm:block">{formatTs(row.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <OrderModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </AdminLayout>
  );
}

/* ── Order modal — the floating module over the list ─────────────────────── */

function OrderModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[210] bg-[color:var(--scrim)] backdrop-blur-[8px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-[211] flex items-start justify-center p-3 pointer-events-none sm:p-8">
        <div className="pointer-events-auto flex max-h-[88vh] w-full max-w-[760px] flex-col floating-module">
          <div className="flex items-center justify-end border-b border-ink/[0.08] px-[var(--space-4)] py-[var(--space-2)]">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-ink/15 px-[var(--space-4)] text-[10px] uppercase tracking-[0.2em] text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
            >
              Close
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto">
            <OrderView orderId={id} onChanged={onChanged} />
          </div>
        </div>
      </div>
    </>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

// Promoted to src/components/ui/OrderStatusChip.tsx (also consumed by the
// customer portal); re-exported here so existing imports of this module
// keep working unchanged.
export { OrderStatusChip };
