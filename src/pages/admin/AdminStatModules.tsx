/**
 * AdminStatModules
 *
 * The dashboard *is* this row of smart modules. Every dataset behind a tile
 * is loaded up front, so each tile carries real figures — count, money in
 * play, the oldest thing waiting — not just a bare number. Tapping a tile
 * floats a panel in front of the page (it never navigates away) pre-filled
 * with the records the tile summarizes, and you drill all the way in right
 * there:
 *
 *   • Open inquiries     → expand a row for its line items + notes, then
 *                          Create order — without leaving the dashboard.
 *   • Awaiting invoice / Paid · awaiting ship / Fulfilled this month →
 *                          expand for buyer, timeline and line items, with
 *                          the safe one-tap status actions inline.
 *   • SKUs in stock      → on-hand per SKU, low-stock surfaced.
 *
 * Tiles and panels read the exact same in-memory data, so they can never
 * disagree. Any inline action re-pulls everything and the figures move.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import productsData from '../../data/products.json';
import manifestData from '../../data/biopeptideManifest.json';
import type { Product } from '../../types';
import { OrderStatusChip } from './AdminOrders';

const products = productsData as unknown as Product[];

interface ManifestRow {
  serial: number;
  abbreviation: string;
  model: string;
  specification: string;
}
const manifest = manifestData as ManifestRow[];

function skuName(sku: string): string {
  const fromCatalog = products.find((p) => p.sku === sku);
  if (fromCatalog) return fromCatalog.name;
  const stripped = sku.replace(/^VSR-RS-/, '');
  const m = manifest.find((row) => row.abbreviation.replace(/\s+/g, '') === stripped);
  return m ? `${m.model} — ${m.specification}` : sku;
}

/* ── Types ────────────────────────────────────────────────────────────────── */

type OrderStatus = 'pending_invoice' | 'invoice_sent' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

interface InquiryRow {
  id: string;
  reference_id: string;
  created_at: string;
  name: string;
  contact: string;
  organization: string | null;
  notes: string | null;
  item_count: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  buyer_name: string;
  buyer_contact: string;
  invoice_amount_cents: number | null;
  delivered_at: string | null;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  fulfilled_at: string | null;
}

interface SkuRow { sku: string; on_hand: number }

interface DashData {
  inquiries: InquiryRow[];
  pending: OrderRow[];
  paid: OrderRow[];
  fulfilled: OrderRow[];
  skus: SkuRow[];
}

type ModuleKey = 'inquiries' | 'pending' | 'paid' | 'fulfilled' | 'skus';

/* ── Loader ───────────────────────────────────────────────────────────────── */

function monthStartISO(): string {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

const ORDER_COLS =
  'id, order_number, status, buyer_name, buyer_contact, invoice_amount_cents, delivered_at, tracking_number, carrier, created_at, fulfilled_at';

export function AdminStatModules() {
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ModuleKey | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Inline async load (keeps setState off the synchronous effect path);
  // re-runs whenever an inline action bumps refreshKey, so the figures move.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); return; }
      try {
        const since = monthStartISO();
        const [inq, pend, paid, ful, skus] = await Promise.all([
          supabase.from('inquiries')
            .select('id, reference_id, created_at, name, contact, organization, notes, item_count')
            .eq('status', 'OPEN').order('created_at', { ascending: false }).limit(200),
          supabase.from('orders').select(ORDER_COLS).eq('status', 'pending_invoice').order('created_at', { ascending: false }).limit(200),
          supabase.from('orders').select(ORDER_COLS).eq('status', 'paid').order('created_at', { ascending: false }).limit(200),
          supabase.from('orders').select(ORDER_COLS).eq('status', 'fulfilled').gte('fulfilled_at', since).order('fulfilled_at', { ascending: false }).limit(200),
          supabase.from('product_stock').select('sku, on_hand').gt('on_hand', 0).order('on_hand', { ascending: false }).limit(1000),
        ]);
        if (cancelled) return;
        const firstErr = inq.error || pend.error || paid.error || ful.error || skus.error;
        if (firstErr) { setError(firstErr.message); return; }
        setData({
          inquiries: (inq.data ?? []) as InquiryRow[],
          pending: (pend.data ?? []) as OrderRow[],
          paid: (paid.data ?? []) as OrderRow[],
          fulfilled: (ful.data ?? []) as OrderRow[],
          skus: (skus.data ?? []) as SkuRow[],
        });
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="Open inquiries"
          value={data?.inquiries.length}
          meta={data ? [`${sum(data.inquiries, (r) => r.item_count)} units`, oldestAge(data.inquiries)] : undefined}
          onOpen={() => setActive('inquiries')}
        />
        <Tile
          label="Awaiting invoice"
          value={data?.pending.length}
          meta={data ? [`${money(sum(data.pending, (r) => r.invoice_amount_cents ?? 0))} to bill`, oldestAge(data.pending)] : undefined}
          onOpen={() => setActive('pending')}
        />
        <Tile
          label="Paid · awaiting ship"
          value={data?.paid.length}
          emphasis
          meta={data ? [`${money(sum(data.paid, (r) => r.invoice_amount_cents ?? 0))} to ship`, oldestAge(data.paid)] : undefined}
          onOpen={() => setActive('paid')}
        />
        <Tile
          label="Fulfilled this month"
          value={data?.fulfilled.length}
          meta={data ? [`${money(sum(data.fulfilled, (r) => r.invoice_amount_cents ?? 0))} shipped`, `${data.fulfilled.filter((r) => r.delivered_at).length} delivered`] : undefined}
          onOpen={() => setActive('fulfilled')}
        />
        <Tile
          label="SKUs in stock"
          value={data?.skus.length}
          meta={data ? [`${sum(data.skus, (r) => r.on_hand)} units`, `${data.skus.filter((r) => r.on_hand <= 5).length} low (≤5)`] : undefined}
          onOpen={() => setActive('skus')}
        />
      </div>

      {active && data && (
        <ModuleModal moduleKey={active} data={data} onReload={reload} onClose={() => setActive(null)} />
      )}
    </>
  );
}

/* ── Tile ─────────────────────────────────────────────────────────────────── */

function Tile({
  label, value, meta, emphasis, onOpen,
}: { label: string; value: number | undefined; meta?: string[]; emphasis?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left research-surface-solid px-[var(--space-4)] py-[var(--space-4)] transition-colors hover:bg-ink/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
    >
      <span className="mb-[var(--space-2)] flex items-center justify-between gap-2">
        <span className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">{label}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className="shrink-0 text-ink/25 transition-colors group-hover:text-ink/55"
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </span>
      <span
        className={
          emphasis
            ? 'holo-text-display block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums'
            : 'block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums text-ink'
        }
      >
        {value === undefined ? '—' : value}
      </span>
      <span className="mt-[var(--space-2)] block min-h-[1.6em] space-y-0.5">
        {meta?.filter(Boolean).map((m, i) => (
          <span key={i} className="block truncate font-mono text-[9.5px] tabular-nums text-ink/45">{m}</span>
        ))}
      </span>
    </button>
  );
}

/* ── Modal shell ──────────────────────────────────────────────────────────── */

const MODULE_TITLES: Record<ModuleKey, string> = {
  inquiries: 'Open inquiries',
  pending: 'Awaiting invoice',
  paid: 'Paid · awaiting ship',
  fulfilled: 'Fulfilled this month',
  skus: 'SKUs in stock',
};

function ModuleModal({
  moduleKey, data, onReload, onClose,
}: { moduleKey: ModuleKey; data: DashData; onReload: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const count =
    moduleKey === 'inquiries' ? data.inquiries.length :
    moduleKey === 'pending' ? data.pending.length :
    moduleKey === 'paid' ? data.paid.length :
    moduleKey === 'fulfilled' ? data.fulfilled.length :
    data.skus.length;

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center p-4 pointer-events-none sm:p-8">
        <div className="pointer-events-auto flex max-h-[84vh] w-full max-w-[720px] flex-col research-surface-solid">
          <header className="flex items-center justify-between gap-[var(--space-4)] border-b border-ink/[0.08] px-[var(--space-6)] py-[var(--space-4)]">
            <div className="flex items-baseline gap-[var(--space-3)]">
              <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em]">{MODULE_TITLES[moduleKey]}</p>
              <span className="font-mono text-[12px] tabular-nums text-ink/45">{count}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full border border-ink/15 px-[var(--space-3)] py-[3px] text-[9px] uppercase tracking-[0.2em] text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
            >
              Close
            </button>
          </header>
          <div className="no-scrollbar flex-1 overflow-y-auto">
            {moduleKey === 'inquiries' && <InquiriesDetail rows={data.inquiries} onClose={onClose} />}
            {moduleKey === 'pending' && <OrdersDetail rows={data.pending} onReload={onReload} onClose={onClose} emptyHint="No orders waiting on an invoice." />}
            {moduleKey === 'paid' && <OrdersDetail rows={data.paid} onReload={onReload} onClose={onClose} emptyHint="Nothing paid and waiting to ship." />}
            {moduleKey === 'fulfilled' && <OrdersDetail rows={data.fulfilled} onReload={onReload} onClose={onClose} emptyHint="No orders shipped yet this month." />}
            {moduleKey === 'skus' && <SkusDetail rows={data.skus} onClose={onClose} />}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Inquiries detail ─────────────────────────────────────────────────────── */

interface InquiryItemRow { id: string; sku: string; product_name: string; quantity: number; item_note: string | null }

function InquiriesDetail({ rows, onClose }: { rows: InquiryRow[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, InquiryItemRow[]>>({});
  const [creating, setCreating] = useState<string | null>(null);

  const toggle = useCallback(async (id: string) => {
    setExpanded((cur) => (cur === id ? null : id));
    if (items[id] || !supabase) return;
    const { data } = await supabase.from('inquiry_items')
      .select('id, sku, product_name, quantity, item_note').eq('inquiry_id', id);
    setItems((prev) => ({ ...prev, [id]: (data ?? []) as InquiryItemRow[] }));
  }, [items]);

  async function createOrder(id: string) {
    if (!supabase) return;
    setCreating(id);
    const { data, error } = await supabase.rpc('create_order_from_inquiry', { p_inquiry_id: id });
    setCreating(null);
    if (error) return alert(`Failed to create order: ${error.message}`);
    if (typeof data === 'string') { onClose(); navigate(`/admin/orders/${data}`); }
  }

  if (rows.length === 0) return <DetailMessage>No open inquiries. All caught up.</DetailMessage>;

  return (
    <div>
      <ul className="divide-y divide-ink/[0.05]">
        {rows.map((row) => {
          const open = expanded === row.id;
          const its = items[row.id] ?? [];
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-4)] text-left transition-colors hover:bg-ink/[0.015]"
              >
                <span className="w-[140px] shrink-0 truncate pt-0.5 font-mono text-[10.5px] tracking-[0.04em] text-holo-light/80">{row.reference_id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{row.name}</span>
                  <span className="block truncate text-[11px] text-ink/45">{row.contact}{row.organization && ` · ${row.organization}`}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-right">
                  <span className="block font-mono text-[11px] tabular-nums text-ink/55">{row.item_count} {row.item_count === 1 ? 'unit' : 'units'}</span>
                  <span className="block font-mono text-[10px] tabular-nums text-ink/30">{ageLabel(row.created_at)}</span>
                </span>
              </button>
              {open && (
                <div className="border-t border-ink/[0.04] bg-ink/[0.012] px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-3)]">
                  {row.notes && (
                    <p className="mb-[var(--space-3)] max-w-[64ch] text-[12px] leading-relaxed text-ink/70">
                      <span className="mr-2 text-[10px] uppercase tracking-[0.22em] text-ink/35">Notes</span>{row.notes}
                    </p>
                  )}
                  {its.length > 0 ? (
                    <table className="w-full border-collapse">
                      <tbody>
                        {its.map((it) => (
                          <tr key={it.id} className="border-b border-ink/[0.04]">
                            <td className="py-[var(--space-2)] pr-3 font-mono text-[11px] text-holo-light/75">{it.sku}</td>
                            <td className="py-[var(--space-2)] pr-3 text-[12px] text-ink/75">
                              {it.product_name}{it.item_note && <span className="ml-2 text-[10.5px] text-ink/40">({it.item_note})</span>}
                            </td>
                            <td className="py-[var(--space-2)] text-right font-mono text-[12px] tabular-nums text-ink/70">{it.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-[11px] text-ink/40">Loading items…</p>}
                  <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
                    <PrimaryAction onClick={() => createOrder(row.id)} disabled={creating === row.id}>
                      {creating === row.id ? 'Creating…' : 'Create order'}
                    </PrimaryAction>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <DetailFooter onClick={() => { onClose(); navigate('/admin/inquiries'); }}>Open full Inquiries tab →</DetailFooter>
    </div>
  );
}

/* ── Orders detail (inline expand + safe quick actions) ───────────────────── */

interface OrderLineRow { id: string; sku: string; product_name: string; quantity: number; unit_price_cents: number | null; item_note: string | null }

function OrdersDetail({
  rows, onReload, onClose, emptyHint,
}: { rows: OrderRow[]; onReload: () => void; onClose: () => void; emptyHint: string }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, OrderLineRow[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = useCallback(async (id: string) => {
    setExpanded((cur) => (cur === id ? null : id));
    if (lines[id] || !supabase) return;
    const { data } = await supabase.from('order_lines')
      .select('id, sku, product_name, quantity, unit_price_cents, item_note').eq('order_id', id);
    setLines((prev) => ({ ...prev, [id]: (data ?? []) as OrderLineRow[] }));
  }, [lines]);

  async function run(id: string, rpc: () => PromiseLike<{ error: { message: string } | null }>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    if (!supabase) return;
    setBusy(id);
    const { error } = await rpc();
    setBusy(null);
    if (error) { alert(error.message); return; }
    onReload();
  }

  if (rows.length === 0) return <DetailMessage>{emptyHint}</DetailMessage>;

  return (
    <div>
      <ul className="divide-y divide-ink/[0.05]">
        {rows.map((row) => {
          const open = expanded === row.id;
          const ls = lines[row.id] ?? [];
          const isBusy = busy === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-4)] text-left transition-colors hover:bg-ink/[0.015]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-[11px] tracking-[0.04em] text-holo-light/80">{row.order_number}</span>
                    <OrderStatusChip status={row.status} deliveredAt={row.delivered_at} />
                  </span>
                  <span className="block truncate text-[13px] text-ink">{row.buyer_name}</span>
                  <span className="block truncate text-[11px] text-ink/45">{row.buyer_contact}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[12px] tabular-nums text-ink/80">{money(row.invoice_amount_cents ?? 0)}</span>
                  <span className="block font-mono text-[10px] tabular-nums text-ink/35">{ageLabel(row.fulfilled_at ?? row.created_at)}</span>
                </span>
              </button>
              {open && (
                <div className="border-t border-ink/[0.04] bg-ink/[0.012] px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-3)]">
                  {ls.length > 0 ? (
                    <table className="w-full border-collapse">
                      <tbody>
                        {ls.map((l) => (
                          <tr key={l.id} className="border-b border-ink/[0.04]">
                            <td className="py-[var(--space-2)] pr-3 font-mono text-[11px] text-holo-light/75">{l.sku}</td>
                            <td className="py-[var(--space-2)] pr-3 text-[12px] text-ink/75">{l.product_name}</td>
                            <td className="py-[var(--space-2)] pr-3 text-right font-mono text-[12px] tabular-nums text-ink/70">{l.quantity}</td>
                            <td className="py-[var(--space-2)] text-right font-mono text-[11.5px] tabular-nums text-ink/45">{money(l.unit_price_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-[11px] text-ink/40">Loading lines…</p>}

                  {row.tracking_number && (
                    <p className="mt-[var(--space-3)] font-mono text-[11px] text-ink/55">
                      Tracking: <span className="text-ink/80">{row.tracking_number}</span>{row.carrier && ` · ${row.carrier}`}
                    </p>
                  )}

                  <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
                    {row.status === 'paid' && (
                      <PrimaryAction
                        onClick={() => run(row.id, () => supabase!.rpc('confirm_order_fulfilled', { p_order_id: row.id, p_tracking_number: null, p_carrier: null }),
                          'Mark shipped? This deducts stock for every line. Add tracking + email the buyer from the full order.')}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Working…' : 'Mark shipped'}
                      </PrimaryAction>
                    )}
                    {row.status === 'fulfilled' && !row.delivered_at && (
                      <PrimaryAction onClick={() => run(row.id, () => supabase!.rpc('mark_order_delivered', { p_order_id: row.id }))} disabled={isBusy}>
                        {isBusy ? 'Working…' : 'Mark delivered'}
                      </PrimaryAction>
                    )}
                    {(row.status === 'pending_invoice' || row.status === 'paid') && (
                      <GhostAction
                        danger
                        onClick={() => run(row.id, () => supabase!.rpc('cancel_order', { p_order_id: row.id, p_reason: (window.prompt('Reason for cancellation (optional):') ?? '').trim() || 'Cancelled by admin' }), 'Cancel this order?')}
                        disabled={isBusy}
                      >
                        Cancel
                      </GhostAction>
                    )}
                    <GhostAction onClick={() => { onClose(); navigate(`/admin/orders/${row.id}`); }}>
                      {row.status === 'pending_invoice' ? 'Open to invoice →' : 'Open full order →'}
                    </GhostAction>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <DetailFooter onClick={() => { onClose(); navigate('/admin/orders'); }}>Open full Orders tab →</DetailFooter>
    </div>
  );
}

/* ── SKUs detail ──────────────────────────────────────────────────────────── */

function SkusDetail({ rows, onClose }: { rows: SkuRow[]; onClose: () => void }) {
  const navigate = useNavigate();
  if (rows.length === 0) return <DetailMessage>No SKUs in stock. Seed and adjust from Inventory.</DetailMessage>;
  return (
    <div>
      <ul className="divide-y divide-ink/[0.05]">
        {rows.map((row) => (
          <li key={row.sku} className="flex items-center gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-3)]">
            <span className="w-[150px] shrink-0 truncate font-mono text-[11px] text-holo-light/80">{row.sku}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink/80">{skuName(row.sku)}</span>
            <span className={`shrink-0 font-mono text-[12px] tabular-nums ${row.on_hand <= 5 ? 'text-red-400/85' : 'text-ink'}`}>{row.on_hand}</span>
          </li>
        ))}
      </ul>
      <DetailFooter onClick={() => { onClose(); navigate('/admin/inventory'); }}>Open Inventory →</DetailFooter>
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

function PrimaryAction({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-ink/30 bg-ink/[0.10] px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink transition-colors hover:border-ink/40 hover:bg-ink/[0.15] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function GhostAction({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-full border px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        danger
          ? 'border-red-400/35 text-red-400/80 hover:border-red-400/55 hover:text-red-300'
          : 'border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function DetailMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-[var(--space-6)] py-[var(--space-8)] text-center text-[12.5px] text-ink/50">{children}</p>;
}

function DetailFooter({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink/[0.08] px-[var(--space-6)] py-[var(--space-4)]">
      <button type="button" onClick={onClick} className="text-[10px] uppercase tracking-[0.22em] text-ink/55 transition-colors hover:text-ink">
        {children}
      </button>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function sum<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + (pick(r) || 0), 0);
}

function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const usd = cents / 100;
  return usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${usd.toFixed(usd % 1 === 0 ? 0 : 2)}`;
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Age of the oldest (last, since sorted desc) row in a list — "oldest Nd". */
function oldestAge(rows: Array<{ created_at: string }>): string {
  if (rows.length === 0) return 'none waiting';
  return `oldest ${ageLabel(rows[rows.length - 1].created_at)}`;
}
