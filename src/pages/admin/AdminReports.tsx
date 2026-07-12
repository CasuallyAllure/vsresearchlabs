/**
 * AdminReports
 *
 * Business reporting + spreadsheet export. Pick a report (orders,
 * inquiries, stock, customers, catalog, …), set a date range, preview the
 * rows, and download a real Excel (.xlsx) or CSV. Reports are config-driven
 * — adding a new one is a single entry in buildReports().
 *
 * Data sources: Supabase tables/views for operational data; the local
 * product store for the catalog. Export engine: src/lib/exporters.ts
 * (dependency-free .xlsx + .csv).
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useProducts } from '../../hooks/useProducts';
import type { Product } from '../../types';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { type Column, downloadXlsx, downloadCsv, stamp } from '../../lib/exporters';
import { Button } from '../../components/ui/Button';

type Row = Record<string, unknown>;

// ── value helpers ────────────────────────────────────────────────────────────
const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const N = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const USD = (cents: unknown): number | null => {
  const n = N(cents);
  return n === null ? null : Math.round(n) / 100;
};
const DT = (v: unknown): string => {
  const s = S(v);
  return s ? s.slice(0, 16).replace('T', ' ') : '';
};

// ── date ranges ──────────────────────────────────────────────────────────────
const RANGES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All time' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'mtd', label: 'This month' },
  { id: 'ytd', label: 'This year' },
];
function rangeSince(id: string): string | null {
  const now = new Date();
  const d = new Date(now);
  switch (id) {
    case '30d': d.setDate(d.getDate() - 30); return d.toISOString();
    case '90d': d.setDate(d.getDate() - 90); return d.toISOString();
    case 'mtd': return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    case 'ytd': return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
    default: return null;
  }
}

// ── supabase fetch helper ────────────────────────────────────────────────────
async function sb(
  table: string,
  select: string,
  opts: { order?: string; dateField?: string; since?: string | null; limit?: number } = {},
): Promise<Row[]> {
  if (!supabase) throw new Error('Backend not configured — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
  let q = supabase.from(table).select(select).limit(opts.limit ?? 5000);
  if (opts.order) q = q.order(opts.order, { ascending: false });
  if (opts.dateField && opts.since) q = q.gte(opts.dateField, opts.since);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

// ── report definitions ───────────────────────────────────────────────────────
interface ReportDef {
  id: string;
  label: string;
  description: string;
  sheet: string;
  hasRange: boolean;
  columns: Column<Row>[];
  fetch: (since: string | null) => Promise<Row[]>;
}

function buildReports(products: Product[]): ReportDef[] {
  return [
    {
      id: 'orders',
      label: 'Orders',
      description: 'Full order pipeline — status, buyer, invoice amount, and lifecycle dates.',
      sheet: 'Orders',
      hasRange: true,
      fetch: (since) =>
        sb('orders',
          'order_number, status, buyer_name, buyer_contact, buyer_organization, invoice_amount_cents, payment_method, tracking_number, created_at, invoiced_at, paid_at, fulfilled_at, notes',
          { order: 'created_at', dateField: 'created_at', since }),
      columns: [
        { header: 'Order #', value: (r) => S(r.order_number) },
        { header: 'Status', value: (r) => S(r.status).replace(/_/g, ' ') },
        { header: 'Buyer', value: (r) => S(r.buyer_name) },
        { header: 'Contact', value: (r) => S(r.buyer_contact) },
        { header: 'Organization', value: (r) => S(r.buyer_organization) },
        { header: 'Invoice (USD)', type: 'currency', value: (r) => USD(r.invoice_amount_cents) },
        { header: 'Payment method', value: (r) => S(r.payment_method) },
        { header: 'Tracking #', value: (r) => S(r.tracking_number) },
        { header: 'Created', value: (r) => DT(r.created_at) },
        { header: 'Invoiced', value: (r) => DT(r.invoiced_at) },
        { header: 'Paid', value: (r) => DT(r.paid_at) },
        { header: 'Fulfilled', value: (r) => DT(r.fulfilled_at) },
        { header: 'Notes', value: (r) => S(r.notes) },
      ],
    },
    {
      id: 'order-lines',
      label: 'Order line items',
      description: 'SKU-level sales lines across all orders — quantities and line totals.',
      sheet: 'Order lines',
      hasRange: true,
      fetch: async (since) => {
        const data = await sb('order_lines',
          'sku, product_name, quantity, unit_price_cents, item_note, orders(order_number, status, buyer_name, created_at)',
          { limit: 10000 });
        return data
          .map((r) => {
            const o = (r.orders ?? {}) as Row;
            const qty = N(r.quantity) ?? 0;
            const unit = N(r.unit_price_cents);
            return {
              order_number: o.order_number, status: o.status, buyer_name: o.buyer_name, created_at: o.created_at,
              sku: r.sku, product_name: r.product_name, quantity: qty,
              unit_price_cents: unit, line_total: unit === null ? null : Math.round(unit * qty) / 100, item_note: r.item_note,
            } as Row;
          })
          .filter((r) => !since || S(r.created_at) >= since)
          .sort((a, b) => S(b.created_at).localeCompare(S(a.created_at)));
      },
      columns: [
        { header: 'Order #', value: (r) => S(r.order_number) },
        { header: 'Status', value: (r) => S(r.status).replace(/_/g, ' ') },
        { header: 'SKU', value: (r) => S(r.sku) },
        { header: 'Product', value: (r) => S(r.product_name) },
        { header: 'Qty', type: 'number', value: (r) => N(r.quantity) },
        { header: 'Unit (USD)', type: 'currency', value: (r) => USD(r.unit_price_cents) },
        { header: 'Line total (USD)', type: 'currency', value: (r) => N(r.line_total) },
        { header: 'Buyer', value: (r) => S(r.buyer_name) },
        { header: 'Created', value: (r) => DT(r.created_at) },
        { header: 'Note', value: (r) => S(r.item_note) },
      ],
    },
    {
      id: 'inquiries',
      label: 'Inquiries',
      description: 'Incoming inquiry leads — contact, organization, status, and item count.',
      sheet: 'Inquiries',
      hasRange: true,
      fetch: (since) =>
        sb('inquiries',
          'reference_id, created_at, name, contact, organization, status, item_count, notes',
          { order: 'created_at', dateField: 'created_at', since }),
      columns: [
        { header: 'Reference', value: (r) => S(r.reference_id) },
        { header: 'Created', value: (r) => DT(r.created_at) },
        { header: 'Name', value: (r) => S(r.name) },
        { header: 'Contact', value: (r) => S(r.contact) },
        { header: 'Organization', value: (r) => S(r.organization) },
        { header: 'Status', value: (r) => S(r.status) },
        { header: 'Items', type: 'number', value: (r) => N(r.item_count) },
        { header: 'Notes', value: (r) => S(r.notes) },
      ],
    },
    {
      id: 'inquiry-items',
      label: 'Inquiry line items',
      description: 'SKU-level demand from inquiries — what people are asking for, and how much.',
      sheet: 'Inquiry items',
      hasRange: true,
      fetch: async (since) => {
        const data = await sb('inquiry_items',
          'sku, product_name, quantity, category, item_note, inquiries(reference_id, created_at, name)',
          { limit: 10000 });
        return data
          .map((r) => {
            const i = (r.inquiries ?? {}) as Row;
            return {
              reference_id: i.reference_id, created_at: i.created_at, name: i.name,
              sku: r.sku, product_name: r.product_name, quantity: N(r.quantity) ?? 0, category: r.category, item_note: r.item_note,
            } as Row;
          })
          .filter((r) => !since || S(r.created_at) >= since)
          .sort((a, b) => S(b.created_at).localeCompare(S(a.created_at)));
      },
      columns: [
        { header: 'Reference', value: (r) => S(r.reference_id) },
        { header: 'Created', value: (r) => DT(r.created_at) },
        { header: 'SKU', value: (r) => S(r.sku) },
        { header: 'Product', value: (r) => S(r.product_name) },
        { header: 'Qty', type: 'number', value: (r) => N(r.quantity) },
        { header: 'Category', value: (r) => S(r.category) },
        { header: 'Requested by', value: (r) => S(r.name) },
        { header: 'Note', value: (r) => S(r.item_note) },
      ],
    },
    {
      id: 'stock',
      label: 'Stock on hand',
      description: 'Current inventory position by SKU, with reorder thresholds.',
      sheet: 'Stock on hand',
      hasRange: false,
      fetch: () => sb('product_stock', 'sku, on_hand, reorder_at, last_counted, updated_at', { order: 'sku' })
        .then((rows) => [...rows].sort((a, b) => S(a.sku).localeCompare(S(b.sku)))),
      columns: [
        { header: 'SKU', value: (r) => S(r.sku) },
        { header: 'On hand', type: 'number', value: (r) => N(r.on_hand) },
        { header: 'Reorder at', type: 'number', value: (r) => N(r.reorder_at) },
        { header: 'Below reorder', value: (r) => { const o = N(r.on_hand), t = N(r.reorder_at); return t !== null && o !== null && o <= t ? 'YES' : ''; } },
        { header: 'Last counted', value: (r) => DT(r.last_counted) },
        { header: 'Updated', value: (r) => DT(r.updated_at) },
      ],
    },
    {
      id: 'stock-movements',
      label: 'Stock movements',
      description: 'Append-only movement log — restocks, fulfillments, counts, and losses.',
      sheet: 'Stock movements',
      hasRange: true,
      fetch: (since) =>
        sb('stock_movements', 'created_at, sku, delta, reason, on_hand_after, notes, order_id',
          { order: 'created_at', dateField: 'created_at', since }),
      columns: [
        { header: 'When', value: (r) => DT(r.created_at) },
        { header: 'SKU', value: (r) => S(r.sku) },
        { header: 'Delta', type: 'number', value: (r) => N(r.delta) },
        { header: 'Reason', value: (r) => S(r.reason).replace(/_/g, ' ') },
        { header: 'On hand after', type: 'number', value: (r) => N(r.on_hand_after) },
        { header: 'Order', value: (r) => S(r.order_id) },
        { header: 'Notes', value: (r) => S(r.notes) },
      ],
    },
    {
      id: 'customers',
      label: 'Customers',
      description: 'Customer directory with lifetime inquiry and order counts.',
      sheet: 'Customers',
      hasRange: false,
      fetch: () =>
        sb('customer_with_history',
          'display_name, contact, organization, phone, status, inquiry_count, order_count, first_seen_at, last_seen_at, last_inquiry_at, last_order_at',
          { order: 'last_seen_at' }),
      columns: [
        { header: 'Name', value: (r) => S(r.display_name) },
        { header: 'Contact', value: (r) => S(r.contact) },
        { header: 'Organization', value: (r) => S(r.organization) },
        { header: 'Phone', value: (r) => S(r.phone) },
        { header: 'Status', value: (r) => S(r.status) },
        { header: 'Inquiries', type: 'number', value: (r) => N(r.inquiry_count) },
        { header: 'Orders', type: 'number', value: (r) => N(r.order_count) },
        { header: 'First seen', value: (r) => DT(r.first_seen_at) },
        { header: 'Last seen', value: (r) => DT(r.last_seen_at) },
        { header: 'Last inquiry', value: (r) => DT(r.last_inquiry_at) },
        { header: 'Last order', value: (r) => DT(r.last_order_at) },
      ],
    },
    {
      id: 'catalog',
      label: 'Product catalog',
      description: 'The full product list — SKUs, classification, doses, pricing, and chemistry.',
      sheet: 'Catalog',
      hasRange: false,
      fetch: async () =>
        products.map((p) => ({
          sku: p.sku, name: p.name, abbreviation: p.abbreviation, family: p.family,
          category: p.category, classification: p.researchClassification, productType: p.productType,
          variants: (p.variants ?? []).map((v) => v.dose).join(' · '),
          variant_count: (p.variants ?? []).length,
          price_cents: p.priceCents, cas: p.casNumber, mw: p.molecularWeight,
          featured: p.featured ? 'YES' : '', tags: (p.tags ?? []).join(', '),
        } as Row)),
      columns: [
        { header: 'SKU', value: (r) => S(r.sku) },
        { header: 'Name', value: (r) => S(r.name) },
        { header: 'Abbr', value: (r) => S(r.abbreviation) },
        { header: 'Family', value: (r) => S(r.family) },
        { header: 'Category', value: (r) => S(r.category) },
        { header: 'Classification', value: (r) => S(r.classification) },
        { header: 'Type', value: (r) => S(r.productType) },
        { header: 'Doses', value: (r) => S(r.variants) },
        { header: 'Dose count', type: 'number', value: (r) => N(r.variant_count) },
        { header: 'Price (USD)', type: 'currency', value: (r) => USD(r.price_cents) },
        { header: 'CAS', value: (r) => S(r.cas) },
        { header: 'MW', value: (r) => S(r.mw) },
        { header: 'Featured', value: (r) => S(r.featured) },
        { header: 'Tags', value: (r) => S(r.tags) },
      ],
    },
  ];
}

const PREVIEW_LIMIT = 50;

function displayCell(col: Column<Row>, row: Row): string {
  const v = col.value(row);
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'currency' && typeof v === 'number') return `$${v.toFixed(2)}`;
  return String(v);
}

export function AdminReports() {
  const { products } = useProducts();
  const reports = useMemo(() => buildReports(products), [products]);

  const [activeId, setActiveId] = useState(reports[0].id);
  const [rangeId, setRangeId] = useState('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = reports.find((r) => r.id === activeId) ?? reports[0];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRows(null);
      setError(null);
      const since = active.hasRange ? rangeSince(rangeId) : null;
      try {
        const data = await active.fetch(since);
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setRows([]); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [active, rangeId]);

  const filenameBase = `vsr-${active.id}-${stamp(new Date())}`;
  const canExport = !!rows && rows.length > 0;

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Reports</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <AdminFilterBar
            label=""
            dense
            options={reports.map((r) => ({ value: r.id, label: r.label }))}
            value={activeId}
            onChange={setActiveId}
          />
          {active.hasRange && (
            <AdminFilterBar
              label=""
              dense
              options={RANGES.map((rg) => ({ value: rg.id, label: rg.label }))}
              value={rangeId}
              onChange={setRangeId}
            />
          )}
        </div>
      </header>

      {/* Controls row: description + export */}
      <div className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)] flex flex-col gap-[var(--space-4)] sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-ink/80">{active.label}</p>
          <p className="text-[11.5px] text-ink/45 mt-0.5 max-w-[60ch]">{active.description}</p>
        </div>

        <div className="flex items-center gap-[var(--space-2)] shrink-0">
          <span className="font-mono text-[10px] text-ink/40 tabular-nums mr-[var(--space-2)]">
            {rows ? `${rows.length} rows` : 'Loading…'}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canExport}
            onClick={() => downloadXlsx(`${filenameBase}.xlsx`, active.sheet, active.columns, rows ?? [])}
          >
            Export Excel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canExport}
            onClick={() => downloadCsv(`${filenameBase}.csv`, active.columns, rows ?? [])}
          >
            CSV
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>
      )}

      {/* Preview table */}
      {rows && rows.length > 0 && (
        <div className="research-surface-solid overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-ink/[0.10]">
                {active.columns.map((c) => (
                  <th
                    key={c.header}
                    className={[
                      'py-[var(--space-3)] px-[var(--space-3)] text-[10px] uppercase tracking-[0.18em] text-ink/45 font-normal whitespace-nowrap',
                      c.type === 'number' || c.type === 'currency' ? 'text-right' : 'text-left',
                    ].join(' ')}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                <tr key={i} className="border-b border-ink/[0.04] hover:bg-ink/[0.015] transition-colors">
                  {active.columns.map((c) => (
                    <td
                      key={c.header}
                      className={[
                        'py-[var(--space-2)] px-[var(--space-3)] text-[11.5px] align-top',
                        c.type === 'number' || c.type === 'currency'
                          ? 'text-right font-mono tabular-nums text-ink/75'
                          : 'text-left text-ink/80',
                        'max-w-[260px] truncate',
                      ].join(' ')}
                      title={displayCell(c, row)}
                    >
                      {displayCell(c, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > PREVIEW_LIMIT && (
            <p className="px-[var(--space-4)] py-[var(--space-3)] text-[10px] uppercase tracking-[0.2em] text-ink/35 border-t border-ink/[0.06]">
              Showing {PREVIEW_LIMIT} of {rows.length} — export includes all {rows.length}.
            </p>
          )}
        </div>
      )}

      {rows && rows.length === 0 && !error && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">No rows for this report{active.hasRange ? ' in the selected range' : ''}.</p>
        </div>
      )}
    </AdminLayout>
  );
}
