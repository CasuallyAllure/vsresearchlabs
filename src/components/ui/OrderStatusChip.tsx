/**
 * OrderStatusChip — order status pill, shared by admin and the customer
 * portal.
 *
 * Two status vocabularies render through the same chip:
 *   - the internal `orders.status` enum (pending_review → … → fulfilled/
 *     refunded) — used by admin order lists and the portal's raw
 *     order-history select;
 *   - the public status mapping (`OrderLookupStatus`, `src/lib/tracking.ts`)
 *     returned by customer-facing RPCs (`get_order_by_token`, `get_my_order`).
 *
 * Promoted out of `src/pages/admin/AdminOrders.tsx`, which now re-exports
 * this component from its old location — admin behavior/pixels unchanged.
 */

import type { OrderLookupStatus } from '../../lib/tracking';

export type AdminOrderStatus =
  | 'pending_review'
  | 'pending_invoice'
  | 'invoice_sent'
  | 'payment_claimed'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type OrderStatusChipStatus = AdminOrderStatus | OrderLookupStatus;

interface OrderStatusChipProps {
  status: OrderStatusChipStatus;
  deliveredAt?: string | null;
}

const PUBLIC_LABEL: Record<OrderLookupStatus, string> = {
  received: 'received',
  awaiting_payment: 'awaiting payment',
  payment_verifying: 'verifying',
  processing: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

// Status colors route through the theme's --color-status-* tokens so the
// chips recolor correctly in dark mode (2026 register: pill shape, tinted
// fill + colored text carries meaning, hairline border stays quiet).
const STATUS_SUCCESS =
  'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]';
const STATUS_WARNING =
  'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]';
const STATUS_INFO =
  'border-ink/10 text-[color:var(--color-status-info)] bg-[color:var(--color-status-infoMuted)]';
const STATUS_ERROR =
  'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]';

const PUBLIC_CLASS: Record<OrderLookupStatus, string> = {
  received: 'border-ink/25 text-ink/80 bg-ink/[0.05]',
  awaiting_payment: 'border-holo/40 text-holo-light/80 bg-holo/[0.08]',
  payment_verifying: STATUS_INFO,
  processing: STATUS_WARNING,
  shipped: 'border-ink/15 text-ink/55 bg-ink/[0.02]',
  delivered: STATUS_SUCCESS,
  cancelled: STATUS_ERROR,
};

function isPublicStatus(status: OrderStatusChipStatus): status is OrderLookupStatus {
  return Object.prototype.hasOwnProperty.call(PUBLIC_LABEL, status);
}

/** Shared chip grammar — pill, 10px floor, quiet tracking. Reused by the
 *  bespoke status chips in admin (customers/inquiries) so all state pills
 *  read as one system. */
export const CHIP_BASE =
  'shrink-0 inline-flex items-center text-[10px] uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border';

export function OrderStatusChip({ status, deliveredAt }: OrderStatusChipProps) {
  // A fulfilled order with a delivery date reads as "delivered" — the
  // internal enum has no 'delivered' value, so delivered_at is the signal.
  if (deliveredAt && status === 'fulfilled') {
    return <span className={`${CHIP_BASE} ${STATUS_SUCCESS}`}>delivered</span>;
  }

  if (isPublicStatus(status)) {
    return <span className={`${CHIP_BASE} ${PUBLIC_CLASS[status]}`}>{PUBLIC_LABEL[status]}</span>;
  }

  let cls = '';
  let label = status.replace(/_/g, ' ');
  switch (status) {
    case 'pending_review':  cls = STATUS_WARNING; label = 'new'; break;
    case 'pending_invoice': cls = 'border-ink/25 text-ink/80 bg-ink/[0.05]'; break;
    case 'invoice_sent':    cls = 'border-holo/40 text-holo-light/80 bg-holo/[0.08]'; break;
    case 'payment_claimed': cls = STATUS_INFO; label = 'claims paid'; break;
    case 'paid':            cls = STATUS_SUCCESS; break;
    case 'fulfilled':       cls = 'border-ink/15 text-ink/55 bg-ink/[0.02]'; label = 'shipped'; break;
    case 'refunded':        cls = STATUS_ERROR; break;
  }
  return <span className={`${CHIP_BASE} ${cls}`}>{label}</span>;
}
