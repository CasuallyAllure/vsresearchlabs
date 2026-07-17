/**
 * AdminStockHistory
 *
 * Append-only audit log readout. Newest first. Filter by SKU.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';

interface MovementRow {
  id: string;
  sku: string;
  delta: number;
  reason:
    | 'initial_seed'
    | 'manual_adjustment'
    | 'physical_count'
    | 'restock_received'
    | 'damage_loss'
    | 'order_fulfilled'
    | 'order_cancelled_after_fulfill';
  notes: string | null;
  order_id: string | null;
  admin_id: string | null;
  on_hand_after: number;
  created_at: string;
}

const REASON_LABEL: Record<MovementRow['reason'], string> = {
  initial_seed: 'Seed',
  manual_adjustment: 'Manual',
  physical_count: 'Count',
  restock_received: 'Restock',
  damage_loss: 'Loss',
  order_fulfilled: 'Fulfilled',
  order_cancelled_after_fulfill: 'Cancel·Restock',
};

export function AdminStockHistory() {
  const [rows, setRows] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skuFilter, setSkuFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('stock_movements')
        .select('id, sku, delta, reason, notes, order_id, admin_id, on_hand_after, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (skuFilter.trim()) {
        q = q.ilike('sku', `%${skuFilter.trim()}%`);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as MovementRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [skuFilter]);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Stock History</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <input
            type="search"
            placeholder="Filter by SKU"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            className="min-w-0 flex-1 h-10 rounded-full border border-ink/10 bg-base-700 px-[var(--space-4)] text-[12px] text-ink placeholder-ink/30 transition-colors focus:border-ink/30 focus:outline-none"
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
            No stock movements yet. Movements are recorded on every adjust,
            seed, and order fulfillment.
          </p>
        </div>
      )}

      {/* Mobile: one card per movement — same data as the table row. */}
      {rows && rows.length > 0 && (
        <div className="md:hidden flex flex-col gap-[var(--space-3)]">
          {rows.map((row) => (
            <div key={row.id} className="floating-module p-4">
              <div className="flex items-start justify-between gap-[var(--space-3)]">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-holo-light/80">{row.sku}</p>
                  <p className="font-mono text-[10px] tabular-nums text-ink/45 mt-0.5">{formatTs(row.created_at)}</p>
                </div>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-ink/65">{REASON_LABEL[row.reason]}</span>
              </div>
              <div className="mt-[var(--space-3)] flex items-end justify-between gap-[var(--space-3)] border-t border-ink/[0.06] pt-[var(--space-3)]">
                <div className="flex items-center gap-[var(--space-4)]">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-ink/40">Δ</p>
                    <p className={`font-mono tabular-nums text-[13px] ${row.delta < 0 ? 'text-[color:var(--color-status-error)]' : 'text-[color:var(--color-status-success)]'}`}>
                      {row.delta > 0 ? '+' : ''}{row.delta}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-ink/40">After</p>
                    <p className="font-mono tabular-nums text-[13px] text-ink">{row.on_hand_after}</p>
                  </div>
                </div>
                <div className="text-right text-[11.5px] text-ink/60">
                  {row.order_id && (
                    <Link
                      to={`/admin/orders/${row.order_id}`}
                      className="block text-holo-light/80 hover:text-holo-light underline underline-offset-4 decoration-holo/20"
                    >
                      Order ↗
                    </Link>
                  )}
                  {row.notes && <p className="mt-0.5 text-ink/45">{row.notes}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="hidden md:block research-surface-solid overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-ink/[0.08]">
                <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[150px]">When</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[180px]">SKU</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[80px]">Δ</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[80px]">After</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal w-[140px]">Reason</th>
                <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-left text-[10px] uppercase tracking-[0.14em] text-ink/45 font-normal">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink/[0.04] hover:bg-ink/[0.02] transition-colors">
                  <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] font-mono text-[10.5px] tabular-nums text-ink/45">{formatTs(row.created_at)}</td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] font-mono text-[11px] text-holo-light/80">{row.sku}</td>
                  <td className={`py-[var(--space-3)] px-[var(--space-3)] text-right font-mono tabular-nums text-[12px] ${row.delta < 0 ? 'text-[color:var(--color-status-error)]' : 'text-[color:var(--color-status-success)]'}`}>
                    {row.delta > 0 ? '+' : ''}{row.delta}
                  </td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] text-right font-mono tabular-nums text-[12px] text-ink">{row.on_hand_after}</td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] text-[11px] uppercase tracking-[0.18em] text-ink/65">
                    {REASON_LABEL[row.reason]}
                  </td>
                  <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-[12px] text-ink/60">
                    {row.order_id && (
                      <Link
                        to={`/admin/orders/${row.order_id}`}
                        className="text-holo-light/80 hover:text-holo-light underline underline-offset-4 decoration-holo/20"
                      >
                        Order ↗
                      </Link>
                    )}
                    {row.notes && (
                      <span className="ml-2 text-ink/45">{row.notes}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}
