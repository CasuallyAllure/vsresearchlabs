/**
 * AdminOrders
 *
 * Order pipeline. Compact status filter (one scrollable line) + a dense row
 * per order carrying its own quick-action menu so the next pipeline step
 * (mark paid → ship → delivered, or cancel) is one tap away without opening
 * the detail page. Tapping the row body still opens AdminOrderDetail.
 *
 * Quick actions move status only (via the same SECURITY DEFINER RPCs the
 * detail page uses). Tracking entry + the customer emails (invoice / shipment
 * / delivered-discount) still live on the detail page, where the tracking
 * number is captured.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';

type OrderStatus =
  | 'pending_invoice'
  | 'invoice_sent'
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
  { value: 'pending_invoice', label: 'To invoice' },
  { value: 'invoice_sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'fulfilled', label: 'Shipped' },
  { value: 'cancelled', label: 'Cancelled' },
];

const OPEN_STATUSES: OrderStatus[] = ['pending_invoice', 'invoice_sent', 'paid'];

type DateValue = 'all' | 'today' | '7d' | '30d' | 'month';

const DATE_OPTIONS: Array<{ value: DateValue; label: string }> = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
];

/** ISO cutoff for a date filter, or null for "any date". */
function dateCutoff(v: DateValue): string | null {
  if (v === 'all') return null;
  const d = new Date();
  if (v === 'today') d.setHours(0, 0, 0, 0);
  else if (v === '7d') d.setDate(d.getDate() - 7);
  else if (v === '30d') d.setDate(d.getDate() - 30);
  else if (v === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}

export function AdminOrders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('OPEN');
  const [dateFilter, setDateFilter] = useState<DateValue>('all');
  const [refreshKey, setRefreshKey] = useState(0);

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
      const cutoff = dateCutoff(dateFilter);
      if (cutoff) q = q.gte('created_at', cutoff);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as OrderRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filter, dateFilter, refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)] flex items-center gap-[var(--space-2)]">
        <h2 className="shrink-0 text-[clamp(1.05rem,2.4vw,1.6rem)] font-medium leading-[1.1] tracking-[-0.01em] text-ink">
          Orders
        </h2>
        <div className="ml-auto flex min-w-0 items-center gap-[var(--space-2)]">
          <AdminFilterBar options={FILTER_OPTIONS} value={filter} onChange={setFilter} dense />
          <AdminFilterBar options={DATE_OPTIONS} value={dateFilter} onChange={setDateFilter} dense />
        </div>
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

      {rows && rows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {rows.map((row) => (
            <li key={row.id} className="flex items-stretch gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] hover:bg-ink/[0.012] transition-colors sm:px-[var(--space-5)]">
              {/* Main info — opens the detail page */}
              <Link
                to={`/admin/orders/${row.id}`}
                className="flex min-w-0 flex-1 flex-col justify-center gap-1 focus:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] tracking-[0.04em] text-holo-light/80">
                    {row.order_number}
                  </span>
                  <OrderStatusChip status={row.status} deliveredAt={row.delivered_at} />
                </div>
                <span className="truncate text-[13px] text-ink">{row.buyer_name}</span>
                <span className="truncate text-[11px] text-ink/45">
                  {row.buyer_contact}
                  {row.buyer_organization && ` · ${row.buyer_organization}`}
                </span>
              </Link>

              {/* Amount + date + quick actions — symmetric right rail */}
              <div className="flex shrink-0 flex-col items-end justify-center gap-1.5 text-right">
                <span className="font-mono text-[12px] tabular-nums text-ink/80">
                  {formatCents(row.invoice_amount_cents)}
                </span>
                <span className="hidden font-mono text-[10px] tabular-nums text-ink/35 sm:block">
                  {formatTs(row.created_at)}
                </span>
                <OrderRowActions row={row} onDone={reload} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}

/* ── Per-row pipeline quick actions ──────────────────────────────────────── */

interface ActionItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

function OrderRowActions({ row, onDone }: { row: OrderRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }

  async function run(rpc: () => PromiseLike<{ error: { message: string } | null }>, confirmMsg?: string) {
    setOpen(false);
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    const { error } = await rpc();
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone();
  }

  // Context-valid transitions for this order's current status.
  const items: ActionItem[] = [];
  if (supabase) {
    switch (row.status) {
      case 'pending_invoice':
        items.push({ label: 'Open to invoice →', onSelect: () => { window.location.href = `/admin/orders/${row.id}`; } });
        items.push({ label: 'Cancel order', danger: true, onSelect: () => run(() => supabase!.rpc('cancel_order', { p_order_id: row.id, p_reason: cancelReason() }), 'Cancel this order?') });
        break;
      case 'invoice_sent':
        items.push({ label: 'Mark paid', onSelect: () => run(() => supabase!.rpc('mark_order_paid', { p_order_id: row.id })) });
        items.push({ label: 'Cancel order', danger: true, onSelect: () => run(() => supabase!.rpc('cancel_order', { p_order_id: row.id, p_reason: cancelReason() }), 'Cancel this order?') });
        break;
      case 'paid':
        items.push({ label: 'Mark shipped', onSelect: () => run(() => supabase!.rpc('confirm_order_fulfilled', { p_order_id: row.id, p_tracking_number: null, p_carrier: null }), 'Mark shipped? This deducts stock for each line. Add tracking + email the buyer from the detail page.') });
        items.push({ label: 'Cancel order', danger: true, onSelect: () => run(() => supabase!.rpc('cancel_order', { p_order_id: row.id, p_reason: cancelReason() }), 'Cancel this order?') });
        break;
      case 'fulfilled':
        if (!row.delivered_at) {
          items.push({ label: 'Mark delivered', onSelect: () => run(() => supabase!.rpc('mark_order_delivered', { p_order_id: row.id })) });
        }
        items.push({ label: 'Tracking / details →', onSelect: () => { window.location.href = `/admin/orders/${row.id}`; } });
        break;
      default:
        items.push({ label: 'Open details →', onSelect: () => { window.location.href = `/admin/orders/${row.id}`; } });
    }
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ink/[0.03] px-2.5 py-1 text-[9.5px] uppercase tracking-[0.16em] text-ink/75 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
      >
        {busy ? '…' : 'Manage'}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {err && <p className="absolute right-0 top-full mt-1 w-[180px] text-right text-[10px] text-red-400">{err}</p>}

      {open && pos && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[120] cursor-default"
          />
          <div
            role="menu"
            className="fixed z-[121] min-w-[180px] overflow-hidden rounded-[8px] border border-ink/[0.12] bg-display shadow-[0_18px_44px_-14px_rgba(26,23,20,0.45)]"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={it.onSelect}
                className={[
                  'block w-full px-3.5 py-2.5 text-left text-[11.5px] transition-colors',
                  it.danger
                    ? 'text-red-400/85 hover:bg-red-400/[0.06]'
                    : 'text-ink/80 hover:bg-ink/[0.04] hover:text-ink',
                ].join(' ')}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function cancelReason(): string {
  const r = window.prompt('Reason for cancellation (optional):') ?? '';
  return r.trim() || 'Cancelled by admin';
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function OrderStatusChip({ status, deliveredAt }: { status: OrderStatus; deliveredAt?: string | null }) {
  // A fulfilled order with a delivery date reads as "delivered" — the order
  // status enum has no 'delivered' value, so delivered_at is the signal.
  if (deliveredAt && status === 'fulfilled') {
    return (
      <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border border-[#2E7D5B]/40 text-[#2E7D5B]/90 bg-[#2E7D5B]/[0.06]">
        delivered
      </span>
    );
  }
  let cls = '';
  let label = status.replace(/_/g, ' ');
  switch (status) {
    case 'pending_invoice': cls = 'border-ink/25 text-ink/80 bg-ink/[0.05]'; break;
    case 'invoice_sent':    cls = 'border-holo/40 text-holo-light/80 bg-holo/[0.08]'; break;
    case 'paid':            cls = 'border-[#2E7D5B]/40 text-[#2E7D5B]/90 bg-[#2E7D5B]/[0.06]'; break;
    case 'fulfilled':       cls = 'border-ink/15 text-ink/55 bg-ink/[0.02]'; label = 'shipped'; break;
    case 'cancelled':       cls = 'border-red-400/40 text-red-300/80 bg-red-400/[0.06]'; break;
    case 'refunded':        cls = 'border-red-400/30 text-red-300/65 bg-red-400/[0.04]'; break;
  }
  return (
    <span className={`shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border ${cls}`}>
      {label}
    </span>
  );
}
