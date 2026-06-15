/**
 * AdminDashboard
 *
 * Landing page. At-a-glance counts (open inquiries, orders awaiting
 * invoice, paid orders awaiting fulfillment, total SKUs in stock).
 * Seed-stock button hydrates product_stock from the local product
 * catalog + biopeptide manifest in one click (idempotent — safe to
 * re-run).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

interface Counts {
  openInquiries: number;
  pendingInvoice: number;
  paidAwaitingFulfillment: number;
  fulfilledThisMonth: number;
  skusInStock: number;
}

const DEFAULT_SEED_QTY = 0;

export function AdminDashboard() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seedState, setSeedState] = useState<
    { kind: 'idle' } | { kind: 'running'; processed: number; total: number } | { kind: 'done'; inserted: number; skipped: number } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      try {
        const since = new Date();
        since.setUTCDate(1);
        since.setUTCHours(0, 0, 0, 0);

        const [
          openInquiries,
          pendingInvoice,
          paidAwaiting,
          fulfilledMonth,
          skus,
        ] = await Promise.all([
          supabase.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending_invoice'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'fulfilled').gte('fulfilled_at', since.toISOString()),
          supabase.from('product_stock').select('sku', { count: 'exact', head: true }).gt('on_hand', 0),
        ]);

        if (cancelled) return;
        setCounts({
          openInquiries: openInquiries.count ?? 0,
          pendingInvoice: pendingInvoice.count ?? 0,
          paidAwaitingFulfillment: paidAwaiting.count ?? 0,
          fulfilledThisMonth: fulfilledMonth.count ?? 0,
          skusInStock: skus.count ?? 0,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load dashboard counts.');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function collectSeedSkus(): string[] {
    const set = new Set<string>();
    for (const p of products) {
      if (p.sku) set.add(p.sku);
    }
    for (const row of manifest) {
      const abbrev = row.abbreviation.replace(/\s+/g, '');
      set.add(`VSR-RS-${abbrev}`);
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
  }

  return (
    <AdminLayout>
      {error && (
        <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-[var(--space-3)]">
        <DashboardStat label="Open inquiries" value={counts?.openInquiries} link="/admin/inquiries" />
        <DashboardStat label="Awaiting invoice" value={counts?.pendingInvoice} link="/admin/orders" />
        <DashboardStat label="Paid · awaiting ship" value={counts?.paidAwaitingFulfillment} link="/admin/orders" emphasis />
        <DashboardStat label="Fulfilled this month" value={counts?.fulfilledThisMonth} link="/admin/orders" />
        <DashboardStat label="SKUs in stock" value={counts?.skusInStock} link="/admin/inventory" />
      </div>

      <section className="mt-[var(--space-10)] research-surface-solid p-[var(--space-6)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Catalog Seed
        </p>
        <h2 className="text-[clamp(1.1rem,2vw,1.4rem)] font-light text-ink tracking-tight mb-[var(--space-3)]">
          Hydrate stock from catalog.
        </h2>
        <p className="holo-text-body text-[13px] leading-relaxed max-w-[60ch] mb-[var(--space-5)]">
          Creates a <code className="font-mono text-holo-light/80">product_stock</code>{' '}
          row at 0 for every SKU in <code className="font-mono text-holo-light/80">products.json</code> and
          the biopeptide manifest, if one doesn't already exist. Idempotent —
          existing rows are untouched. Use after first deploy, or when new
          SKUs are added to the catalog. Adjust individual quantities from
          the Inventory tab afterwards.
        </p>
        <div className="flex items-center gap-[var(--space-4)] flex-wrap">
          <button
            type="button"
            onClick={handleSeed}
            disabled={seedState.kind === 'running'}
            className="rounded-full border border-ink/20 bg-ink/[0.04] px-[var(--space-6)] py-[var(--space-3)] text-[11px] uppercase tracking-[0.22em] text-ink/80 hover:text-ink hover:border-ink/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            {seedState.kind === 'running'
              ? `Seeding ${seedState.processed}/${seedState.total}…`
              : 'Seed catalog stock'}
          </button>
          {seedState.kind === 'done' && (
            <p className="text-[11px] font-mono tabular-nums text-ink/55">
              Inserted {seedState.inserted} · Skipped {seedState.skipped} (already present)
            </p>
          )}
          {seedState.kind === 'error' && (
            <p role="alert" className="text-[11px] text-red-400">
              {seedState.message}
            </p>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}

interface DashboardStatProps {
  label: string;
  value: number | undefined;
  link: string;
  emphasis?: boolean;
}

function DashboardStat({ label, value, link, emphasis }: DashboardStatProps) {
  return (
    <Link
      to={link}
      className={[
        'block research-surface-solid px-[var(--space-4)] py-[var(--space-5)]',
        'transition-colors hover:bg-ink/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30',
      ].join(' ')}
    >
      <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em] mb-[var(--space-2)]">
        {label}
      </p>
      <p
        className={
          emphasis
            ? 'holo-text-display text-[clamp(1.4rem,2.6vw,1.8rem)] font-light tabular-nums leading-none'
            : 'text-[clamp(1.4rem,2.6vw,1.8rem)] font-light text-ink tabular-nums leading-none'
        }
      >
        {value === undefined ? '—' : value}
      </p>
    </Link>
  );
}
