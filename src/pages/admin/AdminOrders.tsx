/**
 * AdminOrders
 *
 * Order list. Status chip + buyer + total + last-updated. Click a row
 * to open AdminOrderDetail.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';

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
  created_at: string;
  updated_at: string;
}

const STATUS_FILTERS: Array<OrderStatus | 'ALL' | 'OPEN'> = [
  'OPEN',
  'ALL',
  'pending_invoice',
  'invoice_sent',
  'paid',
  'fulfilled',
  'cancelled',
];

const OPEN_STATUSES: OrderStatus[] = ['pending_invoice', 'invoice_sent', 'paid'];

export function AdminOrders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('OPEN');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('orders')
        .select('id, order_number, status, buyer_name, buyer_contact, buyer_organization, invoice_amount_cents, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (filter === 'OPEN') q = q.in('status', OPEN_STATUSES);
      else if (filter !== 'ALL') q = q.eq('status', filter);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as OrderRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          Orders
        </p>
        <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap">
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-ink">
            <span className="font-light text-ink/85">Order </span>
            <span className="font-medium text-ink">pipeline.</span>
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={[
                  'rounded-full px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] transition-colors',
                  filter === s
                    ? 'bg-ink/[0.10] text-ink border border-ink/25'
                    : 'border border-ink/[0.08] text-ink/55 hover:text-ink/90',
                ].join(' ')}
              >
                {filterLabel(s)}
              </button>
            ))}
          </div>
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
            <li key={row.id}>
              <Link
                to={`/admin/orders/${row.id}`}
                className="block px-[var(--space-5)] py-[var(--space-4)] hover:bg-ink/[0.015] transition-colors focus:outline-none focus-visible:bg-ink/[0.02]"
              >
                <div className="flex items-start gap-[var(--space-4)]">
                  <span className="font-mono text-[10.5px] text-ink/35 tabular-nums shrink-0 pt-1 w-[120px]">
                    {formatTs(row.created_at)}
                  </span>
                  <span className="font-mono text-[11px] text-holo-light/80 tracking-[0.04em] shrink-0 pt-1 w-[170px] truncate">
                    {row.order_number}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-ink truncate">{row.buyer_name}</span>
                    <span className="block text-[11px] text-ink/45 truncate">
                      {row.buyer_contact}
                      {row.buyer_organization && ` · ${row.buyer_organization}`}
                    </span>
                  </span>
                  <span className="font-mono text-[11.5px] text-ink/75 tabular-nums shrink-0 w-[100px] text-right">
                    {formatCents(row.invoice_amount_cents)}
                  </span>
                  <OrderStatusChip status={row.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}

function filterLabel(s: OrderStatus | 'ALL' | 'OPEN'): string {
  if (s === 'OPEN') return 'Open pipeline';
  if (s === 'ALL') return 'All';
  return s.replace(/_/g, ' ');
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  let cls = '';
  switch (status) {
    case 'pending_invoice': cls = 'border-ink/25 text-ink/80 bg-ink/[0.05]'; break;
    case 'invoice_sent':    cls = 'border-holo/40 text-holo-light/80 bg-holo/[0.08]'; break;
    case 'paid':            cls = 'border-[#2E7D5B]/40 text-[#2E7D5B]/90 bg-[#2E7D5B]/[0.06]'; break;
    case 'fulfilled':       cls = 'border-ink/15 text-ink/55 bg-ink/[0.02]'; break;
    case 'cancelled':       cls = 'border-red-400/40 text-red-300/80 bg-red-400/[0.06]'; break;
    case 'refunded':        cls = 'border-red-400/30 text-red-300/65 bg-red-400/[0.04]'; break;
  }
  return (
    <span className={`shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
