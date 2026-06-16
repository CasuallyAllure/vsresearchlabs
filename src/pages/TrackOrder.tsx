/**
 * TrackOrder — public order page, two modes.
 *
 *  • Status lookup (default): order number OR email + shipping ZIP → status +
 *    carrier tracking only. Backed by the ZIP-gated `lookup_order` RPC
 *    (migrations 012/018). This gate is enumerable, so it exposes NO financials
 *    or contents — status/tracking only.
 *
 *  • Invoice/receipt (`/track?t=<token>`): the order's high-entropy secret token
 *    (shared by the admin / emailed with the invoice) unlocks the full invoice —
 *    itemized lines, totals, payment instructions — rendered as an invoice while
 *    unpaid and a paid receipt once cleared, with print/save-PDF. Backed by
 *    `get_order_by_token` (migration 019); the token is unguessable so there's
 *    no enumeration path.
 *
 * View only — customers never mutate; all status changes stay admin-side.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  carrierLabel,
  carrierTrackingUrl,
  statusPresentation,
  STATUS_STEPS,
  type OrderLookupResult,
  type OrderInvoice,
  type OrderInvoiceLine,
} from '../lib/tracking';
import productsData from '../data/products.json';
import generatedCompounds from '../data/biopeptideCompounds.generated.json';
import type { Product } from '../types';
import { tierPriceCents } from '../lib/pricing';

/** SKU → catalog product, to resolve a unit price when a line has none stored. */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}
function unitOf(l: OrderInvoiceLine): number | null {
  if (l.unit_price_cents != null) return l.unit_price_cents;
  const p = productBySku.get(l.sku);
  if (p) {
    const c = tierPriceCents(p, l.item_note || l.product_name || '');
    if (c != null) return c;
  }
  return null;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtUSD(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function TrackOrder() {
  const [params] = useSearchParams();
  const token = params.get('t');
  return (
    <section className="py-[var(--space-8)] max-w-[760px] mx-auto px-[var(--space-4)]">
      {token ? <InvoiceByToken token={token} /> : <StatusLookup />}
    </section>
  );
}

/* ── Mode 1: token-gated invoice / receipt ──────────────────────────────────── */

type InvoiceState =
  | { kind: 'loading' }
  | { kind: 'ok'; invoice: OrderInvoice }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

function InvoiceByToken({ token }: { token: string }) {
  const [state, setState] = useState<InvoiceState>({ kind: 'loading' });
  const [showDoc, setShowDoc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setState({ kind: 'error', message: 'Order view is temporarily unavailable.' }); return; }
      const { data, error } = await supabase.rpc('get_order_by_token', { p_token: token });
      if (cancelled) return;
      if (error) { setState({ kind: 'error', message: error.message }); return; }
      if (!data) { setState({ kind: 'missing' }); return; }
      setState({ kind: 'ok', invoice: data as OrderInvoice });
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (state.kind === 'loading') {
    return <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>;
  }
  if (state.kind === 'error') {
    return <p role="alert" className="text-[13px] text-red-400">{state.message}</p>;
  }
  if (state.kind === 'missing') {
    return (
      <div className="research-surface-solid p-[var(--space-5)]">
        <p className="text-[13px] text-ink/75">
          This invoice link is invalid or has expired. Check the link in your invoice email, or{' '}
          <a href="/contact" className="text-holo-light underline underline-offset-2">contact us</a>.
        </p>
      </div>
    );
  }

  const o = state.invoice;
  const pres = statusPresentation(o.status);
  const url = carrierTrackingUrl(o.carrier, o.tracking_number);
  const docKind: 'invoice' | 'receipt' = o.paid ? 'receipt' : 'invoice';
  const shipped = formatDate(o.shipped_at);
  const delivered = formatDate(o.delivered_at);

  return (
    <>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          {docKind === 'receipt' ? 'Receipt' : 'Invoice'}
        </p>
        <h1 className="text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Order </span>
          <span className="font-medium text-ink">{o.order_number}</span>
        </h1>
        {o.buyer_name && <p className="mt-[var(--space-2)] text-[13px] text-ink/60">{o.buyer_name}</p>}
      </header>

      <article className="research-surface-solid p-[var(--space-5)]">
        {/* Status stepper */}
        <div className="mb-[var(--space-4)] flex items-start justify-between gap-[var(--space-4)] flex-wrap">
          <div>
            <h2 className="text-[1.1rem] font-medium text-ink">{pres.label}</h2>
            {pres.detail && <p className="mt-1 text-[12px] text-ink/65 max-w-[52ch]">{pres.detail}</p>}
          </div>
          {formatDate(o.placed_at) && (
            <p className="text-[11px] text-ink/45 text-right">
              <span className="uppercase tracking-[0.18em] text-ink/35">Placed</span><br />{formatDate(o.placed_at)}
            </p>
          )}
        </div>
        {pres.tone !== 'stopped' && (
          <ol className="flex items-center gap-1 mb-[var(--space-5)]" aria-label="Order progress">
            {STATUS_STEPS.map((label, i) => {
              const reached = i <= pres.step;
              return (
                <li key={label} className="flex-1 min-w-0">
                  <div className={`h-1 rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/12'}`} aria-current={i === pres.step ? 'step' : undefined} />
                  <span className={`mt-1 block truncate text-[9px] uppercase tracking-[0.14em] ${reached ? 'text-ink/70' : 'text-ink/35'}`}>{label}</span>
                </li>
              );
            })}
          </ol>
        )}

        {/* Itemized */}
        <p className="holo-text-caption mb-[var(--space-2)] text-[9px] uppercase tracking-[0.26em] text-ink/40">Itemized</p>
        <ul className="divide-y divide-ink/[0.05] rounded-sm border border-ink/[0.08]">
          {o.lines.map((l, i) => {
            const u = unitOf(l);
            return (
              <li key={`${l.sku}-${i}`} className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
                  <p className="truncate font-mono text-[10px] text-holo-light/70">{l.sku}{l.item_note ? ` · ${l.item_note}` : ''}</p>
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-[10.5px] text-ink/50">{l.quantity} × {fmtUSD(u)}</p>
                  <p className="text-[12.5px] text-ink/85">{fmtUSD(u == null ? null : u * l.quantity)}</p>
                </div>
              </li>
            );
          })}
          {o.lines.length === 0 && <li className="px-[var(--space-3)] py-[var(--space-4)] text-center text-[12px] text-ink/40">No line items.</li>}
        </ul>

        {/* Totals + pay/paid */}
        {o.total_cents != null && (
          <div className="mt-[var(--space-4)] flex items-end justify-between gap-[var(--space-4)] flex-wrap border-t border-ink/[0.08] pt-[var(--space-4)]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{o.paid ? 'Amount paid' : 'Amount due'}</p>
              <p className="font-mono text-[1.25rem] tabular-nums text-ink">{fmtUSD(o.total_cents)}</p>
              {o.subtotal_cents != null && (
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">Subtotal {fmtUSD(o.subtotal_cents)} · Shipping {fmtUSD(o.shipping_cents ?? 0)}</p>
              )}
            </div>
            {o.paid ? (
              <span className="rounded-sm border border-[#2E7D5B]/45 bg-[#2E7D5B]/[0.08] px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] text-[#2E7D5B]">Paid</span>
            ) : (
              o.payment_method && (
                <p className="text-[11px] text-ink/55 max-w-[24ch] sm:text-right">
                  <span className="uppercase tracking-[0.16em] text-ink/35">Pay via</span><br />{o.payment_method}
                </p>
              )
            )}
          </div>
        )}

        {/* Tracking */}
        {o.tracking_number && (
          <div className="mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-4)] flex-wrap border-t border-ink/[0.08] pt-[var(--space-4)]">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{carrierLabel(o.carrier)} tracking</p>
              <p className="font-mono text-[12px] text-ink/80 break-all">{o.tracking_number}</p>
              {(shipped || delivered) && <p className="mt-1 text-[11px] text-ink/45">{delivered ? `Delivered ${delivered}` : `Shipped ${shipped}`}</p>}
            </div>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-holo/[0.15] border border-holo/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-holo-light hover:bg-holo/[0.22] transition-colors">
                Track on {carrierLabel(o.carrier)} ↗
              </a>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowDoc(true)}
          className="mt-[var(--space-5)] rounded-full border border-ink/25 bg-ink/[0.05] px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] text-ink/80 hover:border-ink/40 hover:bg-ink/[0.10] transition-colors"
        >
          View / print {docKind}
        </button>
      </article>

      {showDoc && <InvoiceDoc invoice={o} docKind={docKind} onClose={() => setShowDoc(false)} />}
    </>
  );
}

/* ── Branded printable invoice / receipt ────────────────────────────────────── */

function InvoiceDoc({ invoice: o, docKind, onClose }: { invoice: OrderInvoice; docKind: 'invoice' | 'receipt'; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const computedSub = o.subtotal_cents ?? o.lines.reduce((a, l) => { const u = unitOf(l); return a + (u == null ? 0 : u * l.quantity); }, 0);
  const shipping = o.shipping_cents ?? 0;
  const total = o.total_cents ?? computedSub + shipping;
  const discount = Math.max(0, computedSub + shipping - total);
  const title = docKind === 'receipt' ? 'Receipt' : 'Invoice';

  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } .print-doc, .print-doc * { visibility: visible !important; } .print-doc { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; } .no-print { display: none !important; } }`}</style>
      <div className="fixed inset-0 z-[300] overflow-y-auto bg-ink/60 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[301] overflow-y-auto p-4 sm:p-8 pointer-events-none">
        <div className="print-doc pointer-events-auto mx-auto max-w-[760px] bg-white text-[#1A1714] shadow-[0_24px_60px_-20px_rgba(26,23,20,0.5)]">
          <div className="no-print flex items-center justify-between gap-3 border-b border-ink/10 px-6 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">{title} preview</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} className="rounded-full border border-ink/25 bg-ink/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/80 hover:border-ink/40">Print / Save PDF</button>
              <button type="button" onClick={onClose} className="rounded-full border border-ink/15 px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/60 hover:border-ink/30">Close</button>
            </div>
          </div>
          <div className="px-8 py-8 sm:px-10 sm:py-10">
            <div className="flex items-start justify-between gap-6 border-b border-[#1A1714]/10 pb-6">
              <div className="flex items-center gap-3">
                <img src="/brand/vs-dna-s-full-colour.png" alt="VS Research Labs" className="h-10 w-auto" />
                <div>
                  <p className="font-serif text-[18px] leading-none text-[#1A1714]">VS Research Labs</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B635A]">For Research Purposes Only</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-serif text-[22px] leading-none text-[#1A1714]">{title}</p>
                <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#6B635A]">{o.order_number}</p>
                <p className="font-mono text-[10px] tabular-nums text-[#9A9186]">{formatDate(o.placed_at)}</p>
                {docKind === 'receipt' && <p className="mt-1.5 inline-block rounded-sm border border-[#2E7D5B]/45 bg-[#2E7D5B]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#2E7D5B]">Paid</p>}
              </div>
            </div>

            {o.buyer_name && (
              <div className="py-4">
                <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[#9A9186]">Bill to</p>
                <p className="text-[13px] text-[#1A1714]">{o.buyer_name}</p>
              </div>
            )}

            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr className="border-y border-[#1A1714]/15">
                  <th className="py-2 pr-3 text-left font-mono text-[9px] uppercase tracking-[0.16em] text-[#9A9186] font-normal">SKU</th>
                  <th className="py-2 pr-3 text-left font-mono text-[9px] uppercase tracking-[0.16em] text-[#9A9186] font-normal">Item</th>
                  <th className="py-2 pr-3 text-right font-mono text-[9px] uppercase tracking-[0.16em] text-[#9A9186] font-normal">Qty</th>
                  <th className="py-2 pr-3 text-right font-mono text-[9px] uppercase tracking-[0.16em] text-[#9A9186] font-normal">Unit</th>
                  <th className="py-2 text-right font-mono text-[9px] uppercase tracking-[0.16em] text-[#9A9186] font-normal">Line</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l, i) => {
                  const u = unitOf(l);
                  return (
                    <tr key={`${l.sku}-${i}`} className="border-b border-[#1A1714]/[0.08]">
                      <td className="py-2 pr-3 font-mono text-[11px] text-[#34727A]">{l.sku}</td>
                      <td className="py-2 pr-3 text-[12px] text-[#1A1714]">{l.product_name}{l.item_note && <span className="block text-[10.5px] text-[#9A9186]">{l.item_note}</span>}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{l.quantity}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-[#6B635A]">{fmtUSD(u)}</td>
                      <td className="py-2 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{fmtUSD(u == null ? null : u * l.quantity)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1 text-[12px]">
                <dt className="text-[#6B635A]">Subtotal</dt><dd className="text-right font-mono tabular-nums text-[#1A1714]">{fmtUSD(computedSub)}</dd>
                <dt className="text-[#6B635A]">Shipping</dt><dd className="text-right font-mono tabular-nums text-[#1A1714]">{fmtUSD(shipping)}</dd>
                {discount > 0 && (<>
                  <dt className="text-[#34727A]">Discount</dt><dd className="text-right font-mono tabular-nums text-[#34727A]">−{fmtUSD(discount)}</dd>
                </>)}
                <dt className="border-t border-[#1A1714]/15 pt-1 text-[#1A1714]">{docKind === 'receipt' ? 'Paid' : 'Total due'}</dt>
                <dd className="border-t border-[#1A1714]/15 pt-1 text-right font-mono text-[15px] tabular-nums text-[#1A1714]">{fmtUSD(total)}</dd>
              </dl>
            </div>

            {docKind === 'invoice' && o.payment_method && (
              <p className="mt-6 rounded-sm border border-[#1A1714]/10 bg-[#1A1714]/[0.02] px-4 py-3 text-[11.5px] text-[#6B635A]">
                <span className="font-mono uppercase tracking-[0.16em] text-[#9A9186]">Payment</span><br />
                Pay via {o.payment_method}. Your order ships once payment clears.
              </p>
            )}

            <p className="mt-8 border-t border-[#1A1714]/10 pt-4 text-[10px] leading-relaxed text-[#9A9186]">
              VS Research Labs · inquire@vsresearchlabs.com · All products are sold for laboratory research use only and are not for human consumption.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Mode 2: status / tracking lookup (ZIP-gated, no financials) ─────────────── */

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: OrderLookupResult[] }
  | { kind: 'error'; message: string };

function StatusLookup() {
  const [identifier, setIdentifier] = useState('');
  const [zip, setZip] = useState('');
  const [state, setState] = useState<LookupState>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = identifier.trim();
    const z = zip.trim();
    if (!id || !z) return;
    if (!supabase) { setState({ kind: 'error', message: 'Order tracking is temporarily unavailable.' }); return; }
    setState({ kind: 'loading' });
    const { data, error } = await supabase.rpc('lookup_order', { p_identifier: id, p_zip: z });
    if (error) { setState({ kind: 'error', message: error.message }); return; }
    setState({ kind: 'done', results: (data ?? []) as OrderLookupResult[] });
  }

  return (
    <>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">Order status</p>
        <h1 className="text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Track your </span>
          <span className="font-medium text-ink">order.</span>
        </h1>
        <p className="mt-[var(--space-3)] text-[13px] leading-relaxed text-ink/70 max-w-[58ch]">
          Enter your order number or the email you ordered with, plus the shipping ZIP code.
          To view your full invoice or receipt, use the link in your invoice email.
        </p>
      </header>

      <form onSubmit={onSubmit} className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)]">
        <div className="grid gap-[var(--space-4)] sm:grid-cols-[1fr_140px]">
          <div>
            <label htmlFor="track-id" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Order number or email</label>
            <input id="track-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="VSR-ORD-… or your email" autoComplete="off" className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40" />
          </div>
          <div>
            <label htmlFor="track-zip" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Shipping ZIP</label>
            <input id="track-zip" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="85001" autoComplete="off" className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40" />
          </div>
        </div>
        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">
          <button type="submit" disabled={state.kind === 'loading' || !identifier.trim() || !zip.trim()} className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {state.kind === 'loading' ? 'Searching…' : 'Track'}
          </button>
        </div>
        {state.kind === 'error' && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{state.message}</p>}
      </form>

      {state.kind === 'done' && state.results.length === 0 && (
        <div className="research-surface-solid p-[var(--space-5)]">
          <p className="text-[13px] text-ink/75">
            No order found with that order number/email and ZIP. Double-check the ZIP matches the
            shipping address, or <a href="/contact" className="text-holo-light underline underline-offset-2">contact us</a>.
          </p>
        </div>
      )}

      {state.kind === 'done' && state.results.map((order) => <StatusCard key={order.order_number} order={order} />)}
    </>
  );
}

function StatusCard({ order }: { order: OrderLookupResult }) {
  const pres = statusPresentation(order.status);
  const url = carrierTrackingUrl(order.carrier, order.tracking_number);
  const placed = formatDate(order.placed_at);
  const shipped = formatDate(order.shipped_at);
  const delivered = formatDate(order.delivered_at);

  return (
    <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
      <div className="flex items-start justify-between gap-[var(--space-4)] flex-wrap mb-[var(--space-4)]">
        <div>
          <p className="font-mono text-[11px] tracking-[0.06em] text-ink/55">{order.order_number}</p>
          <h2 className="mt-1 text-[1.15rem] font-medium text-ink">{pres.label}</h2>
          {pres.detail && <p className="mt-1 text-[12px] text-ink/65 max-w-[52ch]">{pres.detail}</p>}
        </div>
        {placed && (
          <p className="text-[11px] text-ink/45">
            <span className="uppercase tracking-[0.18em] text-ink/35">Placed</span><br />{placed}
          </p>
        )}
      </div>

      {pres.tone !== 'stopped' && (
        <ol className="flex items-center gap-1 mb-[var(--space-4)]" aria-label="Order progress">
          {STATUS_STEPS.map((label, i) => {
            const reached = i <= pres.step;
            return (
              <li key={label} className="flex-1 min-w-0">
                <div className={`h-1 rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/12'}`} aria-current={i === pres.step ? 'step' : undefined} />
                <span className={`mt-1 block truncate text-[9px] uppercase tracking-[0.14em] ${reached ? 'text-ink/70' : 'text-ink/35'}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {order.tracking_number ? (
        <div className="flex items-center justify-between gap-[var(--space-4)] flex-wrap border-t border-ink/[0.08] pt-[var(--space-4)]">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{carrierLabel(order.carrier)} tracking</p>
            <p className="font-mono text-[12px] text-ink/80 break-all">{order.tracking_number}</p>
            {(shipped || delivered) && <p className="mt-1 text-[11px] text-ink/45">{delivered ? `Delivered ${delivered}` : shipped ? `Shipped ${shipped}` : null}</p>}
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-holo/[0.15] border border-holo/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-holo-light hover:bg-holo/[0.22] transition-colors">
              Track on {carrierLabel(order.carrier)} ↗
            </a>
          )}
        </div>
      ) : (
        pres.step >= 3 && (
          <p className="border-t border-ink/[0.08] pt-[var(--space-4)] text-[12px] text-ink/55">
            A tracking number will appear here once it’s posted.
          </p>
        )
      )}
    </article>
  );
}
