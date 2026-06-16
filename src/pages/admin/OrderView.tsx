/**
 * OrderView
 *
 * One order, rendered like an invoice — used both inside a modal (clicked
 * from the Orders list) and as the full page at /admin/orders/:id. It's the
 * single source of truth for "how an order looks".
 *
 * Layout mirrors a real invoice: order # + date tucked to the corners, the
 * buyer on the left, amounts on the right, then the line items with unit +
 * line totals and a subtotal/shipping/total footer.
 *
 * The old stack of action cards is replaced by a Salesforce-style status bar:
 * Order received → Invoice sent → Payment received → Shipped → Delivered. Each
 * stage fills as the order advances; the current stage exposes its one action,
 * plus a notes field, a "report an issue" revert, and a context re-notify.
 * Every advance / revert / note appends to the order_events timeline (which
 * also prints on the invoice).
 *
 * View / print invoice → a branded, print-to-PDF document. Send to client →
 * re-sends the current invoice email (a copy to ourselves + the customer
 * confirm-payment link land in the backend pass).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrderStatusChip } from './AdminOrders';
import { CARRIERS } from '../../lib/tracking';

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
  const [refreshKey, setRefreshKey] = useState(0);

  // Inline async load (keeps setState off the synchronous effect path).
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
      // Events are best-effort — the table may not be migrated yet.
      const ev = await supabase.from('order_events')
        .select('id, stage, kind, note, created_at').eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setEvents(ev.error ? [] : ((ev.data ?? []) as OrderEvent[]));
    }
    load();
    return () => { cancelled = true; };
  }, [orderId, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const logEvent = useCallback(async (stage: StageKey | null, kind: string, note: string | null) => {
    if (!supabase) return;
    // Best-effort; ignore "table missing" until the migration is applied.
    await supabase.from('order_events').insert({ order_id: orderId, stage, kind, note });
  }, [orderId]);

  // Run an RPC, log an event, refresh.
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
  const lineTotal = (l: OrderLine) => (l.unit_price_cents ?? 0) * l.quantity;
  const computedSub = order.subtotal_cents ?? lines.reduce((a, l) => a + lineTotal(l), 0);
  const shipping = order.shipping_cents ?? 0;
  const total = order.invoice_amount_cents ?? (computedSub + shipping);

  return (
    <div className="px-[var(--space-6)] py-[var(--space-5)]">
      {/* Invoice-style header */}
      <div className="flex items-start justify-between gap-[var(--space-4)] border-b border-ink/[0.10] pb-[var(--space-4)]">
        <div>
          <p className="holo-text-caption text-[9px] uppercase tracking-[0.3em] text-ink/40">Order</p>
          <p className="mt-0.5 font-mono text-[15px] tracking-[0.04em] text-ink">{order.order_number}</p>
        </div>
        <div className="text-right">
          <OrderStatusChip status={order.status} deliveredAt={order.delivered_at} />
          <p className="mt-1 font-mono text-[10px] tabular-nums text-ink/45">{fmtDate(order.created_at)}</p>
        </div>
      </div>

      {/* Bill-to left · amounts right */}
      <div className="grid grid-cols-1 gap-[var(--space-4)] py-[var(--space-4)] sm:grid-cols-2">
        <div>
          <p className="holo-text-caption mb-1 text-[9px] uppercase tracking-[0.24em] text-ink/40">Bill to</p>
          <p className="text-[13px] text-ink">{order.buyer_name}</p>
          <p className="text-[11.5px] text-ink/55">{order.buyer_contact}</p>
          {order.buyer_organization && <p className="text-[11.5px] text-ink/55">{order.buyer_organization}</p>}
          {(order.ship_street || order.ship_city) && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
              {order.ship_street}{order.ship_street && <br />}
              {[order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(', ')}
              {order.ship_country && <><br />{order.ship_country}</>}
            </p>
          )}
        </div>
        <div className="sm:text-right">
          <dl className="ml-auto inline-grid grid-cols-[auto_auto] gap-x-[var(--space-4)] gap-y-1 text-[12px]">
            <dt className="text-ink/45">Subtotal</dt>
            <dd className="text-right font-mono tabular-nums text-ink/80">{fmtUSD(computedSub)}</dd>
            <dt className="text-ink/45">Shipping</dt>
            <dd className="text-right font-mono tabular-nums text-ink/80">{fmtUSD(shipping)}</dd>
            <dt className="border-t border-ink/10 pt-1 text-ink/70">Total</dt>
            <dd className="border-t border-ink/10 pt-1 text-right font-mono text-[14px] tabular-nums text-ink">{fmtUSD(total)}</dd>
          </dl>
          {order.payment_method && <p className="mt-1.5 text-[10.5px] text-ink/40">{order.payment_method}</p>}
        </div>
      </div>

      {/* Line items */}
      <div className="overflow-x-auto rounded-sm border border-ink/[0.08]">
        <table className="w-full min-w-[460px] border-collapse">
          <thead>
            <tr className="border-b border-ink/[0.10] bg-ink/[0.02]">
              <th className="px-[var(--space-3)] py-[var(--space-2)] text-left text-[9px] uppercase tracking-[0.18em] text-ink/45 font-normal">SKU</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] text-left text-[9px] uppercase tracking-[0.18em] text-ink/45 font-normal">Item</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] text-right text-[9px] uppercase tracking-[0.18em] text-ink/45 font-normal w-[52px]">Qty</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] text-right text-[9px] uppercase tracking-[0.18em] text-ink/45 font-normal w-[90px]">Unit</th>
              <th className="px-[var(--space-3)] py-[var(--space-2)] text-right text-[9px] uppercase tracking-[0.18em] text-ink/45 font-normal w-[100px]">Line</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-ink/[0.05] last:border-0">
                <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[11px] text-holo-light/80">{l.sku}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-ink/80">
                  {l.product_name}
                  {l.item_note && <span className="ml-1.5 text-[10.5px] text-ink/40">({l.item_note})</span>}
                </td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] text-right font-mono text-[12px] tabular-nums text-ink/80">{l.quantity}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] text-right font-mono text-[11.5px] tabular-nums text-ink/55">{l.unit_price_cents == null ? '—' : fmtUSD(l.unit_price_cents)}</td>
                <td className="px-[var(--space-3)] py-[var(--space-2)] text-right font-mono text-[12px] tabular-nums text-ink/80">{l.unit_price_cents == null ? '—' : fmtUSD(lineTotal(l))}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={5} className="px-[var(--space-3)] py-[var(--space-4)] text-center text-[12px] text-ink/40">No line items.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice actions */}
      <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
        <button
          type="button"
          onClick={() => setShowInvoice(true)}
          className="rounded-full border border-ink/20 bg-ink/[0.04] px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/80 transition-colors hover:border-ink/35 hover:text-ink"
        >
          View / print invoice
        </button>
        {order.invoice_amount_cents != null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => sendToClient()}
            className="rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Send to client
          </button>
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <section className="mt-[var(--space-7)]">
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
              className="mt-[var(--space-3)] rounded-full border border-ink/20 px-[var(--space-4)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] text-ink/70 hover:border-ink/35 hover:text-ink disabled:opacity-40"
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
              <StageActions order={order} busy={busy} run={run} reload={reload} onChanged={onChanged} setActionError={setActionError} />
            </div>
          </>
        )}

        {actionError && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{actionError}</p>}
      </section>

      {/* ── Notes timeline ─────────────────────────────────────────────────── */}
      <NotesTimeline events={events} onSave={async (text) => { await logEvent(currentStageKey(order), 'note', text); reload(); }} busy={busy} />

      {showInvoice && (
        <PrintableInvoice
          order={order} lines={lines} events={events}
          computedSub={computedSub} shipping={shipping} total={total}
          onClose={() => setShowInvoice(false)}
        />
      )}
    </div>
  );

  async function sendToClient() {
    if (!supabase || !order) return;
    setBusy(true); setActionError(null);
    const { error } = await supabase.functions.invoke('send-order-invoice', {
      body: { order_id: order.id, invoice_url: order.invoice_url ?? '' },
    });
    setBusy(false);
    if (error) { setActionError(`Couldn't send: ${error.message}`); return; }
    await logEvent(currentStageKey(order), 'system', 'Invoice re-sent to client');
    reload();
  }
}

/* ── Stage actions (the one action for the current stage + revert) ────────── */

function StageActions({
  order, busy, run, reload, onChanged, setActionError,
}: {
  order: OrderRecord;
  busy: boolean;
  run: (rpc: () => PromiseLike<{ error: { message: string } | null }>, ev: { stage: StageKey | null; kind: string; note: string | null }, confirmMsg?: string) => Promise<boolean>;
  reload: () => Promise<void> | void;
  onChanged?: () => void;
  setActionError: (m: string | null) => void;
}) {
  const reached = reachedMap(order);

  // Local inputs for the invoice + shipping stages.
  const [subUsd, setSubUsd] = useState(order.subtotal_cents != null ? (order.subtotal_cents / 100).toFixed(2) : '');
  const [shipUsd, setShipUsd] = useState(order.shipping_cents != null ? (order.shipping_cents / 100).toFixed(2) : '');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [carrier, setCarrier] = useState(order.carrier ?? 'usps');

  async function sendInvoice() {
    if (!supabase) return;
    const subC = Math.round(parseFloat(subUsd) * 100);
    if (!Number.isFinite(subC) || subC < 0) { setActionError('Enter a valid subtotal.'); return; }
    const shipC = Number.isFinite(Math.round(parseFloat(shipUsd) * 100)) ? Math.round(parseFloat(shipUsd) * 100) : 0;
    const ok = await run(
      () => supabase!.rpc('mark_order_invoiced', {
        p_order_id: order.id, p_invoice_url: order.invoice_url ?? '',
        p_invoice_amount_cents: subC + shipC, p_payment_method: 'Zelle (ops@vsresearchlabs.com)',
        p_subtotal_cents: subC, p_shipping_cents: shipC,
      }),
      { stage: 'invoiced', kind: 'advance', note: `Invoice sent · ${fmtUSD(subC + shipC)}` },
    );
    if (ok && supabase) {
      const { error } = await supabase.functions.invoke('send-order-invoice', { body: { order_id: order.id, invoice_url: order.invoice_url ?? '' } });
      if (error) setActionError(`Invoice marked sent, but the email failed: ${error.message}`);
      await reload(); onChanged?.();
    }
  }

  // The single "advance" action for the current stage.
  let advance: React.ReactNode = null;

  if (!reached.invoiced) {
    advance = (
      <StageCard title="Confirm received → send invoice" detail="Set the amounts and email the buyer a branded invoice with payment instructions.">
        <div className="mb-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)]">
          <MoneyInput label="Subtotal" value={subUsd} onChange={setSubUsd} />
          <MoneyInput label="Shipping" value={shipUsd} onChange={setShipUsd} />
        </div>
        <PrimaryBtn onClick={sendInvoice} disabled={busy}>{busy ? 'Sending…' : 'Send invoice'}</PrimaryBtn>
      </StageCard>
    );
  } else if (!reached.paid) {
    advance = (
      <StageCard title="Awaiting payment" detail="Mark paid once funds land (Zelle / PayPal F&F). No stock moves yet.">
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <PrimaryBtn
            onClick={() => run(() => supabase!.rpc('mark_order_paid', { p_order_id: order.id }), { stage: 'paid', kind: 'advance', note: 'Payment received' })}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Payment received'}
          </PrimaryBtn>
          <GhostBtn
            onClick={() => resend('send-order-invoice')}
            disabled={busy}
          >
            Re-notify (resend invoice)
          </GhostBtn>
        </div>
      </StageCard>
    );
  } else if (!reached.shipped) {
    advance = (
      <StageCard title="Processing — ready to ship" detail="Marking shipped deducts stock for every line and emails the buyer. Add tracking if you have it.">
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
        <PrimaryBtn
          onClick={() => run(
            () => supabase!.rpc('confirm_order_fulfilled', { p_order_id: order.id, p_tracking_number: tracking.trim() || null, p_carrier: tracking.trim() ? carrier : null }),
            { stage: 'shipped', kind: 'advance', note: tracking.trim() ? `Shipped · ${carrier} ${tracking.trim()}` : 'Shipped' },
            'Mark shipped? This deducts stock for every line.',
          )}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Mark shipped'}
        </PrimaryBtn>
      </StageCard>
    );
  } else if (!reached.delivered) {
    advance = (
      <StageCard title="Shipped — awaiting delivery" detail="Mark delivered once the carrier confirms; this emails the buyer their PAID receipt.">
        <PrimaryBtn
          onClick={() => run(() => supabase!.rpc('mark_order_delivered', { p_order_id: order.id }), { stage: 'delivered', kind: 'advance', note: 'Delivered' })}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Mark delivered'}
        </PrimaryBtn>
      </StageCard>
    );
  } else {
    advance = (
      <StageCard title="Complete" detail="Delivered and closed. Resend the receipt below if the buyer needs another copy.">
        <GhostBtn onClick={() => resend('send-receipt')} disabled={busy}>Resend receipt</GhostBtn>
      </StageCard>
    );
  }

  return (
    <div className="space-y-[var(--space-3)]">
      {advance}
      {/* Always available: report an issue (revert a step) + cancel */}
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <GhostBtn
          danger
          onClick={() => run(
            () => supabase!.rpc('revert_order_status', { p_order_id: order.id, p_reason: promptReason('What happened? (e.g. payment reversed)') }),
            { stage: null, kind: 'revert', note: 'Reverted a step' },
            'Step this order back one stage? A flag + note is recorded.',
          )}
          disabled={busy}
        >
          ⚠ Report an issue / revert a step
        </GhostBtn>
        <GhostBtn
          danger
          onClick={() => run(
            () => supabase!.rpc('cancel_order', { p_order_id: order.id, p_reason: promptReason('Reason for cancellation:') }),
            { stage: null, kind: 'system', note: 'Order cancelled' },
            'Cancel this order?',
          )}
          disabled={busy}
        >
          Cancel order
        </GhostBtn>
      </div>
    </div>
  );

  async function resend(fn: 'send-order-invoice' | 'send-receipt') {
    if (!supabase) return;
    setActionError(null);
    const { error } = await supabase.functions.invoke(fn, { body: { order_id: order.id, invoice_url: order.invoice_url ?? '' } });
    if (error) setActionError(`Couldn't send: ${error.message}`);
  }
}

/* ── Notes timeline ───────────────────────────────────────────────────────── */

function NotesTimeline({
  events, onSave, busy,
}: { events: OrderEvent[]; onSave: (text: string) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const t = text.trim();
    if (!t) return;
    setSaving(true);
    await onSave(t);
    setSaving(false);
    setText('');
  }

  return (
    <section className="mt-[var(--space-7)]">
      <p className="holo-text-caption mb-[var(--space-3)] text-[9px] uppercase tracking-[0.3em] text-ink/40">Notes &amp; history</p>

      {events.length > 0 ? (
        <ol className="mb-[var(--space-4)] space-y-[var(--space-2)]">
          {events.map((e) => (
            <li key={e.id} className="flex gap-[var(--space-3)] text-[12px]">
              <span className="w-[120px] shrink-0 font-mono text-[10px] tabular-nums text-ink/35">{fmtDate(e.created_at)}</span>
              <span className={`shrink-0 text-[9px] uppercase tracking-[0.16em] ${e.kind === 'revert' ? 'text-red-400/70' : e.kind === 'advance' ? 'text-holo' : 'text-ink/40'}`}>{e.kind}</span>
              <span className="min-w-0 flex-1 text-ink/75">{e.note}{e.stage && <span className="ml-1.5 text-ink/35">· {e.stage}</span>}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-[var(--space-3)] text-[11.5px] text-ink/40">No events yet. Notes you save here are stamped to the order and print on the invoice.</p>
      )}

      <div className="flex items-end gap-[var(--space-2)]">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note (e.g. PayPal payment bounced — asked buyer to re-send)…"
          className={`${fieldCls} flex-1 resize-y`}
        />
        <PrimaryBtn onClick={save} disabled={saving || busy || !text.trim()}>{saving ? 'Saving…' : 'Save note'}</PrimaryBtn>
      </div>
    </section>
  );
}

/* ── Printable branded invoice ────────────────────────────────────────────── */

function PrintableInvoice({
  order, lines, events, computedSub, shipping, total, onClose,
}: {
  order: OrderRecord; lines: OrderLine[]; events: OrderEvent[];
  computedSub: number; shipping: number; total: number; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Print isolation: only .print-doc is visible when printing. */}
      <style>{`@media print { body * { visibility: hidden !important; } .print-doc, .print-doc * { visibility: visible !important; } .print-doc { position: absolute !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; } .no-print { display: none !important; } }`}</style>

      <div className="fixed inset-0 z-[300] overflow-y-auto bg-ink/60 backdrop-blur-[3px]" onClick={onClose} />
      <div className="fixed inset-0 z-[301] overflow-y-auto p-4 sm:p-8 pointer-events-none">
        <div className="print-doc pointer-events-auto mx-auto max-w-[760px] bg-white text-[#1A1714] shadow-[0_24px_60px_-20px_rgba(26,23,20,0.5)]">
          {/* toolbar (not printed) */}
          <div className="no-print flex items-center justify-between gap-3 border-b border-ink/10 px-6 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">Invoice preview</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} className="rounded-full border border-ink/25 bg-ink/[0.05] px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/80 hover:border-ink/40">Print / Save PDF</button>
              <button type="button" onClick={onClose} className="rounded-full border border-ink/15 px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink/60 hover:border-ink/30">Close</button>
            </div>
          </div>

          {/* document body */}
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
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-[#1A1714]/[0.08]">
                    <td className="py-2 pr-3 font-mono text-[11px] text-[#34727A]">{l.sku}</td>
                    <td className="py-2 pr-3 text-[12px] text-[#1A1714]">{l.product_name}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{l.quantity}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-[#6B635A]">{l.unit_price_cents == null ? '—' : fmtUSD(l.unit_price_cents)}</td>
                    <td className="py-2 text-right font-mono text-[12px] tabular-nums text-[#1A1714]">{l.unit_price_cents == null ? '—' : fmtUSD(l.unit_price_cents * l.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1 text-[12px]">
                <dt className="text-[#6B635A]">Subtotal</dt><dd className="text-right font-mono tabular-nums text-[#1A1714]">{fmtUSD(computedSub)}</dd>
                <dt className="text-[#6B635A]">Shipping</dt><dd className="text-right font-mono tabular-nums text-[#1A1714]">{fmtUSD(shipping)}</dd>
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

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">{label} (USD)</span>
      <input type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" className={fieldCls} />
    </label>
  );
}

function StageCard({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="research-surface-solid p-[var(--space-4)]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink/75">{title}</p>
      <p className="mt-1 mb-[var(--space-3)] text-[11.5px] leading-relaxed text-ink/45">{detail}</p>
      {children}
    </div>
  );
}

function PrimaryBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="rounded-full border border-ink/30 bg-ink/[0.10] px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink transition-colors hover:border-ink/40 hover:bg-ink/[0.15] disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

function GhostBtn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={[
        'rounded-full border px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        danger ? 'border-red-400/35 text-red-400/80 hover:border-red-400/55 hover:text-red-300' : 'border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink',
      ].join(' ')}>
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
  // The last reached stage is "where we are".
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
