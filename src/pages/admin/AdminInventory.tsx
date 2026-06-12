/**
 * AdminInventory
 *
 * Stock list keyed by SKU. Each row shows current on-hand + last-updated
 * timestamp. The "Adjust" action opens a modal that calls `adjust_stock`
 * RPC and logs a movement to the audit log.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import productsData from '../../data/products.json';
import manifestData from '../../data/biopeptideManifest.json';
import type { Product } from '../../types';
import { AdminLayout } from './AdminLayout';

const products = productsData as unknown as Product[];

interface ManifestRow {
  serial: number;
  abbreviation: string;
  model: string;
  specification: string;
}
const manifest = manifestData as ManifestRow[];

interface StockRow {
  sku: string;
  on_hand: number;
  reorder_at: number | null;
  last_counted: string | null;
  updated_at: string;
}

type AdjustReason =
  | 'manual_adjustment'
  | 'physical_count'
  | 'restock_received'
  | 'damage_loss';

const REASON_LABELS: Record<AdjustReason, string> = {
  manual_adjustment: 'Manual adjustment',
  physical_count: 'Physical count reconciliation',
  restock_received: 'Restock received',
  damage_loss: 'Damage / loss write-off',
};

const REASON_ORDER: AdjustReason[] = [
  'restock_received',
  'manual_adjustment',
  'physical_count',
  'damage_loss',
];

/** Resolve a friendly display name for a SKU by checking products.json
 *  first, then the biopeptide manifest. Falls back to the raw SKU. */
function displayNameFor(sku: string): string {
  const fromCatalog = products.find((p) => p.sku === sku);
  if (fromCatalog) return fromCatalog.name;

  // Manifest SKUs are synthesized as `VSR-RS-{abbrev no whitespace}`.
  const stripped = sku.replace(/^VSR-RS-/, '');
  const m = manifest.find(
    (row) => row.abbreviation.replace(/\s+/g, '') === stripped,
  );
  if (m) return `${m.model} — ${m.specification}`;

  return sku;
}

export function AdminInventory() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adjustingSku, setAdjustingSku] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('product_stock')
        .select('sku, on_hand, reorder_at, last_counted, updated_at')
        .order('sku', { ascending: true });
      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        setRows(data as StockRow[]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshCounter]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = displayNameFor(r.sku).toLowerCase();
      return r.sku.toLowerCase().includes(q) || name.includes(q);
    });
  }, [rows, query]);

  const adjusting = rows?.find((r) => r.sku === adjustingSku) ?? null;

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          Inventory
        </p>
        <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap">
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-white">
            <span className="font-light text-white/85">Stock </span>
            <span className="font-medium text-white">on hand.</span>
          </h2>
          <input
            type="search"
            placeholder="Filter by SKU or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-[280px] px-[var(--space-4)] py-[var(--space-2)] bg-black border border-white/10 rounded-sm text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">
          {error}
        </p>
      )}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="holo-text-body text-[13px] leading-relaxed mb-[var(--space-3)]">
            No stock rows yet. Run the seed from the Dashboard to create a
            row at 0 for every catalog SKU, then adjust from here.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="research-surface-solid overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.10]">
                <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[180px]">
                  SKU
                </th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal">
                  Product
                </th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[100px]">
                  On hand
                </th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[160px]">
                  Updated
                </th>
                <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[110px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.sku} className="border-b border-white/[0.04] hover:bg-white/[0.015] transition-colors">
                  <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] align-middle font-mono text-[11.5px] text-holo-light/80">
                    {row.sku}
                  </td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-[12.5px] text-white/80">
                    {displayNameFor(row.sku)}
                  </td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[12px] tabular-nums">
                    <span className={row.on_hand === 0 ? 'text-red-300/85' : 'text-white'}>
                      {row.on_hand}
                    </span>
                  </td>
                  <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle font-mono text-[10.5px] text-white/45 tabular-nums">
                    {formatTs(row.updated_at)}
                  </td>
                  <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] align-middle text-right">
                    <button
                      type="button"
                      onClick={() => setAdjustingSku(row.sku)}
                      className="rounded-full border border-white/15 bg-white/[0.04] px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] text-white/80 hover:text-holo-light hover:border-holo/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
                    >
                      Adjust
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-[var(--space-6)] text-center text-[12px] text-white/40">
                    No matches for "{query}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {adjusting && (
        <AdjustStockModal
          row={adjusting}
          onClose={() => setAdjustingSku(null)}
          onSuccess={() => {
            setAdjustingSku(null);
            setRefreshCounter((c) => c + 1);
          }}
        />
      )}
    </AdminLayout>
  );
}

interface AdjustStockModalProps {
  row: StockRow;
  onClose: () => void;
  onSuccess: () => void;
}

function AdjustStockModal({ row, onClose, onSuccess }: AdjustStockModalProps) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<AdjustReason>('restock_received');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deltaNum = Number(delta);
  const valid = Number.isFinite(deltaNum) && deltaNum !== 0;
  const projected = valid ? row.on_hand + deltaNum : row.on_hand;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting || !supabase) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.rpc('adjust_stock', {
      p_sku: row.sku,
      p_delta: deltaNum,
      p_reason: reason,
      p_notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSuccess();
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px]"
      />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <form
          onSubmit={handleSubmit}
          className="pointer-events-auto w-full max-w-[440px] research-surface-solid p-[var(--space-6)]"
        >
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
            Adjust stock
          </p>
          <h3 className="text-[clamp(1.1rem,2vw,1.3rem)] text-white font-light tracking-tight mb-[var(--space-1)]">
            {displayNameFor(row.sku)}
          </h3>
          <p className="font-mono text-[10.5px] text-holo-light/70 tracking-[0.04em] mb-[var(--space-5)]">
            {row.sku}
          </p>

          <div className="flex items-baseline justify-between border-y border-white/[0.06] py-[var(--space-3)] mb-[var(--space-5)]">
            <span className="text-[11px] uppercase tracking-[0.22em] text-white/45">Current</span>
            <span className="font-mono text-[15px] tabular-nums text-white">{row.on_hand}</span>
          </div>

          <label htmlFor="adj-delta" className="block text-[11px] uppercase tracking-[0.22em] text-white/50 mb-[var(--space-2)]">
            Delta (+ adds, − removes)
          </label>
          <input
            id="adj-delta"
            type="number"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 50 or -3"
            className="w-full px-[var(--space-4)] py-[var(--space-3)] bg-black border border-white/10 rounded-sm text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40 transition-colors mb-[var(--space-3)]"
          />
          {valid && (
            <p className="text-[11px] text-white/55 mb-[var(--space-5)]">
              Projected on-hand: <span className="font-mono tabular-nums text-white">{projected}</span>
            </p>
          )}

          <label htmlFor="adj-reason" className="block text-[11px] uppercase tracking-[0.22em] text-white/50 mb-[var(--space-2)]">
            Reason
          </label>
          <select
            id="adj-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as AdjustReason)}
            className="w-full px-[var(--space-4)] py-[var(--space-3)] bg-black border border-white/10 rounded-sm text-sm text-white focus:outline-none focus:border-white/40 transition-colors mb-[var(--space-5)]"
          >
            {REASON_ORDER.map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>

          <label htmlFor="adj-notes" className="block text-[11px] uppercase tracking-[0.22em] text-white/50 mb-[var(--space-2)]">
            Notes (optional)
          </label>
          <textarea
            id="adj-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Lot number, supplier, etc."
            className="w-full px-[var(--space-4)] py-[var(--space-3)] bg-black border border-white/10 rounded-sm text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40 transition-colors resize-y"
          />

          {error && (
            <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">
              {error}
            </p>
          )}

          <div className="mt-[var(--space-6)] flex items-center justify-end gap-[var(--space-3)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-white/70 hover:text-white hover:border-white/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || submitting}
              className="rounded-full bg-white/[0.10] border border-white/30 px-[var(--space-6)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-white hover:bg-white/[0.15] hover:border-white/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}
