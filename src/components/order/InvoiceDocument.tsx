/**
 * InvoiceDocument — the branded printable invoice / receipt overlay.
 *
 * Extracted verbatim (markup + print CSS unchanged) from `TrackOrder`'s
 * former `InvoiceDoc`, so it can be shared by the token-gated `/track` page
 * and the authenticated customer portal's order detail page
 * (`/account/orders/:orderNumber`) without drift.
 */

import { Fragment, useEffect } from 'react';
import type { OrderInvoice, OrderInvoiceLine, OrderInvoiceCoupon } from '../../lib/tracking';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { tierPriceCents } from '../../lib/pricing';
import { siteConfig } from '../../config';
import { Button } from '../ui/Button';
import { allocateLineDiscounts } from '../../lib/lineDiscounts';

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

interface InvoiceDocumentProps {
  invoice: OrderInvoice;
  docKind: 'invoice' | 'receipt';
  onClose: () => void;
}

export function InvoiceDocument({ invoice: o, docKind, onClose }: InvoiceDocumentProps) {
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
  // Per-line discount allocation (render-time only — the stored per-coupon
  // discount_cents is authoritative; this just splits it across lines).
  const retailUnits = o.lines.map((l) => unitOf(l) ?? 0);
  const perLineDiscount = allocateLineDiscounts(o.lines, retailUnits, o.coupons ?? []);

  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } .print-doc, .print-doc * { visibility: visible !important; } .print-doc { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; } .no-print { display: none !important; } }`}</style>
      <div className="fixed inset-0 z-[300] bg-[color:var(--scrim)] backdrop-blur-[8px]" />
      <div className="fixed inset-0 z-[301] overflow-y-auto overscroll-contain p-4 sm:p-8" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className="print-doc mx-auto max-w-[760px] bg-white text-[#1A1714] shadow-[0_24px_60px_-20px_rgba(26,23,20,0.5)]">
          <div className="h-[3px] bg-[#B5904B]" />
          <div className="no-print flex items-center justify-between gap-3 border-b border-ink/10 px-6 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">{title} preview</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => window.print()}>Print / Save PDF</Button>
              <Button variant="secondary" size="sm" type="button" onClick={onClose}>Close</Button>
            </div>
          </div>
          <div className="px-5 py-8 sm:px-10 sm:py-10">
            <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[#1A1714]/10 pb-6">
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

            {/* Phones scroll the line-item table sideways instead of crushing
                the five money columns; print/desktop layout is unchanged. */}
            <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[480px] border-collapse">
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
                  const d = perLineDiscount[i];
                  const retailUnit = retailUnits[i];
                  const retailTotal = retailUnit * l.quantity;
                  const discTotal = retailTotal - d;
                  const discUnit = l.quantity > 0 ? Math.round(discTotal / l.quantity) : discTotal;
                  return (
                    <tr key={`${l.sku}-${i}`} className="border-b border-[#1A1714]/[0.08]">
                      <td className="py-2 pr-3 font-mono text-[11px] text-[#34727A]">{l.sku}</td>
                      <td className="py-2 pr-3 text-[12px] text-[#1A1714]">
                        {l.product_name}
                        {l.item_note && <span className="block text-[10.5px] text-[#9A9186]">{l.item_note}</span>}
                        {d > 0 && <span className="block text-[10.5px] text-[#34727A]">−{fmtUSD(d)}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{l.quantity}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-[#6B635A]">
                        {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailUnit)}</s> {fmtUSD(discUnit)}</> : fmtUSD(u))}
                      </td>
                      <td className="py-2 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">
                        {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailTotal)}</s> {fmtUSD(discTotal)}</> : fmtUSD(retailTotal))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

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
