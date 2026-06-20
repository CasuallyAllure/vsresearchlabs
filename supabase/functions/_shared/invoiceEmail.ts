// supabase/functions/_shared/invoiceEmail.ts
//
// Single source of truth for the branded buyer invoice email. Imported by BOTH:
//   • place-order        — sends the invoice inline at checkout (same reliable
//                          Resend path as the business notification), so the
//                          buyer copy no longer depends on a flaky internal
//                          function-to-function HTTP hop.
//   • send-order-invoice — re-fires the identical invoice later (admin re-send),
//                          re-reading the canonical order from Postgres.
//
// Keep ALL invoice presentation here so the two callers can never drift.

const ZELLE_EMAIL = Deno.env.get("ZELLE_HANDLE") ?? "ops@vsresearchlabs.com";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://vsresearchlabs.com").replace(/\/+$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const FUNCTIONS_BASE = (Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${SUPABASE_URL}/functions/v1`).replace(/\/+$/, "");

export interface OrderLine {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number | null;
  item_note: string | null;
}

export interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_contact: string;
  buyer_organization: string | null;
  invoice_url: string | null;
  invoice_amount_cents: number | null;
  subtotal_cents: number | null;
  shipping_cents: number | null;
  payment_method: string | null;
  status: string;
  notes: string | null;
  ship_street: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  created_at: string;
  lookup_token: string | null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function fmtUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

// Last segment of the order number — VSR-ORD-YYMMDD-NNN → NNN. That's the short
// code the buyer types in the Zelle/PayPal note.
export function paymentCode(orderNumber: string): string {
  const parts = orderNumber.split("-");
  return parts[parts.length - 1] || orderNumber;
}

export function invoiceSubject(order: Pick<OrderRow, "order_number" | "invoice_amount_cents">): string {
  return `Invoice ${order.order_number} · ${fmtUsd(order.invoice_amount_cents)} · VS Research Labs`;
}

export function buildInvoiceHtml(args: { order: OrderRow; lines: OrderLine[]; notes?: string }): string {
  const { order, lines, notes } = args;
  const subtotal = order.subtotal_cents;
  const shipping = order.shipping_cents;
  const total    = order.invoice_amount_cents;

  const notesBlock = notes && notes.trim()
    ? `<div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:22px 24px;margin-top:16px;">
        <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;font-weight:700;margin-bottom:10px;">Order Notes</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.7;">${escapeHtml(notes.trim()).replace(/\n/g, "<br/>")}</div>
      </div>`
    : "";

  const shipBlock = [
    order.ship_street,
    [order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(", "),
    order.ship_country,
  ].filter(Boolean).map(escapeHtml).join("<br/>");

  const lineRows = lines.map((l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;">
        ${escapeHtml(l.sku)}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;color:#1A1714;font-size:13px;">
        ${escapeHtml(l.product_name)}
        ${l.item_note ? `<div style="color:#6F665C;font-size:11px;margin-top:2px;">Note: ${escapeHtml(l.item_note)}</div>` : ""}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#1A1714;">
        ${l.quantity}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:#6F665C;">
        ${fmtUsd(l.unit_price_cents)}
      </td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Invoice ${escapeHtml(order.order_number)}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1714;">
  <div style="max-width:680px;margin:0 auto;padding:28px 14px;">

    <!-- Centered brand hero -->
    <div style="text-align:center;margin:0 0 28px;">
      <img src="https://vsresearchlabs.pages.dev/brand/vs-dna-s-full-colour.png" alt="VS Research Labs" width="96" height="96" style="display:inline-block;width:96px;height:96px;margin-bottom:14px;border:0;" />
      <div style="font-size:12px;letter-spacing:0.30em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:4px;">VS Research Labs</div>
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:14px;">Northern California Biopeptide Sciences</div>
      <span style="display:inline-block;padding:5px 13px;border-radius:999px;background:#FBF9F4;border:0.5px solid rgba(26,23,20,0.18);font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;letter-spacing:0.18em;color:#1A1714;text-transform:uppercase;">Invoice</span>
    </div>

    <!-- Order card -->
    <div style="background:#FBF9F4;border:1px solid rgba(26,23,20,0.10);border-radius:12px;padding:24px;">

      <!-- Centered Order Reference -->
      <div style="text-align:center;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #E4DFD5;">
        <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Order Reference</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:22px;letter-spacing:0.04em;color:#1A1714;font-weight:700;margin-bottom:6px;word-break:break-all;">${escapeHtml(order.order_number)}</div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;color:#6F665C;letter-spacing:0.08em;">${escapeHtml(order.created_at.slice(0, 10))} · ${escapeHtml(order.created_at.slice(11, 19))} UTC</div>
      </div>

      <!-- Bill To stacked above Ship To for symmetry -->
      <div style="margin-bottom:16px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Bill To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">
          <strong>${escapeHtml(order.buyer_name)}</strong><br/>
          ${escapeHtml(order.buyer_contact)}
          ${order.buyer_organization ? `<br/>${escapeHtml(order.buyer_organization)}` : ""}
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:6px;">Ship To</div>
        <div style="font-size:13px;color:#1A1714;line-height:1.55;">${shipBlock || '<span style="color:#A09689;">— to be provided —</span>'}</div>
      </div>

      <!-- Verify-before-you-pay notice. Last chance for the buyer to correct
           the shipping address or change the line items BEFORE paying. -->
      <div style="margin-bottom:22px;background:#F4EFE6;padding:12px 14px;border-radius:6px;border-left:2px solid #34727A;">
        <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:6px;">Before you pay — check this</div>
        <p style="margin:0 0 8px;font-size:12.5px;color:#1A1714;line-height:1.6;">
          <strong>Confirm your shipping address above is correct.</strong> Once
          you pay, that's where it ships — we are <strong>not responsible</strong>
          for orders sent to a wrong or incomplete address you provided.
        </p>
        <p style="margin:0;font-size:12.5px;color:#1A1714;line-height:1.6;">
          This is also your chance to <strong>add or remove items</strong>. Need a
          change? <strong>Reply to this email before paying</strong> and we'll send
          an updated invoice. Paying confirms the order exactly as shown.
        </p>
      </div>

      <!-- Items -->
      <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6F665C;margin-bottom:8px;">Items</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #E4DFD5;border-radius:6px;margin-bottom:14px;">
        <thead><tr style="background:#F4EFE6;">
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">SKU</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;">Item</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:60px;">Qty</th>
          <th style="padding:9px 14px;border-bottom:1px solid #E4DFD5;text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6F665C;font-weight:500;width:90px;">Unit</th>
        </tr></thead>
        <tbody>${lineRows}</tbody>
      </table>

      <!-- Totals -->
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Subtotal</td>
            <td style="padding:5px 14px;text-align:right;width:120px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${fmtUsd(subtotal ?? total)}</td></tr>
        <tr><td style="padding:5px 14px;text-align:right;font-size:12.5px;color:#6F665C;">Shipping estimate</td>
            <td style="padding:5px 14px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#1A1714;">${shipping !== null && shipping !== undefined ? fmtUsd(shipping) : '<span style="color:#A09689;">TBD</span>'}</td></tr>
        <tr style="border-top:1px solid #E4DFD5;">
          <td style="padding:14px 14px 6px;text-align:right;font-size:11px;color:#6F665C;letter-spacing:0.2em;text-transform:uppercase;">Total Due</td>
          <td style="padding:14px 14px 6px;text-align:right;font-family:'JetBrains Mono','SF Mono',monospace;font-size:20px;color:#1A1714;font-weight:700;">${fmtUsd(total)}</td>
        </tr>
      </table>
    </div>

    ${notesBlock}

    <!-- Payment instructions card -->
    <div style="background:#FBF9F4;border:1px solid rgba(52,114,122,0.35);border-radius:12px;padding:22px 24px;margin-top:16px;">
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:10px;">Payment Instructions</div>
      <p style="margin:0 0 12px;font-size:14px;color:#1A1714;line-height:1.6;">Please send <strong>${fmtUsd(total)}</strong> via <strong>Zelle</strong> to:</p>
      <div style="background:#F4EFE6;border:0.5px solid rgba(26,23,20,0.14);border-radius:6px;padding:12px 14px;margin-bottom:14px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:15px;color:#1A1714;letter-spacing:0.04em;word-break:break-all;"><strong>${escapeHtml(ZELLE_EMAIL)}</strong></div>

      <!-- Short payment code (last 3-4 digits of the order number) -->
      <div style="border:1px solid #c9cdd2;border-radius:8px;padding:14px 18px;margin:0 0 12px;background:#fff;text-align:center;">
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:10px;letter-spacing:0.3em;color:#6F665C;text-transform:uppercase;margin:0 0 8px;">
          Payment note · enter exactly
        </div>
        <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;font-size:34px;letter-spacing:0.18em;color:#1A1714;line-height:1;">
          ${escapeHtml(paymentCode(order.order_number))}
        </div>
        <div style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#6F665C;margin-top:8px;">
          That's all you type in the Zelle / PayPal note — no dashes, no letters.
        </div>
      </div>

      <p style="margin:0 0 14px;font-size:12px;color:#6F665C;line-height:1.55;">
        Your full reference is <span style="font-family:'JetBrains Mono','SF Mono',monospace;color:#1A1714;">${escapeHtml(order.order_number)}</span>
        — we use that on our end; you don't need to retype it.
      </p>

      <p style="margin:0;font-size:12.5px;color:#6F665C;line-height:1.6;background:#F4EFE6;padding:10px 14px;border-radius:6px;border-left:2px solid #34727A;">
        Send as <strong>family &amp; friends</strong> if Zelle prompts you to choose. Payments not sent as Friends &amp; Family will be rejected.
      </p>
    </div>

    ${order.lookup_token ? `
    <!-- "I've sent payment" CTA — buyer clicks this after they Zelle the money,
         which advances the order to payment_claimed and pings the admin to
         verify the deposit. -->
    <div style="text-align:center;margin-top:20px;">
      <a href="${FUNCTIONS_BASE}/mark-payment-claimed?t=${order.lookup_token}" style="display:inline-block;background:#34727A;color:#FBF9F4;text-decoration:none;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;padding:15px 32px;border-radius:999px;font-weight:600;">✓ I've sent payment</a>
      <div style="font-size:11px;color:#6F665C;margin-top:10px;line-height:1.5;">Click after you send the Zelle / PayPal payment — we'll verify the deposit and start fulfillment.</div>
    </div>

    <!-- Secondary: view / print invoice -->
    <div style="text-align:center;margin-top:14px;">
      <a href="${SITE_URL}/track?t=${order.lookup_token}" style="display:inline-block;color:#1A1714;text-decoration:underline;font-size:11.5px;letter-spacing:0.12em;text-transform:uppercase;">View &amp; print this invoice</a>
    </div>` : ""}

    <p style="margin:20px 4px 8px;font-size:13px;color:#1A1714;line-height:1.6;">
      Once payment is received and verified, your order moves to fulfillment and ships from our nearest warehouse (<strong>Sacramento</strong> or <strong>Vallejo, California</strong>). You'll receive a tracking number by email as soon as it leaves the dock.
    </p>

    <!-- Research-use disclaimer + purity guarantee. This is part of every
         invoice we issue — it sets the terms before payment, not after. -->
    <div style="margin-top:22px;padding:18px 22px;border:1px solid #E4DFD5;border-radius:12px;background:#FBF9F4;">
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:10px;">
        Terms · Research Use Only
      </div>
      <p style="margin:0 0 12px;font-size:12.5px;color:#1A1714;line-height:1.65;">
        Every compound in this order is sold strictly for
        <strong>laboratory research and professional B2B use</strong>.
        Not for human or veterinary consumption. By submitting this
        order you confirm you are a qualified researcher or authorized
        purchaser.
      </p>
      <div style="font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#34727A;font-weight:700;margin-bottom:10px;">
        Purity Guarantee
      </div>
      <p style="margin:0;font-size:12.5px;color:#1A1714;line-height:1.65;">
        All sales are <strong>final</strong> — we do not accept returns
        of opened research material. However, if independent third-party
        testing comes back below <strong>98–99% purity</strong>
        (compound-dependent), we'll either <strong>replace the affected
        product</strong> at our cost or issue a <strong>full refund</strong>,
        your choice. Send the lab report to
        <a href="mailto:ops@vsresearchlabs.com" style="color:#34727A;text-decoration:underline;">ops@vsresearchlabs.com</a>
        within 14 days of delivery and we'll handle it.
      </p>
    </div>
    <p style="margin:0 4px 16px;font-size:13px;color:#1A1714;line-height:1.6;">Questions? Simply reply to this email — your message lands on the same reference thread.</p>

    <div style="border-top:1px solid rgba(26,23,20,0.10);padding-top:14px;margin-top:20px;text-align:center;">
      <div style="font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#6F665C;margin-bottom:4px;">VS Research Labs · Northern California Biopeptide Sciences</div>
      <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#A09689;">For Research Purposes Only — Not for Human or Veterinary Use</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:10.5px;color:#A09689;margin-top:10px;letter-spacing:0.08em;">Reference ${escapeHtml(order.order_number)}</div>
    </div>
  </div>
</body></html>`;
}
