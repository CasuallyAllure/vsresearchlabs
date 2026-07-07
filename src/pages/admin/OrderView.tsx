/**
 * OrderView
 *
 * One order, rendered like an invoice — used both inside a modal (clicked
 * from the Orders list) and as the full page at /admin/orders/:id. Single
 * source of truth for "how an order looks".
 *
 * Layout mirrors a real invoice: a compact order # + date header, buyer on the
 * left / amounts on the right (equal columns), an itemized list with unit +
 * line totals, then a subtotal/shipping/total footer.
 *
 * The lifecycle is a Salesforce-style status bar: Order received → Invoice
 * sent → Payment received → Shipped → Delivered. The current stage's segment
 * carries everything you need right there — an inline notes box, a "← back a
 * step" control, the forward action, and a context re-notify. Cancel is the one
 * separate button. Every advance / revert / note appends to the order_events
 * timeline (which also prints on the invoice).
 *
 * View / print invoice → a branded, print-to-PDF document. Send to client →
 * re-sends the current invoice email.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrderStatusChip } from './AdminOrders';
import { CARRIERS, carrierRequiresTracking } from '../../lib/tracking';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { tierPriceCents, effectiveTierPriceCents } from '../../lib/pricing';
import { isVariantPublic, useProductOverrides } from '../../lib/productOverrides';
import { useConfirm } from '../../components/admin/ConfirmModal';
import { siteConfig } from '../../config';
import { PAYMENT_CONFIG } from '../../lib/payment';
import { AdminCouponPicker } from './AdminCouponPicker';

/** SKU → catalog product, for resolving a unit price when an order line has no
 *  stored price yet (variant-aware: the dose in the item name drives the tier). */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}

/** The meaningful tail of a SKU — "VSR-RS-5AMQ" → "5AMQ". The shared prefix
 *  doesn't identify the product, so the admin line editor only shows this. */
function skuSuffix(sku: string): string {
  const parts = sku.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : sku;
}

/** A pickable (product, dose) variant with its real admin-set price. */
interface VariantOption {
  sku: string;
  dose: string;
  /** "5-Amino-1MQ — 10mg" — the human label the admin searches by. */
  name: string;
  priceCents: number;
  family: string;
}

type OrderStatus =
  | 'pending_review' | 'pending_invoice' | 'invoice_sent' | 'payment_claimed'
  | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

interface OrderRecord {
  id: string;
  order_number: string;
  status: OrderStatus;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  notes: string | null;
  invoice_url: string | null;
  invoice_amount_cents: number | null;
  subtotal_cents: number | null;
  coupon_code: string | null;
  shipping_cents: number | null;
  payment_method: string | null;
  tracking_number: string | null;
  carrier: string | null;
  cancellation_reason: string | null;
  ship_street: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  invoiced_at: string | null;
  payment_claimed_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  lookup_token: string | null;
}

interface OrderLine {
  id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
  fast_ship: boolean | null;
}

interface OrderEvent {
  id: string;
  stage: string | null;
  kind: string;
  note: string | null;
  created_at: string;
}

const ORDER_SELECT =
  'id, order_number, status, buyer_name, buyer_contact, buyer_organization, notes, invoice_url, invoice_amount_cents, subtotal_cents, shipping_cents, payment_method, tracking_number, carrier, cancellation_reason, ship_street, ship_city, ship_state, ship_zip, ship_country, invoiced_at, payment_claimed_at, paid_at, fulfilled_at, shipped_at, delivered_at, cancelled_at, created_at, coupon_code, lookup_token';

/** Effective unit price: the stored line price, else the catalog tier price
 *  derived from the dose in the item name/note (so RETA 5 mg vs BPC-157 differ). */
function unitOf(l: OrderLine): number | null {
  if (l.unit_price_cents != null) return l.unit_price_cents;
  const p = productBySku.get(l.sku);
  if (p) {
    const c = tierPriceCents(p, l.item_note || l.product_name || '');
    if (c != null) return c;
  }
  return null;
}

/* ── Stage model ──────────────────────────────────────────────────────────── */

type StageKey = 'received' | 'invoiced' | 'claimed' | 'paid' | 'shipped' | 'delivered';

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'received',  label: 'Order received' },
  { key: 'invoiced',  label: 'Invoice sent' },
  { key: 'claimed',   label: 'Payment sent' },
  { key: 'paid',      label: 'Payment received' },
  { key: 'shipped',   label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

// Buyer notification fired automatically when an order advances into each
// stage. Payment received → "order processing"; shipped → tracking; delivered
// → receipt. Stages without an entry (received / invoiced / claimed) are
// notified through their own dedicated paths, not here.
const STAGE_EMAIL: Partial<Record<StageKey, string>> = {
  paid:      'send-processing-notification',
  shipped:   'send-shipment-notification',
  delivered: 'send-delivered-notification',
};

function reachedMap(o: OrderRecord): Record<StageKey, boolean> {
  return {
    received: true,
    // A claimed/paid payment implies the order was invoiced — a buyer can't
    // claim payment on an order that was never invoiced. Treating
    // payment_claimed_at as proof-of-invoice prevents the action panel from
    // getting stuck on "send invoice" if the status drifts.
    invoiced: !!o.invoiced_at || !!o.payment_claimed_at || ['invoice_sent', 'payment_claimed', 'paid', 'fulfilled'].includes(o.status),
    // "Payment sent" = buyer clicked the I've-sent-payment link (buyer-asserted).
    claimed: !!o.payment_claimed_at || ['payment_claimed', 'paid', 'fulfilled'].includes(o.status),
    paid: !!o.paid_at || ['paid', 'fulfilled'].includes(o.status),
    shipped: !!o.fulfilled_at || o.status === 'fulfilled',
    delivered: !!o.delivered_at,
  };
}

/* ── Component ────────────────────────────────────────────────────────────── */

export function OrderView({
  orderId, onChanged,
}: { orderId: string; onChanged?: () => void }) {
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [eventsUnavailable, setEventsUnavailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editWarn, setEditWarn] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  // In-app confirmation. Native window.confirm()/prompt() are unreliable on
  // mobile — iOS silently suppresses them once the user taps "Block Alerts" —
  // which made "Mark shipped" (and other confirmed actions) do nothing. This
  // modal can't be blocked by the browser.
  const { confirm, prompt, modal: confirmModal } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); return; }
      const [o, l] = await Promise.all([
        supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).single(),
        supabase.from('order_lines').select('id, sku, product_name, quantity, unit_price_cents, item_note, fast_ship').eq('order_id', orderId),
      ]);
      if (cancelled) return;
      if (o.error) { setError(o.error.message); return; }
      setOrder(o.data as OrderRecord);
      setLines((l.data ?? []) as OrderLine[]);
      const ev = await supabase.from('order_events')
        .select('id, stage, kind, note, created_at').eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setEvents(ev.error ? [] : ((ev.data ?? []) as OrderEvent[]));
      setEventsUnavailable(!!ev.error);
    }
    load();
    return () => { cancelled = true; };
  }, [orderId, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // While waiting on buyer payment confirmation, poll so the admin view
  // updates automatically when the buyer presses "I've sent payment".
  useEffect(() => {
    if (!order || order.status !== 'invoice_sent') return;
    const id = setInterval(reload, 20_000);
    return () => clearInterval(id);
  }, [order?.status, reload]);

  const logEvent = useCallback(async (stage: StageKey | null, kind: string, note: string | null) => {
    if (!supabase) return;
    await supabase.from('order_events').insert({ order_id: orderId, stage, kind, note });
  }, [orderId]);

  // Append an event optimistically (shows instantly even before migration 014),
  // then best-effort persist. No reload, so the local entry survives.
  const addEvent = useCallback(async (stage: StageKey | null, kind: string, note: string) => {
    const optimistic: OrderEvent = {
      id: `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      stage, kind, note, created_at: new Date().toISOString(),
    };
    setEvents((prev) => [...prev, optimistic]);
    await logEvent(stage, kind, note);
  }, [logEvent]);

  const run = useCallback(async (
    rpc: () => PromiseLike<{ error: { message: string } | null }>,
    ev: { stage: StageKey | null; kind: string; note: string | null; silent?: boolean },
    confirmMsg?: string,
  ) => {
    if (confirmMsg) {
      const ok = await confirm(confirmMsg);
      if (!ok) return false;
    }
    if (!supabase || !order) return false;
    setBusy(true);
    setActionError(null);
    // Everything is wrapped so a thrown rpc()/invoke() (e.g. a flaky mobile
    // network) can never leave the UI stuck in `busy` with the buttons
    // disabled — `finally` always clears it and reloads.
    try {
      const { error } = await rpc();
      if (error) { setActionError(error.message); return false; }
      await logEvent(ev.stage, ev.kind, ev.note);
      // Fire the buyer notification for the stage we just advanced into. The RPC
      // has already committed, so the edge function re-reads the new status. The
      // email is best-effort — its failure must not block the status advance.
      if (ev.kind === 'advance' && !ev.silent && ev.stage) {
        const fn = STAGE_EMAIL[ev.stage];
        if (fn) {
          try {
            const { error: mailErr } = await supabase.functions.invoke(fn, { body: { order_id: order.id } });
            if (mailErr) setActionError(`Status updated — but the buyer notification failed to send: ${mailErr.message}`);
          } catch {
            setActionError('Status updated — but the buyer notification could not be sent.');
          }
        }
      }
      onChanged?.();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed — please try again.');
      return false;
    } finally {
      setBusy(false);
      reload();
    }
  }, [reload, logEvent, onChanged, order, confirm]);

  if (error) return <p role="alert" className="p-[var(--space-6)] text-[12px] text-red-400">{error}</p>;
  if (!order) return <p className="p-[var(--space-6)] holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>;

  const reached = reachedMap(order);
  const terminal = order.status === 'cancelled' || order.status === 'refunded';
  const lineTotal = (l: OrderLine) => { const u = unitOf(l); return u == null ? null : u * l.quantity; };
  const computedSub = order.subtotal_cents ?? lines.reduce((a, l) => a + (lineTotal(l) ?? 0), 0);
  const shipping = order.shipping_cents ?? 0;
  const total = order.invoice_amount_cents ?? (computedSub + shipping);
  // A total below subtotal+shipping is an applied discount — surface it.
  const discount = Math.max(0, computedSub + shipping - total);
  // Compiled track-record for "send with notes".
  const orderNotesText = events.map((e) => `${fmtDateShort(e.created_at)} — ${e.note ?? ''}`).join('\n');

  return (
    <div className="px-[var(--space-6)] py-[var(--space-5)]">
      {/* Invoice header — stacked label/value lines */}
      <div className="space-y-1 border-b border-ink/[0.10] pb-[var(--space-3)]">
        <HeaderLine label="Order"><span className="font-mono text-[12.5px] tracking-[0.04em] text-ink">{order.order_number}</span></HeaderLine>
        <HeaderLine label="Date"><span className="font-mono text-[11px] tabular-nums text-ink/60">{fmtDate(order.created_at)}</span></HeaderLine>
        <HeaderLine label="Status"><OrderStatusChip status={order.status} deliveredAt={order.delivered_at} /></HeaderLine>
      </div>

      {/* Bill to (left) · amounts (right) — equal columns */}
      <div className="flex justify-between gap-[var(--space-6)] py-[var(--space-4)]">
        <div className="min-w-0 flex-1">
          <p className="holo-text-caption mb-1 text-[9px] uppercase tracking-[0.24em] text-ink/40">Bill to</p>
          <p className="text-[13px] text-ink">{order.buyer_name}</p>
          <p className="break-words text-[11.5px] text-ink/55">{order.buyer_contact}</p>
          {order.buyer_organization && <p className="text-[11.5px] text-ink/55">{order.buyer_organization}</p>}
          {(order.ship_street || order.ship_city) && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
              {order.ship_street}{order.ship_street && <br />}
              {[order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(', ')}
              {order.ship_country && <><br />{order.ship_country}</>}
            </p>
          )}
        </div>
        <div className="flex-1 text-right">
          <dl className="ml-auto inline-grid grid-cols-[auto_auto] gap-x-[var(--space-4)] gap-y-1 text-[12px]">
            <dt className="text-ink/45">Subtotal</dt>
            <dd className="text-right font-mono tabular-nums text-ink/80">{fmtUSD(computedSub)}</dd>
            <dt className="text-ink/45">Shipping</dt>
            <dd className="text-right font-mono tabular-nums text-ink/80">{fmtUSD(shipping)}</dd>
            {discount > 0 && (<>
              <dt className="text-holo/80">Discount</dt>
              <dd className="text-right font-mono tabular-nums text-holo/80">−{fmtUSD(discount)}</dd>
            </>)}
            <dt className="border-t border-ink/10 pt-1 text-ink/70">Total</dt>
            <dd className="border-t border-ink/10 pt-1 text-right font-mono text-[14px] tabular-nums text-ink">{fmtUSD(total)}</dd>
          </dl>
          {order.payment_method && <p className="mt-1.5 text-[10.5px] text-ink/40">{order.payment_method}</p>}
        </div>
      </div>

      {/* Itemized — compact rows that fit without horizontal scroll */}
      {editWarn && (
        <p className="mb-[var(--space-2)] rounded-sm border border-[#B5904B]/45 bg-[#B5904B]/[0.08] px-[var(--space-3)] py-[var(--space-2)] text-[11px] leading-relaxed text-ink/80">
          {editWarn}
        </p>
      )}
      <div className="mb-[var(--space-2)] flex items-center justify-between">
        <p className="holo-text-caption text-[9px] uppercase tracking-[0.26em] text-ink/40">Itemized</p>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] uppercase tracking-[0.16em] text-holo transition-colors hover:text-holo-light">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <ItemizedEditor
          orderId={order.id}
          initial={lines}
          onOrderChanged={reload}
          onCancel={() => setEditing(false)}
          onSaved={handleItemsSaved}
        />
      ) : (
        <ul className="divide-y divide-ink/[0.05] rounded-sm border border-ink/[0.08]">
          {lines.map((l) => {
            const u = unitOf(l);
            const lt = lineTotal(l);
            return (
              <li key={l.id} className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
                    {l.fast_ship && <span className="shrink-0 rounded-sm bg-[#B5904B]/15 px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-[#B5904B]">Fast</span>}
                  </div>
                  <p className="truncate font-mono text-[10px] text-holo-light/70">
                    {l.sku}{l.item_note ? ` · ${l.item_note}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono tabular-nums">
                  <p className="text-[10.5px] text-ink/50">{l.quantity} × {u == null ? '—' : fmtUSD(u)}</p>
                  <p className="text-[12.5px] text-ink/85">{lt == null ? '—' : fmtUSD(lt)}</p>
                </div>
              </li>
            );
          })}
          {lines.length === 0 && (
            <li className="px-[var(--space-3)] py-[var(--space-4)] text-center text-[12px] text-ink/40">No line items.</li>
          )}
        </ul>
      )}

      {/* Send-now prompt — appears after saving itemized when no invoice sent yet */}
      {pendingSend && (
        <div className="mt-[var(--space-3)] flex items-center justify-between rounded-sm border border-holo/30 bg-holo/[0.06] px-[var(--space-3)] py-[var(--space-2)]">
          <p className="text-[11px] text-ink/70">Lines saved — ready to send the invoice to the buyer.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setPendingSend(false); setShowSend(true); }}
            className="ml-[var(--space-3)] shrink-0 rounded-full border border-holo/50 px-[var(--space-3)] py-[4px] text-[9.5px] uppercase tracking-[0.16em] text-holo hover:border-holo hover:text-holo-light disabled:opacity-40"
          >
            Send invoice →
          </button>
        </div>
      )}

      {/* Invoice actions — small pills */}
      <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
        <SmallPill onClick={() => setShowInvoice(true)}>View / print invoice</SmallPill>
        {order.invoice_amount_cents != null && (
          <SmallPill onClick={() => { setPendingSend(false); setShowSend(true); }} disabled={busy}>Send to client</SmallPill>
        )}
        {order.lookup_token && <CopyClientLinkPill token={order.lookup_token} prompt={prompt} />}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <section className="mt-[var(--space-8)] border-t border-ink/[0.06] pt-[var(--space-5)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[9px] uppercase tracking-[0.3em] text-ink/40">Status</p>

        {terminal ? (
          <div className="rounded-sm border border-red-400/40 bg-red-400/[0.06] p-[var(--space-4)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-red-400/80">{order.status}</p>
            {order.cancellation_reason && <p className="mt-1 text-[12.5px] text-red-300/85">{order.cancellation_reason}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm('Revive this order to the start of the pipeline?');
                if (!ok) return;
                const reason = (await prompt('Reason for reviving this order:'))?.trim() || 'No reason given';
                await run(
                  () => supabase!.rpc('revert_order_status', { p_order_id: order.id, p_reason: reason }),
                  { stage: null, kind: 'revert', note: 'Revived from terminal state' },
                );
              }}
              className="mt-[var(--space-3)] rounded-full border border-ink/20 px-[var(--space-4)] py-[5px] text-[9.5px] uppercase tracking-[0.18em] text-ink/70 hover:border-ink/35 hover:text-ink disabled:opacity-40"
            >
              Revive order
            </button>
          </div>
        ) : (
          <>
            <ol className="flex items-stretch gap-1.5">
              {(() => {
                // Paid but not yet shipped = the order is being prepared. Surface
                // "order processing" on the Payment received node and suppress the
                // default "now" marker on Shipped so the active state reads right.
                const isProcessing = reached.paid && !reached.shipped;
                return STAGES.map((s) => {
                  const done = reached[s.key];
                  const isCurrent = !done && nextStage(reached) === s.key;
                  const showProcessing = isProcessing && s.key === 'paid';
                  const showNow = isCurrent && !(isProcessing && s.key === 'shipped');
                  return (
                    <li key={s.key} className="flex-1">
                      <div className={`h-[5px] rounded-full transition-colors ${done ? 'bg-holo' : isCurrent ? 'bg-holo/30' : 'bg-ink/[0.10]'}`} />
                      <p className={`mt-1.5 text-[8.5px] uppercase leading-tight tracking-[0.1em] ${done ? 'text-ink/70' : isCurrent ? 'text-ink font-medium' : 'text-ink/30'}`}>
                        {s.label}
                        {showProcessing && <span className="ml-1" style={{ color: '#2E7D5B' }}>· order processing</span>}
                        {showNow && <span className="ml-1 text-holo">● now</span>}
                      </p>
                    </li>
                  );
                });
              })()}
            </ol>

            <div className="mt-[var(--space-5)]">
              <StageActions
                order={order} busy={busy} run={run} onAddEvent={addEvent} prompt={prompt}
                orderNotesText={orderNotesText} onChanged={onChanged} setActionError={setActionError}
              />
            </div>
          </>
        )}

        {actionError && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{actionError}</p>}
      </section>

      {/* ── Notes & history ────────────────────────────────────────────────── */}
      <section className="mt-[var(--space-7)] border-t border-ink/[0.06] pt-[var(--space-5)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[9px] uppercase tracking-[0.3em] text-ink/40">Notes &amp; history</p>
        {events.length > 0 ? (
          <ol className="space-y-[var(--space-2)]">
            {events.map((e) => (
              <li key={e.id} className="flex gap-[var(--space-3)] text-[12px]">
                <span className="w-[120px] shrink-0 font-mono text-[10px] tabular-nums text-ink/35">{fmtDate(e.created_at)}</span>
                <span className={`w-[52px] shrink-0 text-[9px] uppercase tracking-[0.14em] ${e.kind === 'revert' ? 'text-red-400/70' : e.kind === 'advance' ? 'text-holo' : 'text-ink/40'}`}>{e.kind}</span>
                <span className="min-w-0 flex-1 text-ink/75">{e.note}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11.5px] text-ink/40">No notes yet. Notes you save on a step show here and print on the invoice.</p>
        )}
        {eventsUnavailable && (
          <p className="mt-[var(--space-2)] text-[10.5px] text-ink/35">
            Notes show here now, but persist across reloads only after the order_events migration (014) is applied.
          </p>
        )}
      </section>

      {showInvoice && (
        <PrintableInvoice
          order={order} lines={lines} events={events}
          computedSub={computedSub} shipping={shipping} discount={discount} total={total}
          onClose={() => setShowInvoice(false)}
        />
      )}

      {showSend && (
        <SendNoteModal
          title="Send invoice to client"
          busy={busy}
          orderNotes={orderNotesText}
          onCancel={() => setShowSend(false)}
          onSend={async (opts) => { await sendToClient(opts); setShowSend(false); }}
        />
      )}

      {confirmModal}
    </div>
  );

  async function sendToClient(opts: { includeNotes: boolean; note: string }) {
    if (!supabase || !order) return;
    setBusy(true); setActionError(null);
    const extra = opts.note.trim();
    const compiled = opts.includeNotes ? [orderNotesText, extra].filter(Boolean).join('\n') : undefined;
    const { error } = await supabase.functions.invoke('send-order-invoice', {
      body: { order_id: order.id, invoice_url: order.invoice_url ?? '', notes: compiled || undefined },
    });
    setBusy(false);
    if (error) { setActionError(`Couldn't send: ${error.message}`); return; }
    await addEvent(currentStageKey(order), 'system', `Invoice sent to client${opts.includeNotes ? ' with notes' : ''}${extra ? ` — ${extra}` : ''}`);
  }

  async function handleItemsSaved(summary: string) {
    if (!order) return;
    setEditing(false);
    await addEvent(currentStageKey(order), 'system', summary);
    // Reload so the action panel's subtotal field picks up the recomputed
    // server-side amount from save_order_lines. Without this the subtotal
    // input would stay frozen on the pre-edit number.
    reload();
    onChanged?.();
    if (order.invoiced_at) {
      const warn = 'Lines edited after invoice was sent \u2014 re-send to buyer so their copy matches.';
      setEditWarn(warn);
      setPendingSend(false);
      await addEvent(currentStageKey(order), 'system', warn);
    } else {
      setEditWarn(null);
      setPendingSend(true);
    }
    reload();
  }
}

/* ── Stage actions — back / forward + inline notes, all in one segment ─────── */

function StageActions({
  order, busy, run, onAddEvent, prompt, orderNotesText, onChanged, setActionError,
}: {
  order: OrderRecord;
  busy: boolean;
  run: (rpc: () => PromiseLike<{ error: { message: string } | null }>, ev: { stage: StageKey | null; kind: string; note: string | null; silent?: boolean }, confirmMsg?: string) => Promise<boolean>;
  onAddEvent: (stage: StageKey | null, kind: string, note: string) => Promise<void>;
  prompt: (message: string, opts?: { initialValue?: string }) => Promise<string | null>;
  orderNotesText: string;
  onChanged?: () => void;
  setActionError: (m: string | null) => void;
}) {
  const reached = reachedMap(order);
  // Invoice total comes straight from the itemized lines (save_order_lines
  // recomputes subtotal_cents on every edit). Shipping and discounts are
  // settled before invoicing, so the action panel exposes one amount only.
  const [subUsd, setSubUsd] = useState(
    order.invoice_amount_cents != null ? (order.invoice_amount_cents / 100).toFixed(2)
      : order.subtotal_cents != null ? (order.subtotal_cents / 100).toFixed(2)
      : '',
  );

  // Subtotal sync: when the line editor saves, the parent reloads the order
  // and the new server-side subtotal_cents lands on this prop. Re-init the
  // subUsd field so the admin sees the new total without manually retyping.
  // Pre-invoice only — once the invoice is sent the field locks to the
  // historical value.
  useEffect(() => {
    if (reached.invoiced) return;
    // Prefer the discounted billed total (invoice_amount_cents = subtotal −
    // discount, kept in sync by save_order_lines) so an applied coupon flows
    // into the invoice amount; fall back to the raw subtotal.
    const cents = order.invoice_amount_cents ?? order.subtotal_cents;
    if (cents != null) setSubUsd((cents / 100).toFixed(2));
  }, [order.invoice_amount_cents, order.subtotal_cents, reached.invoiced]);
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [carrier, setCarrier] = useState(order.carrier ?? 'usps');
  const [note, setNote] = useState('');
  const [showReNotify, setShowReNotify] = useState(false);

  const canBack = order.status !== 'pending_invoice';
  const reNotifyFn: 'send-order-invoice' | 'send-receipt' = reached.paid ? 'send-receipt' : 'send-order-invoice';

  // Stage meta + the single forward action.
  let title: string; let detail: string;
  let inputs: React.ReactNode = null;
  let forward: { label: string; act: () => Promise<void> } | null = null;

  if (!reached.invoiced) {
    title = 'Confirm received → send invoice';
    detail = 'Confirm the total from the itemized lines, then email the buyer a branded invoice with payment instructions.';
    inputs = (
      <div className="mb-[var(--space-3)] grid grid-cols-1 gap-[var(--space-3)]">
        <MoneyInput label="Invoice total" value={subUsd} onChange={setSubUsd} />
      </div>
    );
    forward = { label: 'Send invoice', act: sendInvoice };
  } else if (!reached.paid) {
    title = reached.claimed ? 'Buyer marked payment sent' : 'Awaiting payment';
    detail = reached.claimed
      ? `The buyer clicked “I’ve sent payment.” Verify the deposit landed (Zelle / PayPal F&F), then mark received. No stock moves yet.`
      : 'Mark paid once funds land (Zelle / PayPal F&F). No stock moves yet.';
    forward = { label: 'Payment received', act: () => advance(() => supabase!.rpc('mark_order_paid', { p_order_id: order.id }), 'paid', 'Payment received') };
  } else if (!reached.shipped) {
    title = 'Processing — ready to ship';
    detail = 'Marking shipped deducts stock for every line and emails the buyer. Add tracking if you have it.';
    const needsTracking = carrierRequiresTracking(carrier);
    inputs = (
      <div className={`mb-[var(--space-3)] grid gap-[var(--space-3)] ${needsTracking ? 'grid-cols-[110px_1fr]' : 'grid-cols-1'}`}>
        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">Carrier</span>
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className={fieldCls}>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {needsTracking && (
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">Tracking (optional)</span>
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" className={fieldCls} />
          </label>
        )}
      </div>
    );
    forward = needsTracking
      ? {
          label: 'Mark shipped',
          act: () => advance(
            () => supabase!.rpc('confirm_order_fulfilled', {
              p_order_id: order.id,
              p_tracking_number: tracking.trim() || null,
              p_carrier: carrier,
            }),
            'shipped',
            tracking.trim() ? `Shipped · ${carrier} ${tracking.trim()}` : 'Shipped',
            'Mark shipped? This deducts stock for every line and emails the buyer tracking.',
          ),
        }
      : { label: 'Mark hand-delivered', act: handDeliver };
  } else if (!reached.delivered) {
    title = 'Shipped — awaiting delivery';
    detail = 'Mark delivered once the carrier confirms; this emails the buyer their PAID receipt.';
    forward = { label: 'Mark delivered', act: () => advance(() => supabase!.rpc('mark_order_delivered', { p_order_id: order.id }), 'delivered', 'Delivered') };
  } else {
    title = 'Complete';
    detail = 'Delivered and closed. Use the note box for any after-the-fact record.';
  }

  return (
    <div className="space-y-[var(--space-3)]">
      <div className="research-surface-solid p-[var(--space-3)]">
        <p className="text-[10px] uppercase tracking-[0.16em] text-ink/75">{title}</p>
        <p className="mt-0.5 mb-[var(--space-2)] text-[10.5px] leading-snug text-ink/45">{detail}</p>

        {inputs}

        {/* Inline note — attaches to whichever control you press */}
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for this step (e.g. PayPal bounced — asked buyer to re-send). Attaches to back / forward, or save on its own."
          className={`${fieldCls} mb-[var(--space-3)] resize-y`}
        />

        {/* One tight row on every screen (compact pills shrink on phones so all
            five fit side by side), color-coded by intent. Order: back · forward
            · re-notify · save · cancel. */}
        <div className="no-scrollbar flex flex-nowrap items-center gap-1 overflow-x-auto">
          {canBack && (
            <Pill compact warn onClick={stepBack} disabled={busy}>← Back a step</Pill>
          )}
          {forward && (
            <Pill compact advance onClick={forward.act} disabled={busy}>{busy ? '…' : forward.label}</Pill>
          )}
          <Pill compact onClick={() => setShowReNotify(true)} disabled={busy}>
            {reNotifyFn === 'send-receipt' ? 'Re-notify (receipt)' : 'Re-notify (invoice)'}
          </Pill>
          <Pill compact onClick={saveNote} disabled={busy || !note.trim()}>Save note</Pill>
          <Pill compact danger onClick={cancel} disabled={busy}>Cancel order</Pill>
        </div>
      </div>

      {showReNotify && (
        <SendNoteModal
          title={reNotifyFn === 'send-receipt' ? 'Re-notify (receipt)' : 'Re-notify (invoice)'}
          busy={busy}
          orderNotes={orderNotesText}
          onCancel={() => setShowReNotify(false)}
          onSend={async (opts) => { await reNotify(opts); setShowReNotify(false); }}
        />
      )}
    </div>
  );

  async function advance(rpc: () => PromiseLike<{ error: { message: string } | null }>, stage: StageKey, defaultNote: string, confirmMsg?: string) {
    const ok = await run(rpc, { stage, kind: 'advance', note: note.trim() || defaultNote }, confirmMsg);
    if (ok) setNote('');
  }

  async function sendInvoice() {
    if (!supabase) return;
    const subC = Math.round(parseFloat(subUsd) * 100);
    if (!Number.isFinite(subC) || subC < 0) { setActionError('Enter a valid total.'); return; }
    const totalC = Math.max(0, subC);
    // Keep subtotal at the pre-discount itemized amount (order.subtotal_cents)
    // so when a coupon discount is on the order the invoice shows a Discount
    // line (discount = subtotal − total). The coupon is applied/persisted in
    // the itemized editor, not here — this step only bills the current total.
    const preSubC = order.subtotal_cents ?? subC;
    const ok = await run(
      () => supabase!.rpc('mark_order_invoiced', {
        p_order_id: order.id, p_invoice_url: order.invoice_url ?? '',
        p_invoice_amount_cents: totalC, p_payment_method: `Zelle (${PAYMENT_CONFIG.zelle})`,
        p_subtotal_cents: preSubC, p_shipping_cents: order.shipping_cents ?? 0,
      }),
      { stage: 'invoiced', kind: 'advance', note: note.trim() || `Invoice sent · ${fmtUSD(totalC)}` },
    );
    if (ok) {
      setNote('');
      const { error } = await supabase.functions.invoke('send-order-invoice', { body: { order_id: order.id, invoice_url: order.invoice_url ?? '' } });
      if (error) setActionError(`Invoice marked sent, but the email failed: ${error.message}`);
      onChanged?.();
    }
  }

  // Hand delivery skips the carrier leg: fulfill (deducts stock) without a
  // "shipped" email, then mark delivered — which fires the single delivered
  // receipt the buyer should get.
  async function handDeliver() {
    const ok = await run(
      () => supabase!.rpc('confirm_order_fulfilled', {
        p_order_id: order.id, p_tracking_number: null, p_carrier: carrier,
      }),
      { stage: 'shipped', kind: 'advance', note: note.trim() || 'Hand delivered', silent: true },
      'Mark hand-delivered? This deducts stock for every line and emails the buyer their delivered receipt.',
    );
    if (!ok) return;
    await run(
      () => supabase!.rpc('mark_order_delivered', { p_order_id: order.id }),
      { stage: 'delivered', kind: 'advance', note: 'Delivered (hand delivery)' },
    );
    setNote('');
  }

  async function stepBack() {
    const ok = await run(
      () => supabase!.rpc('revert_order_status', { p_order_id: order.id, p_reason: note.trim() || 'Stepped back a stage' }),
      { stage: null, kind: 'revert', note: note.trim() || 'Stepped back a stage' },
      'Step this order back one stage? A note is recorded.',
    );
    if (ok) setNote('');
  }

  async function cancel() {
    const trimmed = note.trim();
    // The reason prompt is only resolved once the rpc closure actually runs —
    // i.e. after the "Cancel this order?" confirm has already passed — so the
    // dialog order matches the original confirm-then-prompt behavior.
    const ok = await run(
      async () => {
        const reason = trimmed || (await prompt('Reason for cancellation:'))?.trim() || 'No reason given';
        return supabase!.rpc('cancel_order', { p_order_id: order.id, p_reason: reason });
      },
      { stage: null, kind: 'system', note: trimmed || 'Order cancelled' },
      'Cancel this order?',
    );
    if (ok) setNote('');
  }

  async function saveNote() {
    const t = note.trim();
    if (!t) return;
    await onAddEvent(currentStageKey(order), 'note', t);
    setNote('');
  }

  async function reNotify(opts: { includeNotes: boolean; note: string }) {
    if (!supabase) return;
    setActionError(null);
    const extra = opts.note.trim();
    const compiled = opts.includeNotes ? [orderNotesText, extra].filter(Boolean).join('\n') : undefined;
    const { error } = await supabase.functions.invoke(reNotifyFn, { body: { order_id: order.id, invoice_url: order.invoice_url ?? '', notes: compiled || undefined } });
    if (error) { setActionError(`Couldn't send: ${error.message}`); return; }
    const kindLabel = reNotifyFn === 'send-receipt' ? 'receipt' : 'invoice';
    await onAddEvent(currentStageKey(order), 'system', `Re-notified (${kindLabel})${opts.includeNotes ? ' with notes' : ''}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ── Printable branded invoice ────────────────────────────────────────────── */

interface InvoiceCoupon {
  code: string; kind: string; free_label: string | null;
  percent: number | null; amount_cents: number | null; discount_cents: number;
}
function invoiceCouponLabel(c: InvoiceCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.code} · ${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `${c.code} · $${(c.amount_cents / 100).toFixed(2)} off`;
  return `${c.code} · Free ${c.free_label ?? 'item'}`;
}

function PrintableInvoice({
  order, lines, events, computedSub, shipping, discount, total, onClose,
}: {
  order: OrderRecord; lines: OrderLine[]; events: OrderEvent[];
  computedSub: number; shipping: number; discount: number; total: number; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Itemized coupons for the top "Discounts applied" block — mirrors the emailed
  // invoice + the /track doc so all three surfaces read identically.
  const [coupons, setCoupons] = useState<InvoiceCoupon[]>([]);
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('order_coupons')
      .select('code, kind, free_label, percent, amount_cents, discount_cents')
      .eq('order_id', order.id)
      .order('created_at')
      .then(({ data }) => { if (data) setCoupons(data as InvoiceCoupon[]); });
  }, [order.id]);

  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } .print-doc, .print-doc * { visibility: visible !important; } .print-doc { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; } .no-print { display: none !important; } }`}</style>

      <div className="fixed inset-0 z-[300] overflow-y-auto bg-ink/60 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[301] overflow-y-auto p-4 sm:p-8 pointer-events-none">
        <div className="print-doc pointer-events-auto mx-auto max-w-[760px] bg-white text-[#1A1714] shadow-[0_24px_60px_-20px_rgba(26,23,20,0.5)]">
          <div className="h-[3px] bg-[#B5904B]" />
          <div className="no-print flex items-center justify-between gap-3 border-b border-ink/10 px-6 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">Invoice preview</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} className="rounded-full border border-ink/25 bg-ink/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/80 hover:border-ink/40">Print / Save PDF</button>
              <button type="button" onClick={onClose} className="rounded-full border border-ink/15 px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/60 hover:border-ink/30">Close</button>
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
                <span className="inline-block border-y border-[#B5904B] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-[#1A1714]">Invoice</span>
                <p className="mt-2 font-mono text-[12px] tabular-nums text-[#1A1714]">{order.order_number}</p>
                <p className="font-mono text-[10px] tabular-nums text-[#9A9186]">{fmtDateShort(order.created_at)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 py-6">
              <div>
                <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[#9A9186]">Bill to</p>
                <p className="text-[13px] text-[#1A1714]">{order.buyer_name}</p>
                <p className="text-[12px] text-[#6B635A]">{order.buyer_contact}</p>
                {order.buyer_organization && <p className="text-[12px] text-[#6B635A]">{order.buyer_organization}</p>}
                {(order.ship_street || order.ship_city) && (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[#6B635A]">
                    {order.ship_street}{order.ship_street && <br />}
                    {[order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(', ')}
                    {order.ship_country && <><br />{order.ship_country}</>}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[#9A9186]">Status</p>
                <p className="text-[13px] capitalize text-[#1A1714]">{order.status.replace(/_/g, ' ')}</p>
                {order.payment_method && <p className="mt-1 text-[11.5px] text-[#6B635A]">{order.payment_method}</p>}
              </div>
            </div>

            {/* Discounts applied — up top, itemized per coupon, identical to the
                emailed invoice + /track doc. */}
            {coupons.some((c) => c.discount_cents > 0) && (
              <div className="mb-5 rounded-[8px] border border-[#34727A]/25 bg-[#34727A]/[0.06] px-4 py-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#34727A]">Discounts applied</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[12px]">
                  {coupons.filter((c) => c.discount_cents > 0).map((c) => (
                    <Fragment key={c.code}>
                      <dt className="text-[#1A1714]">{invoiceCouponLabel(c)}</dt>
                      <dd className="text-right font-mono tabular-nums text-[#34727A]">−{fmtUSD(c.discount_cents)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            )}

            <table className="w-full border-collapse">
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
                {lines.map((l) => {
                  const u = unitOf(l);
                  return (
                    <tr key={l.id} className="border-b border-[#1A1714]/[0.08]">
                      <td className="py-2 pr-3 font-mono text-[11px] text-[#34727A]">{l.sku}</td>
                      <td className="py-2 pr-3 text-[12px] text-[#1A1714]">
                        {l.product_name}
                        {l.fast_ship && <span className="ml-1.5 rounded-sm bg-[#B5904B]/12 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#8C6A2F]">Fast ship</span>}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{l.quantity}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-[#6B635A]">{u == null ? '—' : fmtUSD(u)}</td>
                      <td className="py-2 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{u == null ? '—' : fmtUSD(u * l.quantity)}</td>
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
                <dt className="border-t border-[#1A1714]/15 pt-1 text-[#1A1714]">Total</dt><dd className="border-t border-[#1A1714]/15 pt-1 text-right font-mono text-[15px] tabular-nums text-[#1A1714]">{fmtUSD(total)}</dd>
              </dl>
            </div>

            {events.length > 0 && (
              <div className="mt-8 border-t border-[#1A1714]/10 pt-4">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#9A9186]">Order history</p>
                <ul className="space-y-1">
                  {events.map((e) => (
                    <li key={e.id} className="flex gap-3 text-[11px]">
                      <span className="w-[130px] shrink-0 font-mono tabular-nums text-[#9A9186]">{fmtDateShort(e.created_at)}</span>
                      <span className="text-[#6B635A]">{e.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

/* ── Small UI bits ────────────────────────────────────────────────────────── */

const fieldCls =
  'w-full rounded-sm border border-ink/10 bg-base-700 px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none';

function HeaderLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <span className="w-[48px] shrink-0 font-mono text-[9px] uppercase tracking-[0.22em] text-ink/40">{label}</span>
      {children}
    </div>
  );
}

/** Client-facing send dialog (send to client / re-notify). Choose to include
 *  the order's note track-record in the email — or send a clean copy. Anything
 *  typed here is added on top and recorded on the order. */
function SendNoteModal({
  title, busy, orderNotes, onCancel, onSend,
}: { title: string; busy: boolean; orderNotes: string; onCancel: () => void; onSend: (opts: { includeNotes: boolean; note: string }) => void }) {
  const [note, setNote] = useState('');
  const noteCount = orderNotes.trim() ? orderNotes.trim().split('\n').filter(Boolean).length : 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      <div aria-hidden="true" onClick={onCancel} className="fixed inset-0 z-[300] bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-[301] flex items-start justify-center p-4 pointer-events-none sm:p-8">
        <div className="pointer-events-auto w-full max-w-[440px] research-surface-solid p-[var(--space-5)]">
          <p className="holo-text-caption mb-[var(--space-1)] text-[10px] uppercase tracking-[0.3em]">{title}</p>
          <p className="mb-[var(--space-3)] text-[11.5px] leading-relaxed text-ink/45">
            Include the order's note history so the client sees the full track record, or send a clean copy. Anything you add below is appended and recorded on the order.
          </p>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note to add (e.g. updated total reflects the 10% loyalty discount)…"
            className={`${fieldCls} resize-y`}
          />
          {noteCount > 0 && (
            <p className="mt-[var(--space-2)] text-[10.5px] text-ink/45">{noteCount} note{noteCount === 1 ? '' : 's'} on record will be included with “Send with notes”.</p>
          )}
          <div className="mt-[var(--space-4)] flex flex-wrap items-center justify-end gap-[var(--space-2)]">
            <Pill onClick={onCancel} disabled={busy}>Cancel</Pill>
            <Pill onClick={() => onSend({ includeNotes: false, note })} disabled={busy}>Send without notes</Pill>
            <Pill primary onClick={() => onSend({ includeNotes: true, note })} disabled={busy}>
              {busy ? 'Sending…' : `Send with notes${noteCount ? ` (${noteCount})` : ''}`}
            </Pill>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Itemized editor — add / change / remove order lines ──────────────────── */

interface DraftRow { key: string; id?: string; sku: string; product_name: string; compound: string; dose: string; quantity: string; unitUsd: string; fastShip: boolean }

function ItemizedEditor({
  orderId, initial, onOrderChanged, onCancel, onSaved,
}: { orderId: string; initial: OrderLine[]; onOrderChanged?: () => void; onCancel: () => void; onSaved: (summary: string) => void }) {
  const [rows, setRows] = useState<DraftRow[]>(
    initial.map((l, i) => {
      const catalog = l.sku ? productBySku.get(l.sku) : undefined;
      const compound = catalog?.name ?? '';
      const sep = ' — ';
      const dose = compound && l.product_name.startsWith(compound + sep)
        ? l.product_name.slice(compound.length + sep.length)
        : '';
      return {
        key: `e${i}`, id: l.id, sku: l.sku, product_name: l.product_name,
        compound, dose,
        quantity: String(l.quantity),
        unitUsd: l.unit_price_cents != null ? (l.unit_price_cents / 100).toFixed(2) : '',
        fastShip: l.fast_ship ?? false,
      };
    }),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) { setRows((rs) => rs.filter((r) => r.key !== key)); }
  function add() {
    setRows((rs) => [...rs, { key: `n${Date.now()}-${rs.length}`, sku: '', product_name: '', compound: '', dose: '', quantity: '1', unitUsd: '', fastShip: false }]);
  }
  // Ensure the per-variant admin prices are loaded so the picker shows real
  // prices (not a $0 placeholder) even if the admin lands here cold. Idempotent.
  useEffect(() => { useProductOverrides.getState().load(); }, []);

  // Compound → dose variants with REAL admin-set prices. Keyed by the product's
  // display name (e.g. "BPC-157") so column 1 = compound, column 2 = dose.
  const variantBySku = useProductOverrides((s) => s.variantBySku);
  const { compoundNames, byCompound } = useMemo(() => {
    const byCompound = new Map<string, VariantOption[]>();
    for (const p of productBySku.values()) {
      for (const v of p.variants ?? []) {
        if (!isVariantPublic(p.sku, v.dose)) continue;
        const cents = effectiveTierPriceCents(p, v.dose);
        if (cents == null) continue;
        const name = v.dose ? `${p.name} — ${v.dose}` : p.name;
        const opt: VariantOption = { sku: p.sku, dose: v.dose, name, priceCents: cents, family: p.family };
        const arr = byCompound.get(p.name) ?? [];
        arr.push(opt);
        byCompound.set(p.name, arr);
      }
    }
    const compoundNames = [...byCompound.keys()].sort();
    return { compoundNames, byCompound };
  }, [variantBySku]);

  function onPickCompound(key: string, compound: string) {
    update(key, { compound, dose: '', sku: '', product_name: '', unitUsd: '' });
  }

  function onPickDose(key: string, variantKey: string) {
    if (!variantKey) { update(key, { dose: '', sku: '', product_name: '', unitUsd: '' }); return; }
    const [sku, dose] = variantKey.split('|');
    for (const opts of byCompound.values()) {
      const opt = opts.find((o) => o.sku === sku && o.dose === dose);
      if (opt) { update(key, { sku: opt.sku, dose: opt.dose, product_name: opt.name, unitUsd: (opt.priceCents / 100).toFixed(2) }); return; }
    }
  }

  async function save() {
    if (!supabase) return;
    // Validate before sending — fail fast with a usable message.
    for (const r of rows) {
      const q = parseInt(r.quantity, 10);
      if (!r.sku.trim() || !r.product_name.trim()) { setErr('Every line needs a SKU and a name.'); return; }
      if (!Number.isFinite(q) || q < 1 || q > 9999) { setErr('Quantity must be 1–9999.'); return; }
    }
    setSaving(true); setErr(null);

    // Build the payload for save_order_lines (migration 020) — atomic
    // replace of all lines + server-side subtotal recompute. No more stale
    // amount_cents after a line edit, no more N-row save loops.
    const linesPayload = rows.map((r) => ({
      sku: r.sku.trim(),
      product_name: r.product_name.trim(),
      quantity: parseInt(r.quantity, 10),
      unit_price_cents: r.unitUsd.trim() === '' ? 0 : Math.round(parseFloat(r.unitUsd) * 100),
      item_note: null,
      fast_ship: r.fastShip,
    }));

    try {
      const { data, error } = await supabase.rpc('save_order_lines', {
        p_order_id: orderId,
        p_lines: linesPayload,
      });
      if (error) throw error;
      setSaving(false);
      const sub = (data as { subtotal_cents?: number } | null)?.subtotal_cents ?? null;
      const subStr = sub !== null ? ` · subtotal $${(sub / 100).toFixed(2)}` : '';
      onSaved(`Itemized edited — ${rows.length} item${rows.length === 1 ? '' : 's'}${subStr}`);
    } catch (e: unknown) {
      setSaving(false);
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setErr(/permission|policy|row-level/i.test(msg)
        ? 'Editing needs migration 015 + 020 applied (admin write access + save_order_lines RPC).'
        : msg);
    }
  }

  return (
    <div className="rounded-sm border border-ink/[0.12] bg-ink/[0.015] p-[var(--space-3)]">
      <div className="space-y-[var(--space-2)]">
        {rows.map((r) => {
          const cents = r.unitUsd.trim() === '' ? 0 : Math.round(parseFloat(r.unitUsd) * 100);
          const qty = parseInt(r.quantity, 10);
          const lineCents = Number.isFinite(cents) && Number.isFinite(qty) ? cents * qty : 0;
          const variantKey = r.sku && r.dose ? `${r.sku}|${r.dose}` : '';
          const doseOptions = byCompound.get(r.compound) ?? [];
          return (
          <div key={r.key} className="space-y-1.5 border-b border-ink/[0.05] pb-[var(--space-2)]">
            {/* Row 1: Compound + Dose */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <span className="mb-1 block text-[8.5px] uppercase tracking-[0.14em] text-ink/40">Compound</span>
                <select value={r.compound} onChange={(e) => onPickCompound(r.key, e.target.value)} className={fieldCls}>
                  <option value="">— Select compound —</option>
                  {compoundNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-[8.5px] uppercase tracking-[0.14em] text-ink/40">Dose / size</span>
                <select
                  value={variantKey}
                  onChange={(e) => onPickDose(r.key, e.target.value)}
                  disabled={!r.compound}
                  className={`${fieldCls} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <option value="">{r.compound ? '— Select dose —' : '— Pick compound first —'}</option>
                  {doseOptions.map((o) => (
                    <option key={`${o.sku}|${o.dose}`} value={`${o.sku}|${o.dose}`}>
                      {o.dose || o.name} &middot; ${(o.priceCents / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Row 2: SKU + fast ship + qty + price + delete */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-[var(--space-2)]">
              <div className="flex items-center gap-3 pl-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink/40">{r.sku ? skuSuffix(r.sku) : '—'}</span>
                {lineCents > 0 && <span className="font-mono text-[10px] tabular-nums text-ink/35">line {fmtUSD(lineCents)}</span>}
                <label className="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={r.fastShip}
                    onChange={(e) => update(r.key, { fastShip: e.target.checked })}
                    className="h-3 w-3 accent-[#B5904B]"
                  />
                  <span className="text-[9.5px] text-ink/50">Fast ship</span>
                </label>
              </div>
              <div className="flex items-center gap-[var(--space-2)]">
                <label className="block w-[56px]">
                  <span className="mb-1 block text-[8.5px] uppercase tracking-[0.14em] text-ink/40">Qty</span>
                  <input type="number" min="1" max="9999" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className={`${fieldCls} text-right`} />
                </label>
                <label className="block w-[80px]">
                  <span className="mb-1 block text-[8.5px] uppercase tracking-[0.14em] text-ink/40">Unit $</span>
                  <input type="number" step="0.01" min="0" value={r.unitUsd} onChange={(e) => update(r.key, { unitUsd: e.target.value })} placeholder="—" className={`${fieldCls} text-right`} />
                </label>
                <button type="button" onClick={() => remove(r.key)} aria-label="Remove" className="mt-[18px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-400/30 text-red-400/75 hover:border-red-400/55 hover:text-red-300">×</button>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <button type="button" onClick={add} className="mt-[var(--space-2)] text-[10px] uppercase tracking-[0.16em] text-holo hover:text-holo-light">+ Add item</button>

      {/* Discount / coupon — applies to THIS order via admin_apply_coupon (no
          email sent). The discount survives further line edits because
          save_order_lines keeps total = subtotal − discount_cents. */}
      <div className="mt-[var(--space-4)] border-t border-ink/10 pt-[var(--space-3)]">
        <AdminCouponPicker orderId={orderId} onChanged={onOrderChanged} />
      </div>

      {err && <p role="alert" className="mt-[var(--space-2)] text-[11px] text-red-400">{err}</p>}

      <div className="mt-[var(--space-3)] flex items-center justify-end gap-[var(--space-2)]">
        <Pill onClick={onCancel} disabled={saving}>Cancel</Pill>
        <Pill primary onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save itemized'}</Pill>
      </div>
      <p className="mt-[var(--space-2)] text-[10px] text-ink/35">Saving updates the order lines and records a note. If the invoice was already sent, you'll be reminded to re-send it.</p>
    </div>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">{label} (USD)</span>
      <input type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className={fieldCls} />
    </label>
  );
}

/** Small uniform pill used across the order controls. `compact` shrinks it
 *  further on phones so a full row of actions fits on one line. */
function Pill({ onClick, disabled, primary, advance, warn, danger, compact, children }: { onClick: () => void; disabled?: boolean; primary?: boolean; advance?: boolean; warn?: boolean; danger?: boolean; compact?: boolean; children: React.ReactNode }) {
  const size = compact
    ? 'px-1.5 py-[3px] text-[7px] tracking-[0.06em] sm:px-2.5 sm:text-[8.5px] sm:tracking-[0.14em]'
    : 'px-2.5 py-[3px] text-[8.5px] tracking-[0.14em]';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={[
        `shrink-0 rounded-full border uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${size}`,
        danger ? 'border-red-400/35 text-red-400/80 hover:border-red-400/55 hover:text-red-300'
          : advance ? 'border-[#2E7D5B]/45 bg-[#2E7D5B]/[0.10] font-medium text-[#2E7D5B] hover:border-[#2E7D5B]/65 hover:bg-[#2E7D5B]/[0.16]'
          : warn ? 'border-[#B5904B]/50 bg-[#B5904B]/[0.07] text-[#9A7833] hover:border-[#B5904B]/70 hover:bg-[#B5904B]/[0.12]'
          : primary ? 'border-ink/30 bg-ink/[0.10] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.15]'
          : 'border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink',
      ].join(' ')}>
      {children}
    </button>
  );
}

function SmallPill({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="rounded-full border border-ink/15 bg-ink/[0.03] px-[var(--space-3)] py-[5px] text-[9px] uppercase tracking-[0.16em] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

/** Copies the customer's secure invoice/receipt link (/track?t=<token>) to the
 *  clipboard so the admin can share it. The token is the order's secret — only
 *  someone with this link can see the itemized invoice. */
function CopyClientLinkPill({
  token, prompt,
}: { token: string; prompt: (message: string, opts?: { initialValue?: string }) => Promise<string | null> }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/track?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard write blocked (e.g. permissions) — surface the link so the
      // admin can select/copy it manually instead of a silently-dead action.
      await prompt('Copy this client link:', { initialValue: url });
    }
  }
  return <SmallPill onClick={copy}>{copied ? 'Link copied ✓' : 'Copy client link'}</SmallPill>;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function nextStage(reached: Record<StageKey, boolean>): StageKey {
  for (const s of STAGES) if (!reached[s.key]) return s.key;
  return 'delivered';
}

function currentStageKey(o: OrderRecord): StageKey {
  const r = reachedMap(o);
  let last: StageKey = 'received';
  for (const s of STAGES) if (r[s.key]) last = s.key;
  return last;
}

function fmtUSD(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
