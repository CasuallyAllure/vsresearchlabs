/**
 * AccountOrderDetail — /account/orders/:orderNumber
 *
 * One owned order's full detail via `get_my_order` (RLS-equivalent RPC —
 * predicate is `orders.user_id = auth.uid()`). Same payload shape as the
 * token-gated `/track` invoice (`OrderInvoice`, `src/lib/tracking.ts`), plus
 * `found`; renders the status step bar, payment status, itemized lines +
 * discounts, carrier tracking, shipping address, and the shared
 * `InvoiceDocument` for print/download.
 */

import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { getMyOrder, type MyOrderResult } from '../../lib/accountData';
import {
  carrierLabel,
  carrierRequiresTracking,
  carrierTrackingUrl,
  statusPresentation,
  STATUS_STEPS,
  type OrderInvoiceCoupon,
} from '../../lib/tracking';
import { allocateLineDiscounts } from '../../lib/lineDiscounts';
import { InvoiceDocument } from '../../components/order/InvoiceDocument';
import { useCustomerAuth } from '../../lib/customerAuth';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';

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

/** Discount-line label for an applied coupon — matches the admin editor + email. */
function invoiceCouponLabel(c: OrderInvoiceCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.code} · ${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `${c.code} · $${(c.amount_cents / 100).toFixed(2)} off`;
  return `${c.code} · Free ${c.free_label ?? 'item'}`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; order: Extract<MyOrderResult, { found: true }> };

function AccountOrderDetailContent({ orderNumber }: { orderNumber: string }) {
  const { profile } = useCustomerAuth();
  const memberFreeShipping = profile?.free_shipping === true;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [showDoc, setShowDoc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState({ kind: 'loading' });
      const { data, error } = await getMyOrder(orderNumber);
      if (cancelled) return;
      if (error) {
        setState({ kind: 'error', message: error });
        return;
      }
      if (!data || !data.found) {
        setState({ kind: 'notFound' });
        return;
      }
      setState({ kind: 'ok', order: data });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  if (state.kind === 'loading') {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading order…</p>;
  }
  if (state.kind === 'error') {
    return <ErrorState message={state.message} />;
  }
  if (state.kind === 'notFound') {
    return (
      <EmptyState
        label="We couldn't find that order on your account."
        meta={orderNumber}
        action={
          <Link to="/account/orders" className="text-[11px] uppercase tracking-[0.18em] text-teal hover:text-teal-dark transition-colors">
            ← Back to order history
          </Link>
        }
      />
    );
  }

  const o = state.order;
  const pres = statusPresentation(o.status);
  const url = carrierTrackingUrl(o.carrier, o.tracking_number);
  const docKind: 'invoice' | 'receipt' = o.paid ? 'receipt' : 'invoice';
  const placed = formatDate(o.placed_at);
  const shipped = formatDate(o.shipped_at);
  const delivered = formatDate(o.delivered_at);
  const hasTrackingCarrier = carrierRequiresTracking(o.carrier);

  // No catalog-price fallback here (unlike /track's invoice doc) — new
  // orders always carry a stored `unit_price_cents`, and this is a brand new
  // surface, so there's no legacy-order gap to paper over.
  const retailUnits = o.lines.map((l) => l.unit_price_cents ?? 0);
  const perLineDiscount = allocateLineDiscounts(o.lines, retailUnits, o.coupons ?? []);
  const hasDiscounts = (o.coupons ?? []).some((c) => c.discount_cents > 0);

  return (
    <>
      <div className="mb-[var(--space-4)]">
        <Link to="/account/orders" className="text-[11px] uppercase tracking-[0.18em] text-ink/45 hover:text-ink/75 transition-colors">
          ← Order history
        </Link>
      </div>

      <header className="mb-[var(--space-5)]">
        <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Order </span>
          <span className="font-light text-ink">{o.order_number}</span>
        </h2>
        {placed && (
          <p className="mt-[var(--space-2)] text-[12px] text-ink/55">
            <span className="mr-1 uppercase tracking-[0.14em] text-ink/35">Placed</span>{placed}
          </p>
        )}
      </header>

      {/* Status + payment */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <p className="holo-text-caption mb-1 text-[10px] uppercase tracking-[0.26em] text-ink/35">Status</p>
        <h3 className="text-[1.05rem] font-medium leading-snug text-ink">{pres.label}</h3>
        {pres.detail && <p className="mt-1.5 max-w-[58ch] text-[12.5px] leading-relaxed text-ink/65">{pres.detail}</p>}
        <p className="mt-2 text-[11.5px] text-ink/55">
          <span className="mr-1 uppercase tracking-[0.16em] text-ink/35">Payment</span>
          {o.paid ? 'Paid' : o.payment_method ? `Due · pay via ${o.payment_method}` : 'Due'}
        </p>

        {pres.tone !== 'stopped' && (
          <ol className="mt-[var(--space-4)] flex items-stretch gap-1" aria-label="Order progress">
            {STATUS_STEPS.map((label, i) => {
              const reached = i <= pres.step;
              const isCurrent = i === pres.step;
              return (
                <li key={label} className="min-w-0 flex-1">
                  <div className={`h-1.5 rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/12'}`} aria-current={isCurrent ? 'step' : undefined} />
                  <span className={`mt-1.5 block truncate text-[10px] uppercase tracking-[0.16em] ${reached ? (isCurrent ? 'font-medium text-ink' : 'text-ink/70') : 'text-ink/30'}`}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </article>

      {/* Carrier tracking */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/35">
          {hasTrackingCarrier ? 'Carrier tracking' : 'Delivery method'}
        </p>
        {!hasTrackingCarrier ? (
          <p className="text-[12.5px] leading-relaxed text-ink/75">
            <strong className="text-ink">Hand delivery</strong>
            {delivered ? ` — delivered ${delivered}.` : ' — we’ll reach out to coordinate the handoff.'}
          </p>
        ) : o.tracking_number ? (
          <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.18em] text-ink/45">{carrierLabel(o.carrier)}</p>
              <p className="mt-1 break-all font-mono text-[15px] leading-tight tabular-nums text-ink">{o.tracking_number}</p>
              {(shipped || delivered) && (
                <p className="mt-1.5 text-[11px] text-ink/55">{delivered ? `Delivered ${delivered}` : shipped ? `Shipped ${shipped}` : null}</p>
              )}
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-full border border-holo/40 bg-holo/[0.15] px-[var(--space-5)] py-[var(--space-2)] text-[10px] font-medium uppercase tracking-[0.2em] text-holo-light transition-colors hover:bg-holo/[0.22]"
              >
                Track on {carrierLabel(o.carrier)} ↗
              </a>
            )}
          </div>
        ) : (
          <EmptyState label="Tracking not yet available." meta="You'll get an email the moment your order ships." />
        )}
      </article>

      {/* Discounts applied */}
      {hasDiscounts && (
        <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
          <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/35">Discounts applied</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[12.5px]">
            {(o.coupons ?? []).filter((c) => c.discount_cents > 0).map((c) => (
              <Fragment key={c.code}>
                <dt className="text-ink/80">{invoiceCouponLabel(c)}</dt>
                <dd className="text-right font-mono tabular-nums text-teal">−{fmtUSD(c.discount_cents)}</dd>
              </Fragment>
            ))}
          </dl>
        </article>
      )}

      {/* Line items + totals */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.26em] text-ink/35">Items</p>
        <ul className="divide-y divide-ink/[0.05] rounded-[14px] border border-ink/[0.08] overflow-hidden">
          {o.lines.map((l, i) => {
            const u = l.unit_price_cents;
            const d = perLineDiscount[i];
            const retailUnit = retailUnits[i];
            const retailTotal = retailUnit * l.quantity;
            const discTotal = retailTotal - d;
            const discUnit = l.quantity > 0 ? Math.round(discTotal / l.quantity) : discTotal;
            return (
              <li key={`${l.sku}-${i}`} className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
                  <p className="truncate font-mono text-[10px] text-holo-light/70">
                    {l.sku}{l.item_note ? ` · ${l.item_note}` : ''}
                  </p>
                  {d > 0 && <p className="font-mono text-[10px] text-holo/80">−{fmtUSD(d)}</p>}
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-[12px] text-ink/50">
                    {l.quantity} × {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailUnit)}</s> {fmtUSD(discUnit)}</> : fmtUSD(u))}
                  </p>
                  <p className="text-[12.5px] text-ink/85">
                    {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailTotal)}</s> {fmtUSD(discTotal)}</> : fmtUSD(retailTotal))}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-[var(--space-4)] flex justify-end">
          <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1 text-[12px]">
            <dt className="text-ink/55">Subtotal</dt>
            <dd className="text-right font-mono tabular-nums text-ink">{fmtUSD(o.subtotal_cents)}</dd>
            <dt className="text-ink/55">Shipping</dt>
            <dd className="text-right font-mono tabular-nums text-ink">{fmtUSD(o.shipping_cents)}</dd>
            <dt className="border-t border-ink/15 pt-1 text-ink">{o.paid ? 'Paid' : 'Total due'}</dt>
            <dd className="border-t border-ink/15 pt-1 text-right font-mono text-[14px] tabular-nums text-ink">{fmtUSD(o.total_cents)}</dd>
          </dl>
        </div>
        <button
          type="button"
          onClick={() => setShowDoc(true)}
          className="mt-[var(--space-4)] rounded-full border border-ink/25 bg-ink/[0.05] px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] text-ink/80 transition-colors hover:border-ink/40 hover:bg-ink/[0.10]"
        >
          View / print {docKind}
        </button>
      </article>

      {/* Shipping address */}
      <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/35">Shipping address</p>
        {o.ship_street ? (
          <p className="text-[13px] leading-relaxed text-ink/80">
            {o.ship_street}<br />
            {[o.ship_city, o.ship_state, o.ship_zip].filter(Boolean).join(', ')}<br />
            {o.ship_country}
          </p>
        ) : (
          <p className="text-[12.5px] text-ink/50">No shipping address on file for this order.</p>
        )}
      </article>

      {showDoc && <InvoiceDocument invoice={o} docKind={docKind} onClose={() => setShowDoc(false)} memberFreeShipping={memberFreeShipping} />}
    </>
  );
}

export function AccountOrderDetail() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  return (
    <AccountLayout>
      {orderNumber ? (
        <AccountOrderDetailContent orderNumber={orderNumber} />
      ) : (
        <ErrorState message="No order number was provided." />
      )}
    </AccountLayout>
  );
}

export default AccountOrderDetail;
