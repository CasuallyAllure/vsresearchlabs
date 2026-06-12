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
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          Stock History
        </p>
        <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap">
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-white">
            <span className="font-light text-white/85">Movement </span>
            <span className="font-medium text-white">audit.</span>
          </h2>
          <input
            type="search"
            placeholder="Filter by SKU"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            className="w-full sm:w-[240px] px-[var(--space-4)] py-[var(--space-2)] bg-black border border-white/10 rounded-sm text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-white/55">
            No stock movements yet. Movements are recorded on every adjust,
            seed, and order fulfillment.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="research-surface-solid overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[150px]">When</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[180px]">SKU</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[80px]">Δ</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[80px]">After</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[140px]">Reason</th>
                <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-white/[0.04] hover:bg-white/[0.015] transition-colors">
                  <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] font-mono text-[10.5px] tabular-nums text-white/45">{formatTs(row.created_at)}</td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] font-mono text-[11px] text-holo-light/80">{row.sku}</td>
                  <td className={`py-[var(--space-3)] px-[var(--space-3)] text-right font-mono tabular-nums text-[12px] ${row.delta < 0 ? 'text-red-300/90' : 'text-[#7CD992]/90'}`}>
                    {row.delta > 0 ? '+' : ''}{row.delta}
                  </td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] text-right font-mono tabular-nums text-[12px] text-white">{row.on_hand_after}</td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] text-[11px] uppercase tracking-[0.18em] text-white/65">
                    {REASON_LABEL[row.reason]}
                  </td>
                  <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-[12px] text-white/60">
                    {row.order_id && (
                      <Link
                        to={`/admin/orders/${row.order_id}`}
                        className="text-holo-light/80 hover:text-holo-light underline underline-offset-4 decoration-holo/20"
                      >
                        Order ↗
                      </Link>
                    )}
                    {row.notes && (
                      <span className="ml-2 text-white/45">{row.notes}</span>
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
