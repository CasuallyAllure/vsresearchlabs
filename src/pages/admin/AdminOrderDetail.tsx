/**
 * AdminOrderDetail
 *
 * Single order surface. Shows buyer, line items, invoice metadata, and
 * the active status-transition action(s) for the current state.
 *
 * Status flow:
 *   pending_invoice → [Send invoice]                    → invoice_sent
 *   invoice_sent    → [Mark paid]                       → paid
 *   paid            → [Confirm fulfilled] (decrements stock) → fulfilled
 *   any non-terminal → [Cancel]                         → cancelled
 *
 * "Send invoice" calls the `send-order-invoice` Edge Function which
 * sends the payment-instructions email and then invokes the
 * `mark_order_invoiced` RPC. Mark-paid and confirm-fulfilled call
 * their RPCs directly.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { OrderStatusChip } from './AdminOrders';
import { CARRIERS, carrierLabel, carrierTrackingUrl } from '../../lib/tracking';

type OrderStatus =
  | 'pending_invoice'
  | 'invoice_sent'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

interface OrderRecord {
  id: string;
  order_number: string;
  status: OrderStatus;
  inquiry_id: string | null;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  notes: string | null;
  invoice_url: string | null;
  invoice_amount_cents: number | null;
  payment_method: string | null;
  tracking_number: string | null;
  carrier: string | null;
  cancellation_reason: string | null;
  invoiced_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  receipt_sent_at: string | null;
  receipt_count: number | null;
  flag_note: string | null;
  flagged_at: string | null;
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

export function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    const [orderRes, linesRes] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).single(),
      supabase.from('order_lines').select('*').eq('order_id', id),
    ]);
    if (orderRes.error) {
      setError(orderRes.error.message);
      return;
    }
    setOrder(orderRes.data as OrderRecord);
    setLines((linesRes.data ?? []) as OrderLine[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendInvoice(args: {
    invoiceUrl: string;
    subtotalCents: number;
    shippingCents: number;
  }) {
    if (!supabase || !order) return;
    const totalCents = args.subtotalCents + args.shippingCents;
    setBusy(true);
    setActionError(null);
    // Step 1: persist invoice metadata + status transition via RPC. Doing the
    // RPC first means even if the email send fails the order isn't stranded
    // in a "phantom invoice_sent" state — and if the RPC fails we abort.
    const { error: rpcError } = await supabase.rpc('mark_order_invoiced', {
      p_order_id: order.id,
      p_invoice_url: args.invoiceUrl,
      p_invoice_amount_cents: totalCents,
      p_payment_method: 'Zelle (ops@vsresearchlabs.com)',
      p_subtotal_cents: args.subtotalCents,
      p_shipping_cents: args.shippingCents,
    });
    if (rpcError) {
      setBusy(false);
      setActionError(`Invoice transition failed: ${rpcError.message}`);
      return;
    }
    // Step 2: fire the email. Email failure is logged but does not roll
    // the order back — admin can re-send manually if needed.
    const { error: emailError } = await supabase.functions.invoke('send-order-invoice', {
      body: { order_id: order.id, invoice_url: args.invoiceUrl },
    });
    setBusy(false);
    if (emailError) {
      setActionError(`Invoice marked sent, but email delivery failed: ${emailError.message}`);
    }
    load();
  }

  async function markPaid() {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('mark_order_paid', { p_order_id: order.id });
    setBusy(false);
    if (error) setActionError(error.message);
    else load();
  }

  async function confirmFulfilled(tracking: string | null, carrier: string | null) {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    // Step 1: atomic RPC — decrements stock + writes audit rows. If this
    // fails (e.g. insufficient stock), the whole transaction rolls back
    // and no email is sent.
    const { error: rpcError } = await supabase.rpc('confirm_order_fulfilled', {
      p_order_id: order.id,
      p_tracking_number: tracking || null,
      p_carrier: carrier || null,
    });
    if (rpcError) {
      setBusy(false);
      setActionError(rpcError.message);
      return;
    }
    // Step 2: notify the buyer. Email failure does not roll back the
    // fulfillment — admin can re-send by triggering the function manually
    // or by re-running this action (idempotency is on the email side,
    // not the stock side).
    const { error: emailError } = await supabase.functions.invoke(
      'send-shipment-notification',
      { body: { order_id: order.id } },
    );
    setBusy(false);
    if (emailError) {
      setActionError(
        `Order marked fulfilled and stock decremented, but shipment email failed: ${emailError.message}`,
      );
    }
    load();
  }

  async function cancel(reason: string) {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('cancel_order', {
      p_order_id: order.id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) setActionError(error.message);
    else load();
  }

  // Edit/attach tracking on an already-fulfilled order (no stock movement).
  async function saveTracking(carrier: string | null, tracking: string | null) {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('set_order_tracking', {
      p_order_id: order.id,
      p_carrier: carrier || null,
      p_tracking_number: tracking || null,
    });
    setBusy(false);
    if (error) setActionError(error.message);
    else load();
  }

  async function markDelivered() {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('mark_order_delivered', { p_order_id: order.id });
    if (error) {
      setBusy(false);
      setActionError(error.message);
      return;
    }
    // Completing the order emails the buyer their branded PAID receipt.
    // Email failure does not undo the delivered flag — admin can resend below.
    const { error: emailError } = await supabase.functions.invoke(
      'send-receipt',
      { body: { order_id: order.id } },
    );
    setBusy(false);
    if (emailError) {
      setActionError(`Marked delivered, but the receipt email failed: ${emailError.message}. Resend it below.`);
    }
    load();
  }

  // View the rendered receipt without sending (regenerated from the order).
  async function viewReceipt() {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { data, error } = await supabase.functions.invoke('send-receipt', {
      body: { order_id: order.id, preview: true },
    });
    setBusy(false);
    if (error) { setActionError(`Couldn't render receipt: ${error.message}`); return; }
    const html = (data as { html?: string })?.html;
    if (!html) { setActionError('No receipt was returned.'); return; }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Email (or re-email) the buyer their receipt.
  async function sendReceipt() {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { data, error } = await supabase.functions.invoke('send-receipt', {
      body: { order_id: order.id },
    });
    setBusy(false);
    if (error) { setActionError(`Receipt email failed: ${error.message}`); return; }
    const d = data as { skipped?: boolean; reason?: string };
    if (d?.skipped) { setActionError(d.reason ?? 'Receipt skipped.'); return; }
    load();
  }

  // Step the order back one stage (restocks if leaving fulfilled) + flag it.
  async function revertStatus(reason: string) {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('revert_order_status', {
      p_order_id: order.id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) { setActionError(error.message); return; }
    load();
  }

  async function clearFlag() {
    if (!supabase || !order) return;
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('clear_order_flag', { p_order_id: order.id });
    setBusy(false);
    if (error) { setActionError(error.message); return; }
    load();
  }

  return (
    <AdminLayout>
      <button
        type="button"
        onClick={() => navigate('/admin/orders')}
        className="text-[10px] uppercase tracking-[0.22em] text-ink/45 hover:text-ink/80 transition-colors mb-[var(--space-5)]"
      >
        ← All orders
      </button>

      {error && <p role="alert" className="text-[12px] text-red-400">{error}</p>}
      {!order && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {order && (
        <>
          <header className="mb-[var(--space-6)] pb-[var(--space-5)] border-b border-ink/[0.06]">
            <div className="flex items-start justify-between gap-[var(--space-4)] flex-wrap">
              <div>
                <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
                  Order · {formatTs(order.created_at)}
                </p>
                <h2 className="font-mono text-[clamp(1.2rem,2.4vw,1.6rem)] text-ink tracking-[0.04em]">
                  {order.order_number}
                </h2>
              </div>
              <OrderStatusChip status={order.status} deliveredAt={order.delivered_at} />
            </div>
            <dl className="mt-[var(--space-4)] grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-4)] text-[12px]">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-ink/40 mb-0.5">Buyer</dt>
                <dd className="text-ink/85">{order.buyer_name}</dd>
                <dd className="text-ink/55">{order.buyer_contact}</dd>
                {order.buyer_organization && <dd className="text-ink/55">{order.buyer_organization}</dd>}
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-ink/40 mb-0.5">Invoice</dt>
                <dd className="text-ink/85 font-mono tabular-nums">{formatCents(order.invoice_amount_cents)}</dd>
                <dd className="text-ink/55">{order.payment_method ?? '—'}</dd>
                {order.invoice_url && (
                  <dd>
                    <a href={order.invoice_url} target="_blank" rel="noopener noreferrer" className="text-holo-light/85 text-[11.5px] underline underline-offset-4 decoration-holo/30 hover:decoration-holo/60">
                      Open invoice ↗
                    </a>
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-ink/40 mb-0.5">Timeline</dt>
                <dd className="text-ink/70 font-mono text-[11px] tabular-nums">
                  {order.invoiced_at && <>Invoiced: {formatTs(order.invoiced_at)}<br/></>}
                  {order.paid_at && <>Paid: {formatTs(order.paid_at)}<br/></>}
                  {order.fulfilled_at && <>Shipped: {formatTs(order.fulfilled_at)}<br/></>}
                  {order.cancelled_at && <>Cancelled: {formatTs(order.cancelled_at)}</>}
                  {!order.invoiced_at && !order.paid_at && !order.fulfilled_at && !order.cancelled_at && '—'}
                </dd>
              </div>
            </dl>
            {order.notes && (
              <p className="mt-[var(--space-4)] text-[12.5px] text-ink/70 leading-relaxed max-w-[72ch]">
                <span className="text-[10px] uppercase tracking-[0.22em] text-ink/35 mr-2">Notes</span>
                {order.notes}
              </p>
            )}
            {order.cancellation_reason && (
              <p className="mt-[var(--space-3)] text-[12.5px] text-red-300/75 leading-relaxed max-w-[72ch]">
                <span className="text-[10px] uppercase tracking-[0.22em] text-red-400/65 mr-2">Cancelled</span>
                {order.cancellation_reason}
              </p>
            )}
          </header>

          {order.flag_note && (
            <div className="mb-[var(--space-6)] rounded-sm border border-red-400/45 bg-red-400/[0.06] p-[var(--space-4)]">
              <div className="flex items-start justify-between gap-[var(--space-4)]">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-red-400/80 mb-[var(--space-1)]">
                    ⚠ Flagged{order.flagged_at && ` · ${formatTs(order.flagged_at)}`}
                  </p>
                  <p className="text-[13px] text-red-400/90 leading-relaxed">{order.flag_note}</p>
                </div>
                <button
                  type="button"
                  onClick={clearFlag}
                  disabled={busy}
                  className="shrink-0 rounded-full border border-ink/15 px-[var(--space-3)] py-[var(--space-1)] text-[9.5px] uppercase tracking-[0.18em] text-ink/60 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
                >
                  Clear flag
                </button>
              </div>
            </div>
          )}

          <section className="mb-[var(--space-8)]">
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
              Lines
            </p>
            <div className="research-surface-solid overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-ink/[0.08]">
                    <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[170px]">SKU</th>
                    <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Product</th>
                    <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[80px]">Qty</th>
                    <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal w-[100px]">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-ink/[0.04]">
                      <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] font-mono text-[11.5px] text-holo-light/80">{line.sku}</td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] text-[12.5px] text-ink/80">
                        {line.product_name}
                        {line.item_note && (
                          <div className="text-[11px] text-ink/45 mt-0.5">Note: {line.item_note}</div>
                        )}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] text-right font-mono tabular-nums text-[12px] text-ink/85">{line.quantity}</td>
                      <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-right font-mono tabular-nums text-[12px] text-ink/55">{formatCents(line.unit_price_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {actionError && (
            <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{actionError}</p>
          )}

          <ActionPanel
            status={order.status}
            busy={busy}
            defaultInvoiceAmount={order.invoice_amount_cents}
            defaultInvoiceUrl={order.invoice_url}
            currentCarrier={order.carrier}
            currentTracking={order.tracking_number}
            deliveredAt={order.delivered_at}
            onSendInvoice={sendInvoice}
            onMarkPaid={markPaid}
            onConfirmFulfilled={confirmFulfilled}
            onSaveTracking={saveTracking}
            onMarkDelivered={markDelivered}
            onCancel={cancel}
          />

          <RecoveryPanel
            status={order.status}
            busy={busy}
            receiptSentAt={order.receipt_sent_at}
            receiptCount={order.receipt_count}
            paidAt={order.paid_at}
            onViewReceipt={viewReceipt}
            onSendReceipt={sendReceipt}
            onRevert={revertStatus}
          />
        </>
      )}
    </AdminLayout>
  );
}

/* ── Receipt + status-revert (recovery) ──────────────────────────────────── */

interface RecoveryPanelProps {
  status: OrderStatus;
  busy: boolean;
  receiptSentAt: string | null;
  receiptCount: number | null;
  paidAt: string | null;
  onViewReceipt: () => void;
  onSendReceipt: () => void;
  onRevert: (reason: string) => void;
}

function RecoveryPanel({
  status, busy, receiptSentAt, receiptCount, paidAt,
  onViewReceipt, onSendReceipt, onRevert,
}: RecoveryPanelProps) {
  const [reason, setReason] = useState('');
  // A receipt is meaningful once payment is on record.
  const paymentOnRecord = !!paidAt || status === 'paid' || status === 'fulfilled';
  // Anything past the first stage (or terminal) can be stepped back / revived.
  const canRevert = status !== 'pending_invoice';

  const revertLabel =
    status === 'cancelled' || status === 'refunded' ? 'Revive to pending'
    : status === 'fulfilled' ? 'Revert (un-ship / restock)'
    : 'Revert one stage';

  if (!paymentOnRecord && !canRevert) return null;

  return (
    <section className="mt-[var(--space-8)]">
      <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
        Receipt &amp; recovery
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
        {paymentOnRecord && (
          <ActionCard title="Receipt">
            <p className="text-[11px] text-ink/45 leading-relaxed mb-[var(--space-4)]">
              The branded PAID receipt is regenerated from this order, so it's always
              retrievable. It's emailed automatically on delivery; view or resend it anytime.
            </p>
            <p className="text-[11.5px] text-ink/65 mb-[var(--space-4)] font-mono">
              {receiptSentAt
                ? `Last sent ${formatTs(receiptSentAt)}${receiptCount && receiptCount > 1 ? ` · ${receiptCount}×` : ''}`
                : 'Not sent yet.'}
            </p>
            <div className="flex flex-wrap gap-[var(--space-3)]">
              <button
                type="button"
                onClick={onViewReceipt}
                disabled={busy}
                className="rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/75 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? '…' : 'View receipt'}
              </button>
              <button
                type="button"
                onClick={onSendReceipt}
                disabled={busy}
                className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Sending…' : receiptSentAt ? 'Resend receipt' : 'Send receipt'}
              </button>
            </div>
          </ActionCard>
        )}

        {canRevert && (
          <ActionCard title="Revert / flag" tone="danger">
            <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">
              Reason (recorded on the order)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. payment reversed / compromised"
              className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40 mb-[var(--space-3)]"
            />
            <p className="text-[11px] text-ink/45 leading-relaxed mb-[var(--space-4)]">
              Steps the order back one stage and stamps a visible flag.{' '}
              {status === 'fulfilled'
                ? 'Reverting a shipped order restocks every line.'
                : status === 'cancelled' || status === 'refunded'
                ? 'Revives a cancelled order to the start of the pipeline.'
                : 'No stock moves at this stage.'}
            </p>
            <button
              type="button"
              onClick={() => onRevert(reason.trim() || 'Reverted by admin')}
              disabled={busy}
              className="rounded-full bg-red-400/[0.10] border border-red-400/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-red-300 hover:bg-red-400/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Reverting…' : revertLabel}
            </button>
          </ActionCard>
        )}
      </div>
    </section>
  );
}

interface ActionPanelProps {
  status: OrderStatus;
  busy: boolean;
  defaultInvoiceAmount: number | null;
  defaultInvoiceUrl: string | null;
  currentCarrier: string | null;
  currentTracking: string | null;
  deliveredAt: string | null;
  onSendInvoice: (args: { invoiceUrl: string; subtotalCents: number; shippingCents: number }) => void;
  onMarkPaid: () => void;
  onConfirmFulfilled: (tracking: string | null, carrier: string | null) => void;
  onSaveTracking: (carrier: string | null, tracking: string | null) => void;
  onMarkDelivered: () => void;
  onCancel: (reason: string) => void;
}

function ActionPanel({
  status, busy,
  defaultInvoiceAmount, defaultInvoiceUrl,
  currentCarrier, currentTracking, deliveredAt,
  onSendInvoice, onMarkPaid, onConfirmFulfilled, onSaveTracking, onMarkDelivered, onCancel,
}: ActionPanelProps) {
  const [invoiceUrl, setInvoiceUrl] = useState(defaultInvoiceUrl ?? '');
  const [subtotalUsd, setSubtotalUsd] = useState(
    defaultInvoiceAmount !== null && defaultInvoiceAmount !== undefined
      ? (defaultInvoiceAmount / 100).toFixed(2)
      : '',
  );
  const [shippingUsd, setShippingUsd] = useState('');
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('usps');
  const [cancelReason, setCancelReason] = useState('');

  // Fulfilled orders get a tracking-edit + delivered surface, not a dead end.
  if (status === 'fulfilled') {
    return (
      <FulfilledActions
        busy={busy}
        currentCarrier={currentCarrier}
        currentTracking={currentTracking}
        deliveredAt={deliveredAt}
        onSaveTracking={onSaveTracking}
        onMarkDelivered={onMarkDelivered}
      />
    );
  }

  if (status === 'cancelled' || status === 'refunded') {
    return (
      <section className="research-surface-solid p-[var(--space-5)]">
        <p className="text-[12px] text-ink/55">
          This order is in a terminal state. No further actions are available.
        </p>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
      {status === 'pending_invoice' && (
        <ActionCard title="Send invoice">
          <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Invoice reference URL (optional)</label>
          <input
            type="url"
            value={invoiceUrl}
            onChange={(e) => setInvoiceUrl(e.target.value)}
            placeholder="External invoice link if you have one"
            className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40 mb-[var(--space-3)]"
          />
          <div className="grid grid-cols-2 gap-[var(--space-3)] mb-[var(--space-2)]">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Subtotal (USD)</label>
              <input
                type="number" step="0.01" min="0"
                value={subtotalUsd}
                onChange={(e) => setSubtotalUsd(e.target.value)}
                placeholder="0.00"
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Shipping (USD)</label>
              <input
                type="number" step="0.01" min="0"
                value={shippingUsd}
                onChange={(e) => setShippingUsd(e.target.value)}
                placeholder="0.00"
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40"
              />
            </div>
          </div>
          <div className="flex items-baseline justify-between border-y border-ink/10 py-[var(--space-2)] mb-[var(--space-4)]">
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink/45">Total</span>
            <span className="font-mono tabular-nums text-[15px] text-ink">${(((parseFloat(subtotalUsd) || 0) + (parseFloat(shippingUsd) || 0))).toFixed(2)}</span>
          </div>
          <p className="text-[11px] text-ink/45 mb-[var(--space-4)] leading-relaxed">
            Emails a fully-branded invoice (subtotal, shipping, total) with Zelle
            payment instructions to{' '}
            <span className="font-mono text-ink/70">info@velariss.co</span>.
            Buyer is told to label the payment with the order number.
            Status flips to <span className="font-mono">invoice_sent</span>.
          </p>
          <button
            type="button"
            onClick={() => {
              const subC = Math.round(parseFloat(subtotalUsd) * 100);
              const shipC = Math.round(parseFloat(shippingUsd) * 100);
              if (!Number.isFinite(subC) || subC < 0) return;
              const ship = Number.isFinite(shipC) && shipC >= 0 ? shipC : 0;
              onSendInvoice({
                invoiceUrl: invoiceUrl.trim(),
                subtotalCents: subC,
                shippingCents: ship,
              });
            }}
            disabled={busy || !Number.isFinite(parseFloat(subtotalUsd))}
            className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Sending…' : 'Send invoice + email'}
          </button>
        </ActionCard>
      )}

      {status === 'invoice_sent' && (
        <ActionCard title="Confirm payment received">
          <p className="text-[12px] text-ink/70 mb-[var(--space-4)] leading-relaxed">
            Mark the order as paid once funds have been received via PayPal F&amp;F or Zelle.
            Stock is NOT decremented at this step.
          </p>
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={busy}
            className="rounded-full bg-[#2E7D5B]/[0.12] border border-[#2E7D5B]/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-[#2E7D5B] hover:bg-[#2E7D5B]/[0.18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Updating…' : 'Mark paid'}
          </button>
        </ActionCard>
      )}

      {status === 'paid' && (
        <ActionCard title="Confirm fulfillment">
          <div className="grid grid-cols-[110px_1fr] gap-[var(--space-3)] mb-[var(--space-3)]">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Carrier</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink focus:outline-none focus:border-ink/40"
              >
                {CARRIERS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Tracking number (optional)</label>
              <input
                type="text"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="e.g. 9400 1000 0000 0000 0000 00"
                className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40"
              />
            </div>
          </div>
          <p className="text-[11px] text-ink/45 leading-relaxed mb-[var(--space-4)]">
            <strong className="text-ink/75">Decrements stock for every line.</strong>{' '}
            If any SKU is short, the entire transaction rolls back and no
            stock moves. Each line writes a row to{' '}
            <code className="font-mono text-holo-light/70">stock_movements</code>. The carrier +
            tracking number power the customer’s <span className="font-mono text-ink/70">/track</span> page.
          </p>
          <button
            type="button"
            onClick={() => onConfirmFulfilled(tracking.trim() || null, tracking.trim() ? carrier : null)}
            disabled={busy}
            className="rounded-full bg-holo/[0.15] border border-holo/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-holo-light hover:bg-holo/[0.22] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 0 8px rgba(52, 114, 122,0.28), inset 0 0 6px rgba(52, 114, 122,0.08)' }}
          >
            {busy ? 'Confirming…' : 'Confirm fulfilled — decrement stock'}
          </button>
        </ActionCard>
      )}

      <ActionCard title="Cancel order" tone="danger">
        <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Reason</label>
        <input
          type="text"
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Buyer changed mind / payment issue / etc."
          className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40 mb-[var(--space-3)]"
        />
        <p className="text-[11px] text-ink/45 leading-relaxed mb-[var(--space-4)]">
          {status === 'paid'
            ? 'Order is paid but not yet fulfilled. Cancelling does not move stock.'
            : 'Cancelling a fulfilled order would restock all lines. This order has not shipped yet.'}
        </p>
        <button
          type="button"
          onClick={() => onCancel(cancelReason.trim() || 'Cancelled by admin')}
          disabled={busy}
          className="rounded-full bg-red-400/[0.10] border border-red-400/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-red-300 hover:bg-red-400/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Cancelling…' : 'Cancel order'}
        </button>
      </ActionCard>
    </section>
  );
}

interface FulfilledActionsProps {
  busy: boolean;
  currentCarrier: string | null;
  currentTracking: string | null;
  deliveredAt: string | null;
  onSaveTracking: (carrier: string | null, tracking: string | null) => void;
  onMarkDelivered: () => void;
}

function FulfilledActions({
  busy, currentCarrier, currentTracking, deliveredAt, onSaveTracking, onMarkDelivered,
}: FulfilledActionsProps) {
  const [carrier, setCarrier] = useState(currentCarrier ?? 'usps');
  const [tracking, setTracking] = useState(currentTracking ?? '');
  const previewUrl = carrierTrackingUrl(carrier, tracking.trim());

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
      <ActionCard title={currentTracking ? 'Update tracking' : 'Add tracking'}>
        <div className="grid grid-cols-[110px_1fr] gap-[var(--space-3)] mb-[var(--space-3)]">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Carrier</label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink focus:outline-none focus:border-ink/40"
            >
              {CARRIERS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">Tracking number</label>
            <input
              type="text"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="e.g. 9400 1000 0000 0000 0000 00"
              className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-base-700 border border-ink/10 rounded-sm text-[12px] text-ink placeholder-ink/30 focus:outline-none focus:border-ink/40"
            />
          </div>
        </div>
        {previewUrl && (
          <p className="text-[11px] text-ink/45 mb-[var(--space-3)] truncate">
            Customer link: <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-holo-light/80 underline underline-offset-2">{carrierLabel(carrier)} ↗</a>
          </p>
        )}
        <button
          type="button"
          onClick={() => onSaveTracking(tracking.trim() ? carrier : null, tracking.trim() || null)}
          disabled={busy}
          className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Saving…' : 'Save tracking'}
        </button>
      </ActionCard>

      <ActionCard title="Delivery">
        {deliveredAt ? (
          <p className="text-[12px] text-[#2E7D5B]">
            Delivered {formatTs(deliveredAt)}.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-ink/45 leading-relaxed mb-[var(--space-4)]">
              Mark the order delivered once the carrier confirms it. This updates the
              customer’s <span className="font-mono text-ink/70">/track</span> page and is the
              trigger point for a delivered email / discount later.
            </p>
            <button
              type="button"
              onClick={onMarkDelivered}
              disabled={busy}
              className="rounded-full bg-[#2E7D5B]/[0.12] border border-[#2E7D5B]/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-[#2E7D5B] hover:bg-[#2E7D5B]/[0.18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Updating…' : 'Mark delivered'}
            </button>
          </>
        )}
      </ActionCard>
    </section>
  );
}

function ActionCard({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'danger' }) {
  return (
    <div
      className="research-surface-solid p-[var(--space-5)]"
      style={tone === 'danger' ? { borderColor: 'rgba(255, 122, 122, 0.15)' } : undefined}
    >
      <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">{title}</p>
      {children}
    </div>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
