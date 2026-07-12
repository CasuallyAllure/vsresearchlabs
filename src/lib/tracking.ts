/**
 * tracking — carrier deep-links + order-status presentation.
 *
 * No carrier API: we build the carrier's own tracking URL from the carrier +
 * number so the customer can follow the package on USPS/UPS/FedEx/DHL directly,
 * for $0. (A live in-site status feed would need AfterShip/EasyPost — a later
 * tier.) Status labels mirror the `lookup_order` SQL in migration 012.
 */

export type Carrier = 'usps' | 'ups' | 'fedex' | 'dhl' | 'hand_delivered';

export const CARRIERS: { value: Carrier; label: string }[] = [
  { value: 'usps', label: 'USPS' },
  { value: 'ups', label: 'UPS' },
  { value: 'fedex', label: 'FedEx' },
  { value: 'dhl', label: 'DHL' },
  { value: 'hand_delivered', label: 'Hand delivered (in-person)' },
];

const CARRIER_LABELS: Record<string, string> = {
  usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL',
  hand_delivered: 'Hand delivered',
};

export function carrierLabel(carrier: string | null | undefined): string {
  if (!carrier) return 'Carrier';
  return CARRIER_LABELS[carrier.toLowerCase()] ?? carrier;
}

/** Carriers that don't need a tracking number — fulfillment / delivery is
 *  manual / in-person. The UI hides the tracking field for these. */
export function carrierRequiresTracking(carrier: string | null | undefined): boolean {
  return (carrier ?? '').toLowerCase() !== 'hand_delivered';
}

/** The carrier's own tracking page for a number. Null if we can't build one. */
export function carrierTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!trackingNumber) return null;
  const num = encodeURIComponent(trackingNumber.trim());
  switch ((carrier ?? '').toLowerCase()) {
    case 'usps':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
    case 'ups':
      return `https://www.ups.com/track?tracknum=${num}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
    case 'dhl':
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${num}`;
    case 'hand_delivered':
      // No external tracking page for in-person delivery.
      return null;
    default:
      // Unknown carrier — fall back to a Google search of the number.
      return `https://www.google.com/search?q=${num}+tracking`;
  }
}

// ── Status presentation ───────────────────────────────────────────────────────

export type OrderLookupStatus =
  | 'received'
  | 'awaiting_payment'
  | 'payment_verifying'   // buyer clicked "I've sent payment" — admin verifying
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderLookupResult {
  order_number: string;
  status: OrderLookupStatus | string;
  carrier: string | null;
  tracking_number: string | null;
  placed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

/** One itemized line of a token-gated invoice/receipt. */
export interface OrderInvoiceLine {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
}

/** One applied coupon (migrations 036/037) — for itemized invoice discount lines. */
export interface OrderInvoiceCoupon {
  code: string;
  kind: string;
  free_label: string | null;
  percent: number | null;
  amount_cents: number | null;
  discount_cents: number;
}

/**
 * Full invoice/receipt returned by `get_order_by_token` (migration 019).
 * Reachable only with the order's high-entropy secret token, so it may carry
 * financials + itemized lines — unlike the enumerable status lookup.
 */
export interface OrderInvoice {
  order_number: string;
  status: OrderLookupStatus | string;
  buyer_name: string | null;
  placed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  subtotal_cents: number | null;
  shipping_cents: number | null;
  total_cents: number | null;
  payment_method: string | null;
  paid: boolean;
  lines: OrderInvoiceLine[];
  discount_cents?: number | null;
  coupons?: OrderInvoiceCoupon[];
  // Shipping address + buyer double-confirmation (migration 041).
  ship_street: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  ship_confirmed_at: string | null;
}

/** Customer-facing label + one-line explanation + a 0–4 step index for a bar. */
export function statusPresentation(status: string): {
  label: string;
  detail: string;
  step: number; // 0..4 (received → delivered)
  tone: 'neutral' | 'progress' | 'done' | 'stopped';
} {
  switch (status) {
    case 'received':
      return { label: 'Order received', detail: 'We have your order and have sent your invoice. Check your email.', step: 0, tone: 'neutral' };
    case 'awaiting_payment':
      return { label: 'Awaiting payment', detail: 'Your invoice has been sent. We ship once payment clears — click "I’ve sent payment" in the invoice email after you pay.', step: 1, tone: 'neutral' };
    case 'payment_verifying':
      return { label: 'Verifying payment', detail: 'You marked your payment as sent — we’re confirming the deposit. This usually takes under a business day.', step: 2, tone: 'progress' };
    case 'processing':
      return { label: 'Processing', detail: 'Payment received — your order is being packed and will ship shortly.', step: 3, tone: 'progress' };
    case 'shipped':
      return { label: 'Shipped', detail: 'Your order is on its way. Track it with the carrier below.', step: 4, tone: 'progress' };
    case 'delivered':
      return { label: 'Delivered', detail: 'Your order was delivered. Thanks for your order.', step: 5, tone: 'done' };
    case 'cancelled':
      return { label: 'Cancelled', detail: 'This order was cancelled. Contact us if that’s unexpected.', step: 0, tone: 'stopped' };
    default:
      return { label: status, detail: '', step: 0, tone: 'neutral' };
  }
}

// 6 steps now (added "Verifying" between Invoiced and Processing) so the
// payment_verifying stage gets its own slot on the public progress bar.
export const STATUS_STEPS = ['Received', 'Invoiced', 'Verifying', 'Processing', 'Shipped', 'Delivered'];
