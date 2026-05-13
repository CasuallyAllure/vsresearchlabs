// Resend email helper — reference implementation for Edge Functions
// This file documents the email API shape. The actual Resend call happens
// in the stripe-webhook Edge Function (supabase/functions/stripe-webhook/index.ts).
// It is NOT imported or called from the frontend.

export interface OrderEmailPayload {
  to: string;
  orderId: string;
  customerName: string;
  totalCents: number;
  items: Array<{ name: string; quantity: number; priceCents: number }>;
}

/**
 * Sends an order confirmation email via Resend.
 * This function is called from the Edge Function runtime (Deno),
 * not from the browser. The apiKey is passed as a parameter.
 */
export async function sendOrderConfirmationEmail(
  apiKey: string,
  payload: OrderEmailPayload
) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VS Research Labs <orders@vsresearchlabs.com>',
      to: payload.to,
      subject: `Order Confirmation — ${payload.orderId}`,
      html: `
        <h1>Thank you for your order, ${payload.customerName}!</h1>
        <p>Order ID: ${payload.orderId}</p>
        <p>Total: $${(payload.totalCents / 100).toFixed(2)}</p>
        <hr />
        ${payload.items
          .map(
            (item) =>
              `<p>${item.name} × ${item.quantity} — $${(item.priceCents / 100).toFixed(2)}</p>`
          )
          .join('')}
        <hr />
        <p><em>For Research Purposes Only — Not for Human Use</em></p>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend error: ${response.statusText}`);
  }

  return response.json();
}
