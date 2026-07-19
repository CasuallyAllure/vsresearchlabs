// supabase/functions/mark-payment-claimed/handler.ts
// "✓ I've sent payment" — the WHOLE decision body, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (tests/unit/markPaymentClaimedHandler.test.ts).
// index.ts is now a thin Deno shim: it reads env, builds the real deps
// (supabase-js createClient, fetch), and mounts the handler this factory
// returns under Deno.serve. NOTHING in this file may reference Deno globals
// or jsr:/npm: imports — that is the whole point of the split.
//
// Handles the "✓ I've sent payment" button in the invoice email. The link
// from that button hits this function with `?t=<lookup_token>`. We:
//
//   1. Verify the token resolves to an order
//   2. Call mark_payment_claimed RPC to advance status invoice_sent →
//      payment_claimed (no-op if already past that stage)
//   3. Email the admin: "buyer claims paid for VSR-ORD-…"
//   4. Render a small HTML confirmation page back to the buyer
//
// The lookup_token (256-bit secret on every order, migration 019) is the
// authorization here — no admin auth required, no enumeration path.
//
// Env vars consumed (read by the shim):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — for RPC + lookup
//   RESEND_API_KEY, RESEND_FROM_EMAIL        — for admin notification
//   INQUIRY_TO_EMAIL                         — admin notification recipient
//   PUBLIC_SITE_URL                          — link back in the confirmation page
//   ZELLE_HANDLE                             — recipient hint in the admin email

import { EMAIL_BRAND } from "../_shared/emailBrand.ts";

// ---------------------------------------------------------------------------
// Config + injected dependencies (index.ts supplies the real ones)
// ---------------------------------------------------------------------------

/** Env-derived configuration — index.ts reads Deno.env once at cold start and
 *  passes the resolved values here, preserving the old module-load semantics. */
export interface ClaimHandlerConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  resendApiKey: string;
  fromEmail: string;
  businessEmail: string;
  zelleHandle: string;
  corsHeaders: Record<string, string>;
}

/** The structural slice of a supabase-js client this handler actually uses.
 *  Query-builder chains are typed loose (the real client's generics don't
 *  survive injection); every result is narrowed at the use site exactly as
 *  the pre-extraction code did. */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClaimQueryBuilder = any;

export interface ClaimSupabaseClient {
  from(table: string): ClaimQueryBuilder;
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

/** Runtime seams. Destructured below under the exact names the decision body
 *  has always used, so the body is byte-identical to the pre-extraction
 *  index.ts (`fetch` deliberately shadows the global inside the factory). */
export interface ClaimHandlerDeps {
  createClient: (url: string, key: string) => ClaimSupabaseClient;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createClaimHandler(
  cfg: ClaimHandlerConfig,
  deps: ClaimHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL         = cfg.supabaseUrl;
  const SUPABASE_SERVICE_KEY = cfg.supabaseServiceKey;
  const RESEND_API_KEY       = cfg.resendApiKey;
  const FROM_EMAIL           = cfg.fromEmail;
  const BUSINESS_EMAIL       = cfg.businessEmail;
  const SITE_URL             = EMAIL_BRAND.siteUrl;
  const ZELLE_HANDLE         = cfg.zelleHandle;

  const CORS_HEADERS = cfg.corsHeaders;

  const { createClient, fetch } = deps;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function paymentCode(orderNumber: string): string {
  const parts = orderNumber.split("-");
  return parts[parts.length - 1] || orderNumber;
}

// 302 redirect to the branded site. Redirects carry no body, so the edge
// runtime's HTML sandbox doesn't apply — the buyer lands on the real page.
function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...CORS_HEADERS },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ── Admin notification ──────────────────────────────────────────────────────

async function sendAdminNotification(args: {
  orderNumber: string;
  buyerName: string | null;
  buyerContact: string | null;
  totalCents: number | null;
}) {
  if (!RESEND_API_KEY) return;
  const { orderNumber, buyerName, buyerContact, totalCents } = args;
  const code = paymentCode(orderNumber);
  const total = totalCents !== null && totalCents !== undefined
    ? `$${(totalCents / 100).toFixed(2)}` : "—";

  const html = `
    <div style="font-family:Inter,system-ui,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:8px;">
      <div style="border:1px solid #c9cdd2;border-radius:8px;padding:18px 22px;background:#fafafa;">
        <div style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:10px;letter-spacing:0.3em;color:#34727A;text-transform:uppercase;margin-bottom:8px;">
          Buyer claims paid
        </div>
        <h2 style="font-weight:300;letter-spacing:0.02em;margin:0 0 14px;font-size:22px;">
          ${escapeHtml(orderNumber)}
        </h2>
        <table style="width:100%;font-size:13px;color:#444;margin:0 0 14px;border-collapse:collapse;">
          <tr><td style="padding:2px 0;color:#6a6f76;">Buyer</td><td style="padding:2px 0;text-align:right;">${escapeHtml(buyerName ?? "—")}</td></tr>
          <tr><td style="padding:2px 0;color:#6a6f76;">Contact</td><td style="padding:2px 0;text-align:right;font-family:monospace;">${escapeHtml(buyerContact ?? "—")}</td></tr>
          <tr><td style="padding:2px 0;color:#6a6f76;">Amount</td><td style="padding:2px 0;text-align:right;font-weight:600;color:#111;">${escapeHtml(total)}</td></tr>
          <tr><td style="padding:2px 0;color:#6a6f76;">Expected note</td><td style="padding:2px 0;text-align:right;font-family:monospace;font-weight:700;color:#111;">${escapeHtml(code)}</td></tr>
        </table>
        <div style="border:1px solid #dcdcdc;border-radius:6px;padding:12px 14px;background:#fff;color:#333;font-size:13px;">
          <strong style="display:block;margin-bottom:4px;color:#111;">Action</strong>
          Check <span style="font-family:monospace;">${escapeHtml(ZELLE_HANDLE)}</span> for a payment
          with note <span style="font-family:monospace;font-weight:700;">${escapeHtml(code)}</span>.
          Once verified, mark the order Paid in Admin → Orders.
        </div>
      </div>
      <p style="margin-top:16px;color:#888;font-size:11px;text-align:center;">
        Order is now in <strong>payment_claimed</strong> status — buyer-asserted, not yet verified.
      </p>
    </div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: BUSINESS_EMAIL,
      subject: `${orderNumber} — buyer claims paid (${total})`,
      html,
    }),
  }).catch((err) => console.error("Admin notification email failed:", err));
}

// ── Handler ─────────────────────────────────────────────────────────────────

const handleClaim = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  // Token can come from ?t=<token> (GET, from the email link) or JSON body
  // {token: "..."} (POST, for programmatic use).
  let token: string | null = null;
  if (req.method === "GET") {
    const url = new URL(req.url);
    token = url.searchParams.get("t");
  } else if (req.method === "POST") {
    try {
      const body = await req.json();
      token = typeof body?.token === "string" ? body.token : null;
    } catch { /* fall through */ }
  } else {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Supabase's edge runtime force-sandboxes anonymous HTML responses
  // (content-type → text/plain, CSP → sandbox) so functions can't be used as
  // HTML hosts — which means a page rendered here shows up as raw source in the
  // browser. So instead of serving HTML, we redirect the buyer to the real
  // branded site (/track), which renders their order natively. The token in the
  // link is the buyer's authorization to view it.
  if (!token || token.length < 32) {
    return redirect(`${SITE_URL}/track`);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return redirect(`${SITE_URL}/track?t=${encodeURIComponent(token)}&error=1`);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Resolve token → order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, order_number, buyer_name, buyer_contact, invoice_amount_cents, subtotal_cents")
    .eq("lookup_token", token)
    .single();

  if (orderErr || !order) {
    // Invalid/expired token — let /track render its own branded "link invalid".
    return redirect(`${SITE_URL}/track?t=${encodeURIComponent(token)}`);
  }

  // Advance status (idempotent at the RPC level)
  const { error: rpcErr } = await supabase.rpc("mark_payment_claimed", { p_order_id: order.id });
  if (rpcErr) {
    console.error("mark_payment_claimed failed:", rpcErr);
    return redirect(`${SITE_URL}/track?t=${encodeURIComponent(token)}&error=1`);
  }

  // Fire admin notification (best-effort; failure here doesn't break the buyer flow)
  await sendAdminNotification({
    orderNumber: order.order_number,
    buyerName: order.buyer_name,
    buyerContact: order.buyer_contact,
    totalCents: order.invoice_amount_cents ?? order.subtotal_cents ?? null,
  });

  // Land the buyer on their branded order page with a "payment recorded" banner.
  return redirect(`${SITE_URL}/track?t=${encodeURIComponent(token)}&claimed=1`);
};

  return handleClaim;
}
