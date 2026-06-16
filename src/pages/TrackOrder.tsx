/**
 * TrackOrder — public order-status + invoice / receipt view.
 *
 * Two-tier, ZIP-gated read of the customer's own order:
 *
 *   1. Order number OR email + shipping ZIP  → the status card: live status
 *      stepper, carrier tracking, and the invoice totals (amount due, or amount
 *      paid once it clears). Backed by the `lookup_order` RPC (migrations 012 +
 *      016) — no address, no PII.
 *
 *   2. "View full details" prompts for the order number (a second factor) and
 *      unlocks the itemized breakdown + a branded, printable document. That
 *      document is an INVOICE while unpaid and flips to a RECEIPT (marked PAID)
 *      once payment clears. Backed by the `lookup_order_lines` RPC (016).
 *
 * The customer can view and print, but never mutate — all status changes stay
 * on the admin side.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  carrierLabel,
  carrierTrackingUrl,
  statusPresentation,
  STATUS_STEPS,
  type OrderLookupResult,
  type OrderLineResult,
} from '../lib/tracking';
import productsData from '../data/products.json';
import generatedCompounds from '../data/biopeptideCompounds.generated.json';
import type { Product } from '../types';
import { tierPriceCents } from '../lib/pricing';

/** SKU → catalog product, for resolving a unit price when a line has none
 *  stored (variant-aware: the dose in the item name/note drives the tier). */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}

function unitOf(l: OrderLineResult): number | null {
  if (l.unit_price_cents != null) return l.unit_price_cents;
  const p = productBySku.get(l.sku);
  if (p) {
    const c = tierPriceCents(p, l.item_note || l.product_name || '');
    if (c != null) return c;
  }
  return null;
}

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: OrderLookupResult[] }
  | { kind: 'error'; message: string };

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
  const [identifier, setIdentifier] = useState('');
  const [zip, setZip] = useState('');
  const [state, setState] = useState<LookupState>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = identifier.trim();
    const z = zip.trim();
    if (!id || !z) return;
    if (!supabase) {
      setState({ kind: 'error', message: 'Order tracking is temporarily unavailable.' });
      return;
    }
    setState({ kind: 'loading' });
    const { data, error } = await supabase.rpc('lookup_order', { p_identifier: id, p_zip: z });
    if (error) {
      setState({ kind: 'error', message: error.message });
      return;
    }
    setState({ kind: 'done', results: (data ?? []) as OrderLookupResult[] });
  }

  return (
    <section className="py-[var(--space-8)] max-w-[760px] mx-auto px-[var(--space-4)]">
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">Order status</p>
        <h1 className="text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Track your </span>
          <span className="font-medium text-ink">order.</span>
        </h1>
        <p className="mt-[var(--space-3)] text-[13px] leading-relaxed text-ink/70 max-w-[58ch]">
          Enter your order number or the email you ordered with, plus the shipping ZIP code.
          You can view your invoice or receipt and print it from here.
        </p>
      </header>

      <form onSubmit={onSubmit} className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)]">
        <div className="grid gap-[var(--space-4)] sm:grid-cols-[1fr_140px]">
          <div>
            <label htmlFor="track-id" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">
              Order number or email
            </label>
            <input
              id="track-id"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="VSR-ORD-… or your email"
              autoComplete="off"
              className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
            />
          </div>
          <div>
            <label htmlFor="track-zip" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">
              Shipping ZIP
            </label>
            <input
              id="track-zip"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="85001"
              autoComplete="off"
              className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
            />
          </div>
        </div>
        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">
          <button
            type="submit"
            disabled={state.kind === 'loading' || !identifier.trim() || !zip.trim()}
            className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.kind === 'loading' ? 'Searching…' : 'Track'}
          </button>
        </div>
        {state.kind === 'error' && (
          <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{state.message}</p>
        )}
      </form>

      {state.kind === 'done' && state.results.length === 0 && (
        <div className="research-surface-solid p-[var(--space-5)]">
          <p className="text-[13px] text-ink/75">
            No order found with that order number/email and ZIP. Double-check the ZIP matches the
            shipping address, or <a href="/contact" className="text-holo-light underline underline-offset-2">contact us</a>.
          </p>
        </div>
      )}

      {state.kind === 'done' && state.results.map((order) => (
        <OrderCard key={order.order_number} order={order} zip={zip.trim()} />
      ))}
    </section>
  );
}

function OrderCard({ order, zip }: { order: OrderLookupResult; zip: string }) {
  const pres = statusPresentation(order.status);
  const url = carrierTrackingUrl(order.carrier, order.tracking_number);
  const placed = formatDate(order.placed_at);
  const shipped = formatDate(order.shipped_at);
  const delivered = formatDate(order.delivered_at);
  const hasInvoice = order.total_cents != null;
  const docKind: 'invoice' | 'receipt' = order.paid ? 'receipt' : 'invoice';

  // Full-details (line items) gate — second factor is the order number.
  const [detailOpen, setDetailOpen] = useState(false);
  const [orderNumInput, setOrderNumInput] = useState('');
  const [lines, setLines] = useState<OrderLineResult[] | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showDoc, setShowDoc] = useState(false);

  async function unlockDetails(e: React.FormEvent) {
    e.preventDefault();
    const num = orderNumInput.trim();
    if (!num || !supabase) return;
    setDetailState('loading');
    setDetailError(null);
    const { data, error } = await supabase.rpc('lookup_order_lines', { p_order_number: num, p_zip: zip });
    if (error) {
      setDetailState('error');
      setDetailError(error.message);
      return;
    }
    const rows = (data ?? []) as OrderLineResult[];
    if (rows.length === 0) {
      setDetailState('error');
      setDetailError("That order number doesn't match this order. Check it against your invoice email.");
      return;
    }
    setLines(rows);
    setDetailState('idle');
  }

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

      {/* Progress stepper */}
      {pres.tone !== 'stopped' && (
        <ol className="flex items-center gap-1 mb-[var(--space-4)]" aria-label="Order progress">
          {STATUS_STEPS.map((label, i) => {
            const reached = i <= pres.step;
            return (
              <li key={label} className="flex-1 min-w-0">
                <div
                  className={`h-1 rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/12'}`}
                  aria-current={i === pres.step ? 'step' : undefined}
                />
                <span className={`mt-1 block truncate text-[9px] uppercase tracking-[0.14em] ${reached ? 'text-ink/70' : 'text-ink/35'}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Invoice / receipt totals — shown once an invoice exists */}
      {hasInvoice && (
        <div className="border-t border-ink/[0.08] pt-[var(--space-4)]">
          <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">
                {order.paid ? 'Amount paid' : 'Amount due'}
              </p>
              <p className="font-mono text-[1.25rem] tabular-nums text-ink">{fmtUSD(order.total_cents)}</p>
              {order.subtotal_cents != null && (
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                  Subtotal {fmtUSD(order.subtotal_cents)} · Shipping {fmtUSD(order.shipping_cents ?? 0)}
                </p>
              )}
            </div>
            {order.paid ? (
              <span className="rounded-sm border border-[#2E7D5B]/45 bg-[#2E7D5B]/[0.08] px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] text-[#2E7D5B]">
                Paid
              </span>
            ) : (
              order.payment_method && (
                <p className="text-[11px] text-ink/55 max-w-[24ch] sm:text-right">
                  <span className="uppercase tracking-[0.16em] text-ink/35">Pay via</span><br />{order.payment_method}
                </p>
              )
            )}
          </div>

          {/* View full details — gated by order number */}
          {lines ? (
            <div className="mt-[var(--space-4)]">
              <ul className="divide-y divide-ink/[0.05] rounded-sm border border-ink/[0.08]">
                {lines.map((l, i) => {
                  const u = unitOf(l);
                  const lt = u == null ? null : u * l.quantity;
                  return (
                    <li key={`${l.sku}-${i}`} className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
                        <p className="truncate font-mono text-[10px] text-holo-light/70">
                          {l.sku}{l.item_note ? ` · ${l.item_note}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-mono tabular-nums">
                        <p className="text-[10.5px] text-ink/50">{l.quantity} × {fmtUSD(u)}</p>
                        <p className="text-[12.5px] text-ink/85">{fmtUSD(lt)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => setShowDoc(true)}
                className="mt-[var(--space-3)] rounded-full border border-ink/25 bg-ink/[0.05] px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] text-ink/80 hover:border-ink/40 hover:bg-ink/[0.10] transition-colors"
              >
                View / print {docKind}
              </button>
            </div>
          ) : detailOpen ? (
            <form onSubmit={unlockDetails} className="mt-[var(--space-4)] border-t border-ink/[0.06] pt-[var(--space-4)]">
              <label htmlFor={`detail-${order.order_number}`} className="block text-[10px] uppercase tracking-[0.18em] text-ink/45 mb-[var(--space-2)]">
                Confirm your order number to see the itemized {docKind}
              </label>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <input
                  id={`detail-${order.order_number}`}
                  value={orderNumInput}
                  onChange={(e) => setOrderNumInput(e.target.value)}
                  placeholder="VSR-ORD-…"
                  autoComplete="off"
                  className="min-w-[180px] flex-1 rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
                />
                <button
                  type="submit"
                  disabled={detailState === 'loading' || !orderNumInput.trim()}
                  className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {detailState === 'loading' ? 'Checking…' : 'Unlock'}
                </button>
              </div>
              {detailError && <p role="alert" className="mt-[var(--space-2)] text-[12px] text-red-400">{detailError}</p>}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.16em] text-holo-light hover:text-holo transition-colors"
            >
              View full details →
            </button>
          )}
        </div>
      )}

      {/* Tracking */}
      {order.tracking_number ? (
        <div className="flex items-center justify-between gap-[var(--space-4)] flex-wrap border-t border-ink/[0.08] pt-[var(--space-4)] mt-[var(--space-4)]">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{carrierLabel(order.carrier)} tracking</p>
            <p className="font-mono text-[12px] text-ink/80 break-all">{order.tracking_number}</p>
            {(shipped || delivered) && (
              <p className="mt-1 text-[11px] text-ink/45">
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
              Track on {carrierLabel(order.carrier)} ↗
            </a>
          )}
        </div>
      ) : (
        pres.step >= 3 && (
          <p className="border-t border-ink/[0.08] pt-[var(--space-4)] mt-[var(--space-4)] text-[12px] text-ink/55">
            A tracking number will appear here once it’s posted.
          </p>
        )
      )}

      {showDoc && lines && (
        <ClientInvoiceDoc order={order} lines={lines} docKind={docKind} onClose={() => setShowDoc(false)} />
      )}
    </article>
  );
}

/* ── Branded, printable invoice / receipt ─────────────────────────────────── */

function ClientInvoiceDoc({
  order, lines, docKind, onClose,
}: {
  order: OrderLookupResult;
  lines: OrderLineResult[];
  docKind: 'invoice' | 'receipt';
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const computedSub = order.subtotal_cents ?? lines.reduce((a, l) => {
    const u = unitOf(l);
    return a + (u == null ? 0 : u * l.quantity);
  }, 0);
  const shipping = order.shipping_cents ?? 0;
  const total = order.total_cents ?? computedSub + shipping;
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
                <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#6B635A]">{order.order_number}</p>
                <p className="font-mono text-[10px] tabular-nums text-[#9A9186]">{formatDate(order.placed_at)}</p>
                {docKind === 'receipt' && (
                  <p className="mt-1.5 inline-block rounded-sm border border-[#2E7D5B]/45 bg-[#2E7D5B]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#2E7D5B]">Paid</p>
                )}
              </div>
            </div>

            <table className="mt-6 w-full border-collapse">
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
                {lines.map((l, i) => {
                  const u = unitOf(l);
                  return (
                    <tr key={`${l.sku}-${i}`} className="border-b border-[#1A1714]/[0.08]">
                      <td className="py-2 pr-3 font-mono text-[11px] text-[#34727A]">{l.sku}</td>
                      <td className="py-2 pr-3 text-[12px] text-[#1A1714]">
                        {l.product_name}
                        {l.item_note && <span className="block text-[10.5px] text-[#9A9186]">{l.item_note}</span>}
                      </td>
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

            {docKind === 'invoice' && order.payment_method && (
              <p className="mt-6 rounded-sm border border-[#1A1714]/10 bg-[#1A1714]/[0.02] px-4 py-3 text-[11.5px] text-[#6B635A]">
                <span className="font-mono uppercase tracking-[0.16em] text-[#9A9186]">Payment</span><br />
                Pay via {order.payment_method}. Your order ships once payment clears.
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
