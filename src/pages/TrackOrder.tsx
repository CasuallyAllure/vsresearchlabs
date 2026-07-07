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

import { Fragment, useEffect, useState } from 'react';
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
  type OrderInvoiceCoupon,
} from '../lib/tracking';
import productsData from '../data/products.json';
import generatedCompounds from '../data/biopeptideCompounds.generated.json';
import type { Product } from '../types';
import { tierPriceCents } from '../lib/pricing';
import { siteConfig } from '../config';
import { Button } from '../components/ui/Button';

/** SKU → catalog product, to resolve a unit price when a line has none stored. */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}
/** Discount-line label for an applied coupon — matches the admin editor + email. */
function invoiceCouponLabel(c: OrderInvoiceCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.code} · ${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `${c.code} · $${(c.amount_cents / 100).toFixed(2)} off`;
  return `${c.code} · Free ${c.free_label ?? 'item'}`;
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
      {token ? <InvoiceByToken token={token} justClaimed={params.get('claimed') === '1'} /> : <StatusLookup />}
    </section>
  );
}

/* ── Mode 1: token-gated invoice / receipt ──────────────────────────────────── */

type InvoiceState =
  | { kind: 'loading' }
  | { kind: 'ok'; invoice: OrderInvoice }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

function InvoiceByToken({ token, justClaimed = false }: { token: string; justClaimed?: boolean }) {
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
  const placed = formatDate(o.placed_at);

  // Hand-delivered orders never have a tracking pipeline; they ship in-person.
  const isHandDelivered = (o.carrier ?? '').toLowerCase() === 'hand_delivered';
  // Once the order is in transit (shipped or delivered) the tracking card is
  // the buyer's primary focus. Before that we still render it as "awaiting
  // tracking" so the buyer knows where to look.
  const inTransit = pres.step >= 4;

  return (
    <>
      {/* Payment-recorded confirmation — shown when the buyer arrives from the
          "I've sent payment" email link (mark-payment-claimed redirect). */}
      {justClaimed && !o.paid && (
        <div className="mb-[var(--space-4)] flex items-start gap-[var(--space-3)] rounded-sm border border-holo/30 bg-holo/[0.07] p-[var(--space-4)]">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-holo text-[13px] font-bold text-white">✓</span>
          <div>
            <p className="text-[13px] font-light text-ink">Payment recorded — thank you.</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink/65">
              We'll confirm the deposit landed and start fulfillment within one business day.
              You'll get a shipment notification with tracking when your order ships.
            </p>
          </div>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header className="mb-[var(--space-5)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          Track your order
        </p>
        <h1 className="text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Order </span>
          <span className="font-light text-ink">{o.order_number}</span>
        </h1>
        <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-1 text-[12px] text-ink/55">
          {o.buyer_name && <span>{o.buyer_name}</span>}
          {placed && (
            <>
              {o.buyer_name && <span className="text-ink/25">·</span>}
              <span><span className="uppercase tracking-[0.14em] text-ink/35 mr-1">Placed</span>{placed}</span>
            </>
          )}
        </div>
      </header>

      {/* ── Status module — the tracking bar ─────────────────────────── */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <div className="mb-[var(--space-3)]">
          <p className="holo-text-caption text-[9px] uppercase tracking-[0.26em] text-ink/35 mb-1">
            Status
          </p>
          <h2 className="text-[1.15rem] font-medium text-ink leading-snug">{pres.label}</h2>
          {pres.detail && (
            <p className="mt-1.5 text-[12.5px] text-ink/65 leading-relaxed max-w-[58ch]">
              {pres.detail}
            </p>
          )}
        </div>

        {pres.tone !== 'stopped' && (
          <ol className="flex items-stretch gap-1 mt-[var(--space-4)]" aria-label="Order progress">
            {STATUS_STEPS.map((label, i) => {
              const reached = i <= pres.step;
              const isCurrent = i === pres.step;
              return (
                <li key={label} className="flex-1 min-w-0">
                  <div
                    className={`h-1.5 rounded-full transition-colors ${
                      reached ? 'bg-holo' : 'bg-ink/12'
                    }`}
                    style={isCurrent ? { boxShadow: '0 0 0 3px rgba(98,160,166,0.18)' } : undefined}
                    aria-current={isCurrent ? 'step' : undefined}
                  />
                  <span
                    className={`mt-1.5 block truncate text-[8.5px] uppercase tracking-[0.16em] ${
                      reached ? (isCurrent ? 'text-ink font-medium' : 'text-ink/70') : 'text-ink/30'
                    }`}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </article>

      {/* ── Tracking module — dedicated card, always present ─────────── */}
      {!isHandDelivered && (
        <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
          <p className="holo-text-caption text-[9px] uppercase tracking-[0.26em] text-ink/35 mb-[var(--space-2)]">
            {inTransit ? 'In transit' : 'Carrier tracking'}
          </p>
          {o.tracking_number ? (
            <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45">
                  {carrierLabel(o.carrier)}
                </p>
                <p className="mt-1 font-mono text-[15px] tabular-nums text-ink break-all leading-tight">
                  {o.tracking_number}
                </p>
                {(shipped || delivered) && (
                  <p className="mt-1.5 text-[11px] text-ink/55">
                    {delivered ? `Delivered ${delivered}` : shipped ? `Shipped ${shipped}` : null}
                  </p>
                )}
              </div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-full bg-holo/[0.15] border border-holo/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-holo-light hover:bg-holo/[0.22] transition-colors"
                >
                  Track on {carrierLabel(o.carrier)} ↗
                </a>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-[var(--space-3)]">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-ink/20"
              />
              <p className="text-[12.5px] text-ink/60 leading-relaxed max-w-[58ch]">
                A carrier and tracking number will appear here as soon as your
                order ships. You'll also get an email the moment it leaves the
                warehouse.
              </p>
            </div>
          )}
        </article>
      )}
      {isHandDelivered && (
        <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
          <p className="holo-text-caption text-[9px] uppercase tracking-[0.26em] text-ink/35 mb-[var(--space-2)]">
            Delivery method
          </p>
          <div className="flex items-center gap-[var(--space-3)]">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full bg-holo/70"
            />
            <p className="text-[12.5px] text-ink/75 leading-relaxed">
              <strong className="text-ink">Hand delivery</strong>
              {delivered ? ` — delivered ${delivered}.` : ' — we’ll reach out to coordinate the handoff.'}
            </p>
          </div>
        </article>
      )}

      {/* ── Order summary — secondary, collapsed to essentials ───────── */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <div className="flex items-baseline justify-between gap-[var(--space-3)] mb-[var(--space-3)]">
          <p className="holo-text-caption text-[9px] uppercase tracking-[0.26em] text-ink/35">
            Order summary
          </p>
          {o.total_cents != null && (
            <p className="font-mono tabular-nums text-ink text-[14px]">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40 mr-2">
                {o.paid ? 'Paid' : 'Due'}
              </span>
              {fmtUSD(o.total_cents)}
            </p>
          )}
        </div>
        <ul className="divide-y divide-ink/[0.05] rounded-sm border border-ink/[0.08]">
          {o.lines.map((l, i) => {
            const u = unitOf(l);
            return (
              <li
                key={`${l.sku}-${i}`}
                className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
                  <p className="truncate font-mono text-[10px] text-holo-light/70">
                    {l.sku}
                    {l.item_note ? ` · ${l.item_note}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-[10.5px] text-ink/50">
                    {l.quantity} × {fmtUSD(u)}
                  </p>
                  <p className="text-[12.5px] text-ink/85">
                    {fmtUSD(u == null ? null : u * l.quantity)}
                  </p>
                </div>
              </li>
            );
          })}
          {o.lines.length === 0 && (
            <li className="px-[var(--space-3)] py-[var(--space-4)] text-center text-[12px] text-ink/40">
              No line items.
            </li>
          )}
        </ul>
        {!o.paid && o.payment_method && (
          <p className="mt-[var(--space-3)] text-[11px] text-ink/55">
            <span className="uppercase tracking-[0.16em] text-ink/35">Pay via</span>{' '}
            {o.payment_method}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowDoc(true)}
          className="mt-[var(--space-4)] rounded-full border border-ink/25 bg-ink/[0.05] px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] text-ink/80 hover:border-ink/40 hover:bg-ink/[0.10] transition-colors"
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
          <div className="h-[3px] bg-[#B5904B]" />
          <div className="no-print flex items-center justify-between gap-3 border-b border-ink/10 px-6 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">{title} preview</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => window.print()}>Print / Save PDF</Button>
              <Button variant="secondary" size="sm" type="button" onClick={onClose}>Close</Button>
            </div>
          </div>
          <div className="px-8 py-8 sm:px-10 sm:py-10">
            <div className="flex items-start justify-between gap-6 border-b border-[#1A1714]/10 pb-6">
              <div className="flex items-center gap-3">
                <img src="/brand/vs-dna-s-full-colour.png" alt={siteConfig.brand.name} className="h-10 w-auto" />
                <div>
                  <p className="font-serif text-[18px] leading-none text-[#1A1714]">{siteConfig.brand.name}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B635A]">{siteConfig.compliance.shortLine}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block border-y border-[#B5904B] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-[#1A1714]">{title}</span>
                <p className="mt-2 font-mono text-[12px] tabular-nums text-[#1A1714]">{o.order_number}</p>
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

            {/* Discounts applied — surfaced up top, itemized per coupon, matching the email. */}
            {o.coupons && o.coupons.some((c) => c.discount_cents > 0) && (
              <div className="mb-3 rounded-[8px] border border-[#34727A]/25 bg-[#34727A]/[0.06] px-4 py-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#34727A]">Discounts applied</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[12px]">
                  {o.coupons.filter((c) => c.discount_cents > 0).map((c) => (
                    <Fragment key={c.code}>
                      <dt className="text-[#1A1714]">{invoiceCouponLabel(c)}</dt>
                      <dd className="text-right font-mono tabular-nums text-[#34727A]">−{fmtUSD(c.discount_cents)}</dd>
                    </Fragment>
                  ))}
                </dl>
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
                {/* Itemize each coupon so the buyer sees exactly what was discounted. */}
                {o.coupons && o.coupons.length > 0
                  ? o.coupons.filter((c) => c.discount_cents > 0).map((c) => (
                      <Fragment key={c.code}>
                        <dt className="text-[#34727A]">{invoiceCouponLabel(c)}</dt>
                        <dd className="text-right font-mono tabular-nums text-[#34727A]">−{fmtUSD(c.discount_cents)}</dd>
                      </Fragment>
                    ))
                  : discount > 0 && (<>
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

            <div className="mt-8 pt-5 text-center">
              <div className="mx-auto mb-3 h-px w-[120px] bg-[#B5904B]" />
              <p className="font-serif text-[14px] text-[#1A1714]">{siteConfig.brand.name}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[#9A9186]">
                {siteConfig.contact.inquiryEmail} · {siteConfig.compliance.documentLine}
              </p>
            </div>
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
          <span className="font-light text-ink">order.</span>
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
            <input id="track-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={siteConfig.order.trackingPlaceholder} autoComplete="off" className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40" />
          </div>
          <div>
            <label htmlFor="track-zip" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Shipping ZIP</label>
            <input id="track-zip" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="85001" autoComplete="off" className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40" />
          </div>
        </div>
        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">
          <Button variant="primary" size="md" type="submit" disabled={state.kind === 'loading' || !identifier.trim() || !zip.trim()}>
            {state.kind === 'loading' ? 'Searching…' : 'Track'}
          </Button>
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
          <h2 className="mt-1 text-[1.15rem] font-light text-ink">{pres.label}</h2>
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
