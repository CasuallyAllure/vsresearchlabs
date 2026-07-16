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
import { siteConfig } from '../config';
import { Button } from '../components/ui/Button';
import { allocateLineDiscounts } from '../lib/lineDiscounts';
import { InvoiceDocument } from '../components/order/InvoiceDocument';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../components/ui/Field';

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

/** Order states where the shipping address can still be (re)confirmed. Once
 *  the order ships (fulfilled/shipped/delivered) or dies (cancelled/refunded)
 *  the confirm card disappears. */
function canConfirmAddress(status: string): boolean {
  return !['cancelled', 'refunded', 'fulfilled', 'shipped', 'delivered'].includes(status);
}

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

  // Per-line discount allocation (render-time only — the stored per-coupon
  // discount_cents is authoritative; this just splits it across lines).
  const retailUnits = o.lines.map((l) => unitOf(l) ?? 0);
  const perLineDiscount = allocateLineDiscounts(o.lines, retailUnits, o.coupons ?? []);

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
        <h1 className="font-serif text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
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
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35 mb-1">
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
                    className={`h-[6px] rounded-full transition-colors ${
                      reached ? 'bg-holo' : 'bg-ink/[0.08]'
                    }`}
                    style={isCurrent ? { boxShadow: '0 0 0 3px rgba(98,160,166,0.18)' } : undefined}
                    aria-current={isCurrent ? 'step' : undefined}
                  />
                  <span
                    className={`mt-1.5 block truncate text-[10px] uppercase tracking-[0.16em] ${
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

      {/* ── Shipping address double-confirm ──────────────────────────── */}
      {canConfirmAddress(o.status) && (
        <ConfirmAddressCard
          token={token}
          invoice={o}
          onConfirmed={(next) => setState({ kind: 'ok', invoice: next })}
        />
      )}

      {/* ── Tracking module — dedicated card, always present ─────────── */}
      {!isHandDelivered && (
        <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35 mb-[var(--space-2)]">
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
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35 mb-[var(--space-2)]">
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
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35">
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
            const d = perLineDiscount[i];
            const retailUnit = retailUnits[i];
            const retailTotal = retailUnit * l.quantity;
            const discTotal = retailTotal - d;
            const discUnit = l.quantity > 0 ? Math.round(discTotal / l.quantity) : discTotal;
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
                  {d > 0 && <p className="font-mono text-[10px] text-holo/80">−{fmtUSD(d)}</p>}
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-[10.5px] text-ink/50">
                    {l.quantity} × {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailUnit)}</s> {fmtUSD(discUnit)}</> : fmtUSD(u))}
                  </p>
                  <p className="text-[12.5px] text-ink/85">
                    {u == null ? '—' : (d > 0 ? <><s className="opacity-50">{fmtUSD(retailTotal)}</s> {fmtUSD(discTotal)}</> : fmtUSD(retailTotal))}
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

      {showDoc && <InvoiceDocument invoice={o} docKind={docKind} onClose={() => setShowDoc(false)} />}
    </>
  );
}

/* ── Shipping address double-confirm ────────────────────────────────────────── */

const addressFieldCls = [FIELD_SURFACE, FIELD_DEFAULT].join(' ');
const addressLabelCls =
  'block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]';

interface ConfirmShippingResult {
  ok: boolean;
  reason?: string;
  order_number?: string;
  ship_confirmed_at?: string;
}

type ConfirmStep = 'closed' | 'form' | 'review';

/**
 * ConfirmAddressCard — the buyer double-confirms the shipping address.
 *
 * Two explicit steps by design: step 1 collects/edits the address, step 2
 * renders it back verbatim with the non-returnable disclaimer, and only the
 * second click calls `confirm_order_shipping`. Re-confirming overwrites, so
 * a confirmed order shows a quiet state with an "Update address" reopener.
 */
function ConfirmAddressCard({
  token, invoice, onConfirmed,
}: {
  token: string;
  invoice: OrderInvoice;
  onConfirmed: (next: OrderInvoice) => void;
}) {
  const confirmed = !!invoice.ship_confirmed_at;
  const [step, setStep] = useState<ConfirmStep>(confirmed ? 'closed' : 'form');
  const [street, setStreet] = useState(invoice.ship_street ?? '');
  const [city, setCity] = useState(invoice.ship_city ?? '');
  const [stateRegion, setStateRegion] = useState(invoice.ship_state ?? '');
  const [zip, setZip] = useState(invoice.ship_zip ?? '');
  const [country, setCountry] = useState(invoice.ship_country ?? 'US');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConfirmed, setJustConfirmed] = useState(false);

  const streetOk = street.trim().length > 0;
  const cityOk = city.trim().length > 0;
  const zipOk = zip.trim().length > 0;
  const countryOk = country.trim().length > 0;
  const formOk = streetOk && cityOk && zipOk && countryOk;

  const confirmedDate = formatDate(invoice.ship_confirmed_at);

  function toReview() {
    setTouched(true);
    setError(null);
    if (!formOk) return;
    setStep('review');
  }

  async function confirmShipping() {
    setError(null);
    if (!supabase) {
      setError('Address confirmation is temporarily unavailable — please try again shortly.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_order_shipping', {
        p_token: token,
        p_street: street.trim(),
        p_city: city.trim(),
        p_state: stateRegion.trim(),
        p_zip: zip.trim(),
        p_country: country.trim(),
      });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as ConfirmShippingResult;
      if (!result.ok) {
        setError(result.reason ?? 'We could not confirm this address. Please try again.');
        return;
      }
      onConfirmed({
        ...invoice,
        ship_street: street.trim(),
        ship_city: city.trim(),
        ship_state: stateRegion.trim() || null,
        ship_zip: zip.trim(),
        ship_country: country.trim(),
        ship_confirmed_at: result.ship_confirmed_at ?? new Date().toISOString(),
      });
      setJustConfirmed(true);
      setStep('closed');
    } catch {
      setError('Something went wrong sending your confirmation — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  /* Quiet confirmed state — address on record + reopener. */
  if (step === 'closed') {
    return (
      <article id="confirm-address" className="research-surface-solid scroll-mt-24 p-[var(--space-5)] mb-[var(--space-4)]">
        <div className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-2 mb-[var(--space-3)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35">
            Shipping address
          </p>
          <span className="rounded-full border border-ink/10 bg-[color:var(--color-status-successMuted)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-status-success)]">
            Address confirmed{confirmedDate ? ` · ${confirmedDate}` : ''}
          </span>
        </div>
        {justConfirmed && (
          <p className="mb-[var(--space-3)] text-[12.5px] text-ink/75">
            Thank you — your order will ship to the address below.
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-ink/80">
          {invoice.ship_street}<br />
          {[invoice.ship_city, invoice.ship_state, invoice.ship_zip].filter(Boolean).join(', ')}<br />
          {invoice.ship_country}
        </p>
        <button
          type="button"
          onClick={() => { setJustConfirmed(false); setStep('form'); }}
          className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.16em] text-holo-light underline underline-offset-2 hover:text-holo transition-colors"
        >
          Update address
        </button>
      </article>
    );
  }

  /* Step 2 — verbatim review + disclaimer. Only this step calls the RPC. */
  if (step === 'review') {
    return (
      <article id="confirm-address" className="research-surface-solid scroll-mt-24 border border-gold/40 p-[var(--space-5)] mb-[var(--space-4)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-ink/35 mb-[var(--space-2)]">
          Confirm shipping address · Step 2 of 2
        </p>
        <h2 className="text-[1.05rem] font-medium text-ink leading-snug mb-[var(--space-3)]">
          Ship to exactly this address?
        </h2>
        <div className="rounded-sm border border-ink/[0.10] bg-base-800 px-[var(--space-4)] py-[var(--space-3)] mb-[var(--space-4)]">
          <p className="text-[14px] leading-relaxed text-ink">
            {street.trim()}<br />
            {[city.trim(), stateRegion.trim(), zip.trim()].filter(Boolean).join(', ')}<br />
            {country.trim()}
          </p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink/75 mb-[var(--space-4)] max-w-[58ch]">
          Research compounds are <strong className="text-ink">non-returnable</strong>. We are{' '}
          <strong className="text-ink">not responsible</strong> for orders sent to a wrong or
          incomplete address you provided — no reships, no refunds for address errors.
        </p>
        {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}
        <div className="flex flex-col-reverse gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-end">
          <Button variant="secondary" size="md" type="button" disabled={submitting} onClick={() => setStep('form')}>
            ← Edit
          </Button>
          <Button variant="primary" size="md" type="button" disabled={submitting} onClick={confirmShipping}>
            {submitting ? 'Confirming…' : 'Yes — ship to this address'}
          </Button>
        </div>
      </article>
    );
  }

  /* Step 1 — the address form (prominent "action needed" framing). */
  return (
    <article id="confirm-address" className="research-surface-solid scroll-mt-24 border border-gold/40 p-[var(--space-5)] mb-[var(--space-4)]">
      <p className="holo-text-caption text-[10px] uppercase tracking-[0.26em] text-gold mb-[var(--space-2)]">
        {confirmed ? 'Update shipping address' : 'Action needed'}
      </p>
      <h2 className="text-[1.05rem] font-medium text-ink leading-snug">
        {confirmed ? 'Update your shipping address.' : 'Confirm your shipping address.'}
      </h2>
      <p className="mt-1.5 mb-[var(--space-4)] text-[12.5px] leading-relaxed text-ink/65 max-w-[58ch]">
        We ship to the address you confirm here — please double-check every line.
        You'll review it once more before it's locked in.
      </p>

      <div className="space-y-[var(--space-4)]">
        <div>
          <label htmlFor="confirm-street" className={addressLabelCls}>Street address *</label>
          <input
            id="confirm-street"
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            autoComplete="street-address"
            placeholder="123 Main Street, Apt 4B"
            className={addressFieldCls}
          />
          {touched && !streetOk && <p className="mt-1 text-[11px] text-red-400">Street address is required.</p>}
        </div>
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-[1fr_100px_140px]">
          <div>
            <label htmlFor="confirm-city" className={addressLabelCls}>City *</label>
            <input
              id="confirm-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
              placeholder="Sacramento"
              className={addressFieldCls}
            />
            {touched && !cityOk && <p className="mt-1 text-[11px] text-red-400">City is required.</p>}
          </div>
          <div>
            <label htmlFor="confirm-state" className={addressLabelCls}>State</label>
            <input
              id="confirm-state"
              type="text"
              value={stateRegion}
              onChange={(e) => setStateRegion(e.target.value.toUpperCase())}
              maxLength={2}
              autoComplete="address-level1"
              placeholder="CA"
              className={`${addressFieldCls} uppercase`}
            />
          </div>
          <div>
            <label htmlFor="confirm-zip" className={addressLabelCls}>ZIP *</label>
            <input
              id="confirm-zip"
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder="95814"
              className={addressFieldCls}
            />
            {touched && !zipOk && <p className="mt-1 text-[11px] text-red-400">ZIP is required.</p>}
          </div>
        </div>
        <div>
          <label htmlFor="confirm-country" className={addressLabelCls}>Country *</label>
          <input
            id="confirm-country"
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            autoComplete="country"
            placeholder="US"
            className={addressFieldCls}
          />
          {touched && !countryOk && <p className="mt-1 text-[11px] text-red-400">Country is required.</p>}
        </div>
      </div>

      {error && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

      <div className="mt-[var(--space-5)] flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-end">
        {confirmed && (
          <Button variant="secondary" size="md" type="button" onClick={() => setStep('closed')}>
            Cancel
          </Button>
        )}
        <Button variant="primary" size="md" type="button" onClick={toReview}>
          Continue — review address
        </Button>
      </div>
    </article>
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
        <h1 className="font-serif text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
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
            <input id="track-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={siteConfig.order.trackingPlaceholder} autoComplete="off" className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')} />
          </div>
          <div>
            <label htmlFor="track-zip" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Shipping ZIP</label>
            <input id="track-zip" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="85001" autoComplete="off" className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')} />
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
                <div className={`h-[6px] rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/[0.08]'}`} aria-current={i === pres.step ? 'step' : undefined} />
                <span className={`mt-1.5 block truncate text-[10px] uppercase tracking-[0.14em] ${reached ? 'text-ink/70' : 'text-ink/35'}`}>{label}</span>
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
