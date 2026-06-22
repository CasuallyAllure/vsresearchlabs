/**
 * PerformanceSummary
 *
 * A simple, at-a-glance sales performance panel for the top of the dashboard.
 * Pick a period and see the four numbers that actually matter — revenue,
 * paid orders, units sold, average order value — plus the top-selling SKUs.
 *
 * "Revenue-recognized" = orders that have been paid (status paid or fulfilled;
 * delivered orders stay 'fulfilled' with a delivered_at stamp). Cancelled and
 * refunded orders are excluded. The period filters on when the order was paid
 * (falling back to when it was placed if paid_at is missing on legacy rows).
 *
 * All aggregation is client-side from two small queries — no new RPC/migration.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const RANGES: Array<{ id: string; label: string }> = [
  { id: 'mtd', label: 'This month' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'This year' },
  { id: 'all', label: 'All time' },
];

function sinceISO(id: string): string | null {
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

const fmtUSD = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (n: number): string => n.toLocaleString('en-US');

interface OrderRow {
  id: string;
  status: string;
  invoice_amount_cents: number | null;
  subtotal_cents: number | null;
  paid_at: string | null;
  created_at: string;
}

interface LineRow {
  order_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
}

interface TopSku { sku: string; name: string; units: number; revenueCents: number }

interface Metrics {
  revenueCents: number;
  orders: number;
  units: number;
  aovCents: number;
  top: TopSku[];
}

export function PerformanceSummary() {
  const [range, setRange] = useState('mtd');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); setLoading(false); return; }
      setLoading(true); setError(null);
      // Revenue-recognized orders only.
      const { data: ords, error: oErr } = await supabase
        .from('orders')
        .select('id, status, invoice_amount_cents, subtotal_cents, paid_at, created_at')
        .in('status', ['paid', 'fulfilled'])
        .limit(5000);
      if (cancelled) return;
      if (oErr) { setError(oErr.message); setLoading(false); return; }
      const orderRows = (ords ?? []) as OrderRow[];

      const ids = orderRows.map((o) => o.id);
      let lineRows: LineRow[] = [];
      if (ids.length > 0) {
        const { data: lns, error: lErr } = await supabase
          .from('order_lines')
          .select('order_id, sku, product_name, quantity, unit_price_cents')
          .in('order_id', ids);
        if (cancelled) return;
        if (lErr) { setError(lErr.message); setLoading(false); return; }
        lineRows = (lns ?? []) as LineRow[];
      }

      setOrders(orderRows);
      setLines(lineRows);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const metrics: Metrics = useMemo(() => {
    const since = sinceISO(range);
    const inRange = (o: OrderRow) => {
      if (!since) return true;
      const basis = o.paid_at ?? o.created_at;
      return basis >= since;
    };
    const kept = orders.filter(inRange);
    const keptIds = new Set(kept.map((o) => o.id));
    const orderRevenue = (o: OrderRow) => o.invoice_amount_cents ?? o.subtotal_cents ?? 0;

    const revenueCents = kept.reduce((a, o) => a + orderRevenue(o), 0);
    const ordersCount = kept.length;

    const bySku = new Map<string, TopSku>();
    let units = 0;
    for (const l of lines) {
      if (!keptIds.has(l.order_id)) continue;
      units += l.quantity;
      const cur = bySku.get(l.sku) ?? { sku: l.sku, name: l.product_name, units: 0, revenueCents: 0 };
      cur.units += l.quantity;
      cur.revenueCents += (l.unit_price_cents ?? 0) * l.quantity;
      bySku.set(l.sku, cur);
    }
    const top = [...bySku.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5);

    return {
      revenueCents,
      orders: ordersCount,
      units,
      aovCents: ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0,
      top,
    };
  }, [orders, lines, range]);

  const maxTopRevenue = metrics.top.length > 0 ? metrics.top[0].revenueCents : 0;

  return (
    <section className="mb-[var(--space-6)]">
      <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-3)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] text-ink/55">Performance</p>
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map((r) => {
            const on = r.id === range;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={`rounded-full border px-[var(--space-3)] py-[3px] text-[9px] uppercase tracking-[0.16em] transition-colors ${
                  on ? 'border-ink/40 bg-ink/[0.04] text-ink' : 'border-ink/15 text-ink/50 hover:border-ink/30 hover:text-ink/80'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-[var(--space-3)] lg:grid-cols-4">
        <Kpi label="Revenue" value={loading ? '…' : fmtUSD(metrics.revenueCents)} />
        <Kpi label="Paid orders" value={loading ? '…' : fmtInt(metrics.orders)} />
        <Kpi label="Units sold" value={loading ? '…' : fmtInt(metrics.units)} />
        <Kpi label="Avg order value" value={loading ? '…' : fmtUSD(metrics.aovCents)} />
      </div>

      {/* Top sellers */}
      <div className="mt-[var(--space-3)] research-surface-solid px-[var(--space-4)] py-[var(--space-4)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[9px] uppercase tracking-[0.24em] text-ink/40">Top sellers</p>
        {loading ? (
          <p className="text-[11px] text-ink/40">Loading…</p>
        ) : metrics.top.length === 0 ? (
          <p className="text-[11px] text-ink/40">No paid orders in this period yet.</p>
        ) : (
          <ol className="space-y-[var(--space-2)]">
            {metrics.top.map((t) => (
              <li key={t.sku} className="flex items-center gap-[var(--space-3)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-[var(--space-3)]">
                    <span className="truncate text-[12.5px] text-ink/85">{t.name}</span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink/80">{fmtUSD(t.revenueCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-[var(--space-2)]">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                      <div
                        className="h-full rounded-full bg-holo"
                        style={{ width: maxTopRevenue > 0 ? `${Math.max(4, Math.round((t.revenueCents / maxTopRevenue) * 100))}%` : '0%' }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-ink/40">{fmtInt(t.units)} units</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="research-surface-solid px-[var(--space-4)] py-[var(--space-4)]">
      <span className="holo-text-caption block text-[10px] uppercase tracking-[0.22em] text-ink/45">{label}</span>
      <span className="mt-[var(--space-2)] block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}
