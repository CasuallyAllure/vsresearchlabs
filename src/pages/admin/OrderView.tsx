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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrderStatusChip } from './AdminOrders';
import { CARRIERS } from '../../lib/tracking';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { tierPriceCents } from '../../lib/pricing';

/** SKU → catalog product, for resolving a unit price when an order line has no
 *  stored price yet (variant-aware: the dose in the item name drives the tier). */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}

type OrderStatus =
  | 'pending_invoice' | 'invoice_sent' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

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
  paid_at: string | null;
  fulfilled_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

interface OrderLine {
  id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
}

interface OrderEvent {
  id: string;
  stage: string | null;
  kind: string;
  note: string | null;
  created_at: string;
}

const ORDER_SELECT =
  'id, order_number, status, buyer_name, buyer_contact, buyer_organization, notes, invoice_url, invoice_amount_cents, subtotal_cents, shipping_cents, payment_method, tracking_number, carrier, cancellation_reason, ship_street, ship_city, ship_state, ship_zip, ship_country, invoiced_at, paid_at, fulfilled_at, shipped_at, delivered_at, cancelled_at, created_at';

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

type StageKey = 'received' | 'invoiced' | 'paid' | 'shipped' | 'delivered';

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'received',  label: 'Order received' },
  { key: 'invoiced',  label: 'Invoice sent' },
  { key: 'paid',      label: 'Payment received' },
  { key: 'shipped',   label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

function reachedMap(o: OrderRecord): Record<StageKey, boolean> {
  return {
    received: true,
    invoiced: !!o.invoiced_at || ['invoice_sent', 'paid', 'fulfilled'].includes(o.status),
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); return; }
      const [o, l] = await Promise.all([
        supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).single(),
        supabase.from('order_lines').select('id, sku, product_name, quantity, unit_price_cents, item_note').eq('order_id', orderId),
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
    ev: { stage: StageKey | null; kind: string; note: string | null },
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return false;
    if (!supabase) return false;
    setBusy(true);
    setActionError(null);
    const { error } = await rpc();
    if (error) { setBusy(false); setActionError(error.message); return false; }
    await logEvent(ev.stage, ev.kind, ev.note);
    setBusy(false);
    reload();
    onChanged?.();
    return true;
  }, [reload, logEvent, onChanged]);

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
      <p className="holo-text-caption mb-[var(--space-2)] text-[9px] uppercase tracking-[0.26em] text-ink/40">Itemized</p>
      <ul className="divide-y divide-ink/[0.05] rounded-sm border border-ink/[0.08]">
        {lines.map((l) => {
          const u = unitOf(l);
          const lt = lineTotal(l);
          return (
            <li key={l.id} className="flex items-start justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
              <div className="min-w-0">
                <p className="truncate text-[12px] text-ink/85">{l.product_name}</p>
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

      {/* Invoice actions — small pills */}
      <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
        <SmallPill onClick={() => setShowInvoice(true)}>View / print invoice</SmallPill>
        {order.invoice_amount_cents != null && (
          <SmallPill onClick={() => setShowSend(true)} disabled={busy}>Send to client</SmallPill>
        )}
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
              onClick={() => run(
                () => supabase!.rpc('revert_order_status', { p_order_id: order.id, p_reason: promptReason('Reason for reviving this order:') }),
                { stage: null, kind: 'revert', note: 'Revived from terminal state' },
                'Revive this order to the start of the pipeline?',
              )}
              className="mt-[var(--space-3)] rounded-full border border-ink/20 px-[var(--space-4)] py-[5px] text-[9.5px] uppercase tracking-[0.18em] text-ink/70 hover:border-ink/35 hover:text-ink disabled:opacity-40"
            >
              Revive order
            </button>
          </div>
        ) : (
          <>
            <ol className="flex items-stretch gap-1.5">
              {STAGES.map((s) => {
                const done = reached[s.key];
                const isCurrent = !done && nextStage(reached) === s.key;
                return (
                  <li key={s.key} className="flex-1">
                    <div className={`h-[5px] rounded-full transition-colors ${done ? 'bg-holo' : isCurrent ? 'bg-holo/30' : 'bg-ink/[0.10]'}`} />
                    <p className={`mt-1.5 text-[8.5px] uppercase leading-tight tracking-[0.1em] ${done ? 'text-ink/70' : isCurrent ? 'text-ink font-medium' : 'text-ink/30'}`}>
                      {s.label}
                      {isCurrent && <span className="ml-1 text-holo">● now</span>}
                    </p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-[var(--space-5)]">
              <StageActions
                order={order} busy={busy} run={run} onAddEvent={addEvent}
                onChanged={onChanged} setActionError={setActionError}
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
          onCancel={() => setShowSend(false)}
          onSend={async (note) => { await sendToClient(note); setShowSend(false); }}
        />
      )}
    </div>
  );

  async function sendToClient(note: string) {
    if (!supabase || !order) return;
    setBusy(true); setActionError(null);
    const { error } = await supabase.functions.invoke('send-order-invoice', {
      body: { order_id: order.id, invoice_url: order.invoice_url ?? '' },
    });
    setBusy(false);
    if (error) { setActionError(`Couldn't send: ${error.message}`); return; }
    await addEvent(currentStageKey(order), 'system', note.trim() ? `Invoice sent to client — ${note.trim()}` : 'Invoice sent to client');
  }
}

/* ── Stage actions — back / forward + inline notes, all in one segment ─────── */

function StageActions({
  order, busy, run, onAddEvent, onChanged, setActionError,
}: {
  order: OrderRecord;
  busy: boolean;
  run: (rpc: () => PromiseLike<{ error: { message: string } | null }>, ev: { stage: StageKey | null; kind: string; note: string | null }, confirmMsg?: string) => Promise<boolean>;
  onAddEvent: (stage: StageKey | null, kind: string, note: string) => Promise<void>;
  onChanged?: () => void;
  setActionError: (m: string | null) => void;
}) {
  const reached = reachedMap(order);
  const initialDiscount = order.subtotal_cents != null && order.invoice_amount_cents != null
    ? Math.max(0, (order.subtotal_cents + (order.shipping_cents ?? 0)) - order.invoice_amount_cents) : 0;
  const [subUsd, setSubUsd] = useState(order.subtotal_cents != null ? (order.subtotal_cents / 100).toFixed(2) : '');
  const [shipUsd, setShipUsd] = useState(order.shipping_cents != null ? (order.shipping_cents / 100).toFixed(2) : '');
  const [discUsd, setDiscUsd] = useState(initialDiscount > 0 ? (initialDiscount / 100).toFixed(2) : '');
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
    detail = 'Set the amounts and email the buyer a branded invoice with payment instructions.';
    inputs = (
      <div className="mb-[var(--space-3)] grid grid-cols-3 gap-[var(--space-3)]">
        <MoneyInput label="Subtotal" value={subUsd} onChange={setSubUsd} />
        <MoneyInput label="Shipping" value={shipUsd} onChange={setShipUsd} />
        <MoneyInput label="Discount" value={discUsd} onChange={setDiscUsd} />
      </div>
    );
    forward = { label: 'Send invoice', act: sendInvoice };
  } else if (!reached.paid) {
    title = 'Awaiting payment';
    detail = 'Mark paid once funds land (Zelle / PayPal F&F). No stock moves yet.';
    forward = { label: 'Payment received', act: () => advance(() => supabase!.rpc('mark_order_paid', { p_order_id: order.id }), 'paid', 'Payment received') };
  } else if (!reached.shipped) {
    title = 'Processing — ready to ship';
    detail = 'Marking shipped deducts stock for every line and emails the buyer. Add tracking if you have it.';
    inputs = (
      <div className="mb-[var(--space-3)] grid grid-cols-[110px_1fr] gap-[var(--space-3)]">
        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">Carrier</span>
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className={fieldCls}>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">Tracking (optional)</span>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" className={fieldCls} />
        </label>
      </div>
    );
    forward = {
      label: 'Mark shipped',
      act: () => advance(
        () => supabase!.rpc('confirm_order_fulfilled', { p_order_id: order.id, p_tracking_number: tracking.trim() || null, p_carrier: tracking.trim() ? carrier : null }),
        'shipped',
        tracking.trim() ? `Shipped · ${carrier} ${tracking.trim()}` : 'Shipped',
        'Mark shipped? This deducts stock for every line.',
      ),
    };
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
      <div className="research-surface-solid p-[var(--space-4)]">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink/75">{title}</p>
        <p className="mt-1 mb-[var(--space-3)] text-[11.5px] leading-relaxed text-ink/45">{detail}</p>

        {inputs}

        {/* Inline note — attaches to whichever control you press */}
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for this step (e.g. PayPal bounced — asked buyer to re-send). Attaches to back / forward, or save on its own."
          className={`${fieldCls} mb-[var(--space-3)] resize-y`}
        />

        {/* Back · forward · re-notify · save-note — small pills in one lane */}
        <div className="flex flex-wrap items-center gap-1.5">
          {canBack && (
            <Pill onClick={stepBack} disabled={busy}>← Back a step</Pill>
          )}
          {forward && (
            <Pill primary onClick={forward.act} disabled={busy}>{busy ? '…' : forward.label}</Pill>
          )}
          <Pill onClick={() => setShowReNotify(true)} disabled={busy}>
            {reNotifyFn === 'send-receipt' ? 'Re-notify (receipt)' : 'Re-notify (invoice)'}
          </Pill>
          <Pill onClick={saveNote} disabled={busy || !note.trim()}>Save note</Pill>
        </div>
      </div>

      {/* Cancel — the one separate, unique control */}
      <div>
        <Pill danger onClick={cancel} disabled={busy}>Cancel order</Pill>
      </div>

      {showReNotify && (
        <SendNoteModal
          title={reNotifyFn === 'send-receipt' ? 'Re-notify (receipt)' : 'Re-notify (invoice)'}
          busy={busy}
          onCancel={() => setShowReNotify(false)}
          onSend={async (n) => { await reNotify(n); setShowReNotify(false); }}
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
    if (!Number.isFinite(subC) || subC < 0) { setActionError('Enter a valid subtotal.'); return; }
    const shipC = Number.isFinite(Math.round(parseFloat(shipUsd) * 100)) ? Math.round(parseFloat(shipUsd) * 100) : 0;
    const discC = Number.isFinite(Math.round(parseFloat(discUsd) * 100)) ? Math.max(0, Math.round(parseFloat(discUsd) * 100)) : 0;
    const totalC = Math.max(0, subC + shipC - discC);
    const ok = await run(
      () => supabase!.rpc('mark_order_invoiced', {
        p_order_id: order.id, p_invoice_url: order.invoice_url ?? '',
        p_invoice_amount_cents: totalC, p_payment_method: 'Zelle (ops@vsresearchlabs.com)',
        p_subtotal_cents: subC, p_shipping_cents: shipC,
      }),
      { stage: 'invoiced', kind: 'advance', note: note.trim() || `Invoice sent · ${fmtUSD(totalC)}${discC > 0 ? ` (−${fmtUSD(discC)} discount)` : ''}` },
    );
    if (ok) {
      setNote('');
      const { error } = await supabase.functions.invoke('send-order-invoice', { body: { order_id: order.id, invoice_url: order.invoice_url ?? '' } });
      if (error) setActionError(`Invoice marked sent, but the email failed: ${error.message}`);
      onChanged?.();
    }
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
    const ok = await run(
      () => supabase!.rpc('cancel_order', { p_order_id: order.id, p_reason: note.trim() || promptReason('Reason for cancellation:') }),
      { stage: null, kind: 'system', note: note.trim() || 'Order cancelled' },
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

  async function reNotify(n: string) {
    if (!supabase) return;
    setActionError(null);
    const { error } = await supabase.functions.invoke(reNotifyFn, { body: { order_id: order.id, invoice_url: order.invoice_url ?? '' } });
    if (error) { setActionError(`Couldn't send: ${error.message}`); return; }
    const kindLabel = reNotifyFn === 'send-receipt' ? 'receipt' : 'invoice';
    await onAddEvent(currentStageKey(order), 'system', n.trim() ? `Re-notified (${kindLabel}) — ${n.trim()}` : `Re-notified (${kindLabel})`);
  }
}

/* ── Printable branded invoice ────────────────────────────────────────────── */

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

  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } .print-doc, .print-doc * { visibility: visible !important; } .print-doc { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; } .no-print { display: none !important; } }`}</style>

      <div className="fixed inset-0 z-[300] overflow-y-auto bg-ink/60 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[301] overflow-y-auto p-4 sm:p-8 pointer-events-none">
        <div className="print-doc pointer-events-auto mx-auto max-w-[760px] bg-white text-[#1A1714] shadow-[0_24px_60px_-20px_rgba(26,23,20,0.5)]">
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
                <img src="/brand/vs-dna-s-full-colour.png" alt="VS Research Labs" className="h-10 w-auto" />
                <div>
                  <p className="font-serif text-[18px] leading-none text-[#1A1714]">VS Research Labs</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#6B635A]">For Research Purposes Only</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-serif text-[22px] leading-none text-[#1A1714]">Invoice</p>
                <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#6B635A]">{order.order_number}</p>
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
                      <td className="py-2 pr-3 text-[12px] text-[#1A1714]">{l.product_name}</td>
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

            <p className="mt-8 border-t border-[#1A1714]/10 pt-4 text-[10px] leading-relaxed text-[#9A9186]">
              VS Research Labs · inquire@vsresearchlabs.com · All products are sold for laboratory research use only and are not for human consumption.
            </p>
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

/** Optional-note dialog for any client-facing send (send to client / re-notify).
 *  The note is recorded on the order + printed in the invoice history. */
function SendNoteModal({
  title, busy, onCancel, onSend,
}: { title: string; busy: boolean; onCancel: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      <div aria-hidden="true" onClick={onCancel} className="fixed inset-0 z-[300] bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-[301] flex items-start justify-center p-4 pointer-events-none sm:p-8">
        <div className="pointer-events-auto w-full max-w-[420px] research-surface-solid p-[var(--space-5)]">
          <p className="holo-text-caption mb-[var(--space-1)] text-[10px] uppercase tracking-[0.3em]">{title}</p>
          <p className="mb-[var(--space-3)] text-[11.5px] leading-relaxed text-ink/45">
            Add a note for the client, or send without one. The note is recorded on the order and appears in the printed invoice history.
          </p>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. updated total reflects the 10% loyalty discount)…"
            className={`${fieldCls} resize-y`}
          />
          <div className="mt-[var(--space-4)] flex items-center justify-end gap-[var(--space-2)]">
            <Pill onClick={onCancel} disabled={busy}>Cancel</Pill>
            <Pill primary onClick={() => onSend(note)} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Pill>
          </div>
        </div>
      </div>
    </>
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

/** Small uniform pill used across the order controls. */
function Pill({ onClick, disabled, primary, danger, children }: { onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={[
        'rounded-full border px-[var(--space-3)] py-[5px] text-[9px] uppercase tracking-[0.16em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        danger ? 'border-red-400/35 text-red-400/80 hover:border-red-400/55 hover:text-red-300'
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

function promptReason(q: string): string {
  return (window.prompt(q) ?? '').trim() || 'No reason given';
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
