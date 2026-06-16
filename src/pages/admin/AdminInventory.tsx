/**
 * AdminInventory
 *
 * Per-SKU control center. Each row exposes the full set of overrides
 * an admin can apply at runtime without a redeploy:
 *
 *   • on_hand              — Adjust stock (+/-, reasons, audit log)
 *   • price_cents_override — Set or clear a runtime price override
 *   • hidden               — Toggle visibility in the public catalog
 *   • deleted_at           — Soft-delete (hides + marks deleted_at);
 *                            restorable from the same surface
 *
 * Every mutation routes through a SECURITY DEFINER RPC and writes one
 * audit_log row. The frontend catalog reads the override view, so
 * changes propagate the next time the public app re-fetches the
 * overrides store (boot, or on demand).
 *
 * This is also the single home for catalog management — the old separate
 * "Catalog" tab is folded in here. The toolbar carries the catalog-level
 * actions (new product, JSON import/export, reset to seed) plus the
 * one-click stock seed that hydrates product_stock from the catalog +
 * biopeptide manifest. Per-row "Edit" jumps to the product editor for any
 * SKU that maps to a catalog product.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import productsData from '../../data/products.json';
import manifestData from '../../data/biopeptideManifest.json';
import type { Product } from '../../types';
import { useProducts, useProductAdmin } from '../../hooks/useProducts';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';

const products = productsData as unknown as Product[];

const DEFAULT_SEED_QTY = 0;

/** Lightweight runtime guard for a JSON catalog import — enough to refuse
 *  obviously bad payloads without full schema validation. */
function isProductLike(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.category === 'string' &&
    typeof v.sku === 'string'
  );
}

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
  hidden: boolean;
  price_cents_override: number | null;
  deleted_at: string | null;
  video_url: string | null;
  video_title: string | null;
  video_description: string | null;
  video_thumbnail: string | null;
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

function displayNameFor(sku: string): string {
  const fromCatalog = products.find((p) => p.sku === sku);
  if (fromCatalog) return fromCatalog.name;
  const stripped = sku.replace(/^VSR-RS-/, '');
  const m = manifest.find(
    (row) => row.abbreviation.replace(/\s+/g, '') === stripped,
  );
  if (m) return `${m.model} — ${m.specification}`;
  return sku;
}

type StatusFilter = 'visible' | 'hidden' | 'deleted' | 'all';

export function AdminInventory() {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('visible');
  const [adjustingSku, setAdjustingSku] = useState<string | null>(null);
  const [pricingSku, setPricingSku] = useState<string | null>(null);
  const [clippingSku, setClippingSku] = useState<string | null>(null);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Catalog-level state (folded in from the old Catalog tab).
  const { products: catalogProducts } = useProducts();
  const { setAll, resetToSeed } = useProductAdmin();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<
    { kind: 'idle' } | { kind: 'ok'; text: string } | { kind: 'err'; text: string }
  >({ kind: 'idle' });
  const [seedState, setSeedState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; processed: number; total: number }
    | { kind: 'done'; inserted: number; skipped: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // SKU → catalog product id, so a row can deep-link to the metadata editor.
  const idBySku = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalogProducts) if (p.sku) m.set(p.sku, p.id);
    return m;
  }, [catalogProducts]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('product_stock')
        .select('sku, on_hand, reorder_at, last_counted, updated_at, hidden, price_cents_override, deleted_at, video_url, video_title, video_description, video_thumbnail')
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
    return rows.filter((r) => {
      // Status filter
      if (statusFilter === 'visible' && (r.hidden || r.deleted_at)) return false;
      if (statusFilter === 'hidden' && (!r.hidden || r.deleted_at)) return false;
      if (statusFilter === 'deleted' && !r.deleted_at) return false;
      // Text filter
      if (q) {
        const name = displayNameFor(r.sku).toLowerCase();
        if (!r.sku.toLowerCase().includes(q) && !name.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, statusFilter]);

  const adjusting = rows?.find((r) => r.sku === adjustingSku) ?? null;
  const pricing = rows?.find((r) => r.sku === pricingSku) ?? null;
  const clipping = rows?.find((r) => r.sku === clippingSku) ?? null;

  async function toggleHidden(row: StockRow) {
    if (!supabase) return;
    setBusySku(row.sku);
    const { error } = await supabase.rpc('set_product_hidden', {
      p_sku: row.sku,
      p_hidden: !row.hidden,
    });
    setBusySku(null);
    if (error) {
      alert(`Failed: ${error.message}`);
      return;
    }
    setRefreshCounter((c) => c + 1);
  }

  async function deleteOrRestore(row: StockRow) {
    if (!supabase) return;
    const isDeleted = !!row.deleted_at;
    if (!isDeleted && !window.confirm(`Soft-delete ${row.sku}? It can be restored. Stock data is preserved.`)) {
      return;
    }
    setBusySku(row.sku);
    const { error } = await supabase.rpc(
      isDeleted ? 'restore_product' : 'mark_product_deleted',
      { p_sku: row.sku },
    );
    setBusySku(null);
    if (error) {
      alert(`Failed: ${error.message}`);
      return;
    }
    setRefreshCounter((c) => c + 1);
  }

  // ── Catalog tools (folded in from the old Catalog tab) ────────────────────

  function collectSeedSkus(): string[] {
    const set = new Set<string>();
    for (const p of products) if (p.sku) set.add(p.sku);
    for (const row of manifest) {
      set.add(`VSR-RS-${row.abbreviation.replace(/\s+/g, '')}`);
    }
    return Array.from(set);
  }

  async function handleSeed() {
    if (!supabase) return;
    const skus = collectSeedSkus();
    setSeedState({ kind: 'running', processed: 0, total: skus.length });
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      const { data, error } = await supabase.rpc('seed_stock_row', {
        p_sku: sku,
        p_initial: DEFAULT_SEED_QTY,
      });
      if (error) {
        setSeedState({ kind: 'error', message: `${sku}: ${error.message}` });
        return;
      }
      if (data === true) inserted += 1;
      else skipped += 1;
      setSeedState({ kind: 'running', processed: i + 1, total: skus.length });
    }
    setSeedState({ kind: 'done', inserted, skipped });
    setRefreshCounter((c) => c + 1);
  }

  function handleExport() {
    const json = JSON.stringify(catalogProducts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vsresearchlabs-catalog-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setCatalogMsg({ kind: 'err', text: 'Failed to read file.' });
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        if (!Array.isArray(parsed) || !parsed.every(isProductLike)) {
          setCatalogMsg({ kind: 'err', text: 'Import must be a JSON array of products with id, name, category, sku.' });
          return;
        }
        if (!window.confirm(`Import ${parsed.length} product(s)? This replaces the current catalog definitions.`)) return;
        setAll(parsed as Product[]);
        setCatalogMsg({ kind: 'ok', text: `Imported ${parsed.length} product${parsed.length === 1 ? '' : 's'}.` });
      } catch (err) {
        setCatalogMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Invalid JSON.' });
      }
    };
    reader.readAsText(file);
  }

  function handleReset() {
    if (!window.confirm('Discard all local catalog edits and reload the shipped seed? Live stock in Supabase is untouched.')) return;
    resetToSeed();
    setCatalogMsg({ kind: 'ok', text: 'Catalog reset to shipped seed.' });
  }

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)] flex flex-col gap-[var(--space-4)]">
        <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
          <div>
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
              Catalog · Inventory
            </p>
            <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-ink">
              <span className="font-light text-ink/85">Stock, pricing &amp; </span>
              <span className="font-medium text-ink">listing control.</span>
            </h2>
          </div>

          {/* Catalog tools — folded in from the old Catalog tab */}
          <div className="flex flex-col items-end gap-[var(--space-2)]">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Link
                to="/admin/new"
                className="rounded-full border border-ink/20 bg-ink/[0.04] px-[var(--space-4)] py-[5px] text-[9.5px] uppercase tracking-[0.18em] text-ink/80 transition-colors hover:border-ink/35 hover:text-ink"
              >
                + New product
              </Link>
              <ToolButton onClick={handleSeed} disabled={seedState.kind === 'running'}>
                {seedState.kind === 'running' ? `Seeding ${seedState.processed}/${seedState.total}…` : 'Seed stock'}
              </ToolButton>
              <ToolButton onClick={() => fileInputRef.current?.click()}>Import JSON</ToolButton>
              <ToolButton onClick={handleExport}>Export JSON</ToolButton>
              <ToolButton onClick={handleReset} danger>Reset to seed</ToolButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
                aria-hidden="true"
              />
            </div>
            {seedState.kind === 'done' && (
              <p className="text-[10px] font-mono tabular-nums text-ink/50">
                Seed: inserted {seedState.inserted} · skipped {seedState.skipped}
              </p>
            )}
            {seedState.kind === 'error' && (
              <p role="alert" className="text-[10px] text-red-400">{seedState.message}</p>
            )}
            {catalogMsg.kind === 'ok' && (
              <p className="text-[10px] uppercase tracking-[0.16em] text-[#2E7D5B]">{catalogMsg.text}</p>
            )}
            {catalogMsg.kind === 'err' && (
              <p role="alert" className="text-[10px] text-red-400">{catalogMsg.text}</p>
            )}
          </div>
        </div>
        <AdminFilterBar
          options={[
            { value: 'visible', label: 'Visible' },
            { value: 'hidden', label: 'Hidden' },
            { value: 'deleted', label: 'Deleted' },
            { value: 'all', label: 'All' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          trailing={
            <input
              type="search"
              placeholder="SKU or name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full sm:w-[220px] px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/30 transition-colors"
            />
          }
        />
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

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
          <table className="w-full min-w-[1000px] border-collapse">
            <thead>
              <tr className="border-b border-ink/[0.10]">
                <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[170px]">SKU</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Product</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[80px]">On hand</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[100px]">Price</th>
                <th className="py-[var(--space-3)] px-[var(--space-3)] text-center text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[100px]">Status</th>
                <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[380px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = row.deleted_at ? 'deleted' : row.hidden ? 'hidden' : 'active';
                const busy = busySku === row.sku;
                return (
                  <tr key={row.sku} className="border-b border-ink/[0.04] hover:bg-ink/[0.015] transition-colors">
                    <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] align-middle font-mono text-[11.5px] text-holo-light/80">
                      {row.sku}
                    </td>
                    <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-[12.5px] text-ink/80">
                      <span className="inline-flex items-center gap-1.5">
                        {displayNameFor(row.sku)}
                        {row.video_url && (
                          <span
                            title="Cited clip attached"
                            className="inline-flex items-center justify-center h-[15px] px-1 rounded-[3px] bg-holo/10 border border-holo/30 font-mono text-[8px] uppercase tracking-[0.1em] text-holo"
                          >
                            ▶ clip
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[12px] tabular-nums">
                      <span className={row.on_hand === 0 ? 'text-red-400/85' : 'text-ink'}>{row.on_hand}</span>
                    </td>
                    <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[11.5px] tabular-nums">
                      {row.price_cents_override !== null ? (
                        <span className="text-ink">${(row.price_cents_override / 100).toFixed(2)}</span>
                      ) : (
                        <span className="text-ink/35">base</span>
                      )}
                    </td>
                    <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-center">
                      <StatusChip status={status} />
                    </td>
                    <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        {idBySku.has(row.sku) && (
                          <Link
                            to={`/admin/${idBySku.get(row.sku)}/edit`}
                            title="Edit product details"
                            className="rounded-full border border-ink/15 bg-ink/[0.03] px-2 py-[3px] text-[9.5px] uppercase tracking-[0.16em] text-ink/75 transition-colors hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                          >
                            Edit
                          </Link>
                        )}
                        <ActionButton onClick={() => setAdjustingSku(row.sku)} disabled={busy || status === 'deleted'} title="Adjust stock">
                          Stock
                        </ActionButton>
                        <ActionButton onClick={() => setPricingSku(row.sku)} disabled={busy} title="Set price override">
                          Price
                        </ActionButton>
                        <ActionButton onClick={() => setClippingSku(row.sku)} disabled={busy} title="Attach a cited clip">
                          Clip
                        </ActionButton>
                        <ActionButton onClick={() => toggleHidden(row)} disabled={busy || status === 'deleted'} title={row.hidden ? 'Show in catalog' : 'Hide from catalog'}>
                          {row.hidden ? 'Show' : 'Hide'}
                        </ActionButton>
                        <ActionButton onClick={() => deleteOrRestore(row)} disabled={busy} danger={!row.deleted_at} title={row.deleted_at ? 'Restore' : 'Delete'}>
                          {row.deleted_at ? 'Restore' : 'Delete'}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-[var(--space-6)] text-center text-[12px] text-ink/40">
                    No matches.
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
          onSuccess={() => { setAdjustingSku(null); setRefreshCounter((c) => c + 1); }}
        />
      )}

      {pricing && (
        <PriceOverrideModal
          row={pricing}
          onClose={() => setPricingSku(null)}
          onSuccess={() => { setPricingSku(null); setRefreshCounter((c) => c + 1); }}
        />
      )}

      {clipping && (
        <ClipModal
          row={clipping}
          label={displayNameFor(clipping.sku)}
          onClose={() => setClippingSku(null)}
          onSuccess={() => { setClippingSku(null); setRefreshCounter((c) => c + 1); }}
        />
      )}
    </AdminLayout>
  );
}

// ── Small components ────────────────────────────────────────────────────────

function StatusChip({ status }: { status: 'active' | 'hidden' | 'deleted' }) {
  const cls =
    status === 'active'   ? 'border-[#2E7D5B]/40 text-[#2E7D5B] bg-[#2E7D5B]/[0.08]' :
    status === 'hidden'   ? 'border-ink/25 text-ink/65 bg-ink/[0.05]' :
                            'border-red-400/40 text-red-400/85 bg-red-400/[0.06]';
  return (
    <span className={`inline-block text-[9.5px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border ${cls}`}>
      {status}
    </span>
  );
}

function ToolButton({
  children, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-full border px-[var(--space-4)] py-[5px] text-[9.5px] uppercase tracking-[0.18em] transition-colors',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        danger
          ? 'border-red-400/30 text-red-400/80 hover:border-red-400/55 hover:text-red-300'
          : 'border-ink/15 text-ink/75 hover:border-ink/30 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ActionButton({
  children, onClick, disabled, danger, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'rounded-full border px-2 py-[3px] text-[9.5px] uppercase tracking-[0.16em] transition-colors',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
        'disabled:opacity-30 disabled:cursor-not-allowed',
        danger
          ? 'border-red-400/35 text-red-400/80 hover:bg-red-400/[0.06] hover:border-red-400/55'
          : 'border-ink/15 text-ink/75 bg-ink/[0.03] hover:text-ink hover:border-ink/30',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── Adjust stock modal (unchanged behaviour) ────────────────────────────────

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
    if (error) return setError(error.message);
    onSuccess();
  }

  return (
    <ModalShell onClose={onClose} title="Adjust stock" subtitle={row.sku}>
      <form onSubmit={handleSubmit}>
        <div className="flex items-baseline justify-between border-y border-ink/[0.08] py-[var(--space-3)] mb-[var(--space-5)]">
          <span className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Current</span>
          <span className="font-mono text-[15px] tabular-nums text-ink">{row.on_hand}</span>
        </div>
        <Label>Delta (+ adds, − removes)</Label>
        <input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 50 or -3" className={inputCls} />
        {valid && (
          <p className="text-[11px] text-ink/55 mt-1 mb-[var(--space-3)]">
            Projected: <span className="font-mono tabular-nums text-ink">{projected}</span>
          </p>
        )}
        <Label>Reason</Label>
        <select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)} className={inputCls}>
          {REASON_ORDER.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
        </select>
        <Label>Notes (optional)</Label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lot number, supplier, etc." className={`${inputCls} resize-y`} />
        {error && <p role="alert" className="mt-[var(--space-2)] text-[12px] text-red-400">{error}</p>}
        <ModalActions onClose={onClose} submitLabel={submitting ? 'Applying…' : 'Apply'} disabled={!valid || submitting} />
      </form>
    </ModalShell>
  );
}

// ── Price override modal ────────────────────────────────────────────────────

interface PriceModalProps {
  row: StockRow;
  onClose: () => void;
  onSuccess: () => void;
}

function PriceOverrideModal({ row, onClose, onSuccess }: PriceModalProps) {
  const initial = row.price_cents_override !== null ? (row.price_cents_override / 100).toFixed(2) : '';
  const [usd, setUsd] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = usd.trim() === '' ? null : Math.round(parseFloat(usd) * 100);
  const valid = usd.trim() === '' || (Number.isFinite(cents) && cents! >= 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting || !supabase) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.rpc('set_product_price', {
      p_sku: row.sku,
      p_cents: cents,
    });
    setSubmitting(false);
    if (error) return setError(error.message);
    onSuccess();
  }

  return (
    <ModalShell onClose={onClose} title="Price override" subtitle={row.sku}>
      <form onSubmit={handleSubmit}>
        <Label>Price (USD)</Label>
        <input
          type="number" step="0.01" min="0"
          value={usd}
          onChange={(e) => setUsd(e.target.value)}
          placeholder="Leave blank to clear and revert to base price"
          className={inputCls}
        />
        <p className="text-[11px] text-ink/55 mt-1">
          {row.price_cents_override !== null
            ? `Current override: $${(row.price_cents_override / 100).toFixed(2)}. Clear to revert.`
            : 'No override active — currently using the base computed price.'}
        </p>
        {error && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{error}</p>}
        <ModalActions onClose={onClose} submitLabel={submitting ? 'Saving…' : 'Save'} disabled={!valid || submitting} />
      </form>
    </ModalShell>
  );
}

// ── Cited-clip modal ────────────────────────────────────────────────────────

interface ClipModalProps {
  row: StockRow;
  label: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ClipModal({ row, label, onClose, onSuccess }: ClipModalProps) {
  const [url, setUrl] = useState(row.video_url ?? '');
  const [title, setTitle] = useState(row.video_title ?? '');
  const [description, setDescription] = useState(row.video_description ?? '');
  const [thumbnail, setThumbnail] = useState(row.video_thumbnail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const hasUrl = url.trim() !== '';

  // Pull author / caption / thumbnail from TikTok via the resolve-video function.
  async function fetchDetails() {
    if (!supabase || !hasUrl) return;
    setFetching(true);
    setError(null);
    setNote(null);
    const { data, error } = await supabase.functions.invoke('resolve-video', {
      body: { url: url.trim(), sku: row.sku },
    });
    setFetching(false);
    if (error) {
      setError(`Couldn't fetch: ${error.message}`);
      return;
    }
    const d = data as {
      url?: string;
      author?: string | null;
      title?: string | null;
      thumbnailUrl?: string | null;
      thumbnailExpires?: boolean;
    };
    if (d.url) setUrl(d.url); // canonical (expands short links)
    // Compose a clean title: caption is often long → keep it as the description,
    // and seed a short title from the author if the title field is still empty.
    if (d.title && !description.trim()) setDescription(d.title);
    if (d.author && !title.trim()) setTitle(`${d.author} — cited clip`);
    // Always adopt a freshly-hosted (permanent) thumbnail; only keep a manual
    // one if the fetch couldn't host a stable copy.
    if (d.thumbnailUrl && (!d.thumbnailExpires || !thumbnail.trim())) setThumbnail(d.thumbnailUrl);
    setNote(
      d.thumbnailExpires
        ? "Fetched. Couldn't host the thumbnail this time — for a permanent poster, paste a stable image URL (e.g. /media/<slug>.jpg)."
        : 'Fetched — thumbnail hosted permanently. Just Save.',
    );
  }

  async function save(clear = false) {
    if (!supabase || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.rpc('set_product_video', {
      p_sku: row.sku,
      p_url: clear ? '' : url.trim(),
      p_title: clear ? '' : title.trim(),
      p_description: clear ? '' : description.trim(),
      p_thumbnail: clear ? '' : thumbnail.trim(),
    });
    setSubmitting(false);
    if (error) return setError(error.message);
    onSuccess();
  }

  return (
    <ModalShell onClose={onClose} title="Cited clip" subtitle={`${row.sku} · ${label}`}>
      <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <Label>Video URL (TikTok)</Label>
        <div className="flex gap-2 mb-[var(--space-3)]">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.tiktok.com/@creator/video/…  or a /t/ short link"
            className={`${inputCls} mb-0`}
          />
          <button
            type="button"
            onClick={fetchDetails}
            disabled={!hasUrl || fetching}
            className="shrink-0 rounded-sm border border-holo/40 bg-holo/[0.06] px-[var(--space-4)] text-[10px] uppercase tracking-[0.16em] text-holo hover:bg-holo/[0.12] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {fetching ? '…' : 'Fetch'}
          </button>
        </div>

        <div className="flex gap-3">
          {/* Live poster preview */}
          <div
            className="shrink-0 w-[64px] aspect-[9/16] overflow-hidden rounded-[6px] border border-ink/15"
            style={{ background: 'linear-gradient(150deg, #2b2622, #0f0d0b)' }}
          >
            {thumbnail.trim() && (
              <img src={thumbnail} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <Label>Title</Label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. MOTS-C, explained by a Ph.D."
              className={inputCls}
            />
            <Label>Thumbnail URL</Label>
            <input
              type="url"
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
              placeholder="/media/<slug>.jpg (hosted, permanent)"
              className={inputCls}
            />
          </div>
        </div>

        <Label>Description</Label>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="1–2 lines on what the clip covers. Note it's an independent third-party clip, shared for reference."
          className={`${inputCls} resize-y`}
        />

        {note && <p className="text-[11px] leading-relaxed text-holo/90 mb-[var(--space-2)]">{note}</p>}
        {error && <p role="alert" className="text-[12px] text-red-400 mb-[var(--space-2)]">{error}</p>}

        <div className="mt-[var(--space-5)] flex items-center justify-between gap-[var(--space-3)]">
          <button
            type="button"
            onClick={() => save(true)}
            disabled={submitting || !row.video_url}
            className="rounded-full border border-red-400/35 px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] text-red-400/80 hover:bg-red-400/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Remove clip
          </button>
          <div className="flex items-center gap-[var(--space-3)]">
            <button type="button" onClick={onClose} className="rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:text-ink hover:border-ink/30 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !hasUrl} className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-6)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {submitting ? 'Saving…' : 'Save clip'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Shared modal primitives ─────────────────────────────────────────────────

const inputCls =
  'w-full mb-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] bg-base-700 border border-ink/10 rounded-sm text-sm text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40 transition-colors';

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]">{children}</label>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[440px] research-surface-solid p-[var(--space-6)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-1)]">{title}</p>
          <p className="font-mono text-[11px] text-holo-light/70 tracking-[0.04em] mb-[var(--space-5)]">{subtitle}</p>
          {children}
        </div>
      </div>
    </>
  );
}

function ModalActions({ onClose, submitLabel, disabled }: { onClose: () => void; submitLabel: string; disabled: boolean }) {
  return (
    <div className="mt-[var(--space-6)] flex items-center justify-end gap-[var(--space-3)]">
      <button type="button" onClick={onClose} className="rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:text-ink hover:border-ink/30 transition-colors">
        Cancel
      </button>
      <button type="submit" disabled={disabled} className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-6)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {submitLabel}
      </button>
    </div>
  );
}
