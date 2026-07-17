/**
 * Shared edge telemetry — structured logging + operator alerting.
 *
 * Two jobs:
 *   1. `logEvent` / `captureException` emit ONE line of JSON per event so
 *      Supabase function logs are greppable by function name and order
 *      number, instead of the free-text `console.error` soup they are now.
 *   2. `alertOperator` sends an email when an order/payment path fails, so a
 *      failure cannot happen silently.
 *
 * Design rules:
 *   - Nothing here may throw. Telemetry that breaks the request it is
 *     observing is worse than no telemetry. Every path is guarded and
 *     degrades to a console line.
 *   - No PII beyond the contact string already present in the order record,
 *     and only in the alert email (which goes to the operator, not a vendor).
 *   - No new dependency and no new vendor: the sink is Supabase's own
 *     function logs, the pager is the Resend account that already sends
 *     invoices.
 */

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>";
/** Where failure alerts land. Falls back to the existing business inbox. */
const ALERT_TO_EMAIL =
  Deno.env.get("ALERT_TO_EMAIL") ?? Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com";
/** Set to "0"/"false" to silence alert emails without a redeploy of the logic. */
const ALERTS_ENABLED = !["0", "false", "off"].includes(
  (Deno.env.get("ALERTS_ENABLED") ?? "1").toLowerCase(),
);

const MAX_MESSAGE_CHARS = 1000;
const MAX_STACK_CHARS = 4000;

export type Severity = "info" | "warn" | "error" | "fatal";

/**
 * Identifiers that make a log line joinable back to a real order.
 * All optional — some failures happen before an order number exists.
 */
export interface EventContext {
  orderNumber?: string | null;
  referenceId?: string | null;
  orderId?: string | null;
  /** Coarse label for where in the handler this fired, e.g. "order_insert". */
  stage?: string | null;
  [key: string]: unknown;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `…[+${s.length - max} chars]`;
}

/** Normalize anything thrown into a {name, message, stack} triple. */
export function describeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: truncate(err.message, MAX_MESSAGE_CHARS),
      stack: err.stack ? truncate(err.stack, MAX_STACK_CHARS) : undefined,
    };
  }
  if (typeof err === "object" && err !== null) {
    // Supabase/PostgREST errors are plain objects: {message, code, details, hint}.
    const o = err as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message : JSON.stringify(o);
    return { name: typeof o.code === "string" ? `PostgrestError(${o.code})` : "Object", message: truncate(message, MAX_MESSAGE_CHARS) };
  }
  return { name: typeof err, message: truncate(String(err), MAX_MESSAGE_CHARS) };
}

/** Drop null/undefined context keys so log lines stay readable. */
export function compactContext(ctx: EventContext = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * One structured JSON line. Greppable:
 *   `"fn":"place-order"` · `"orderNumber":"VSR-XXXXXX"` · `"severity":"fatal"`
 */
export function logEvent(
  severity: Severity,
  fn: string,
  message: string,
  ctx: EventContext = {},
): void {
  const line = {
    telemetry: 1,
    severity,
    fn,
    message: truncate(message, MAX_MESSAGE_CHARS),
    at: new Date().toISOString(),
    ...compactContext(ctx),
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(line);
  } catch {
    // Circular context — fall back to the identifying fields only.
    serialized = JSON.stringify({ telemetry: 1, severity, fn, message: truncate(message, MAX_MESSAGE_CHARS), at: line.at });
  }
  if (severity === "error" || severity === "fatal") console.error(serialized);
  else if (severity === "warn") console.warn(serialized);
  else console.log(serialized);
}

/** Structured log for a thrown/returned error. Never throws. */
export function captureException(fn: string, err: unknown, ctx: EventContext = {}): void {
  try {
    const d = describeError(err);
    logEvent("error", fn, `${d.name}: ${d.message}`, { ...ctx, stack: d.stack });
  } catch {
    console.error("telemetry captureException failed", fn);
  }
}

function alertHtml(args: {
  fn: string;
  stage: string;
  summary: string;
  detail: string;
  ctx: Record<string, unknown>;
}): string {
  const rows = Object.entries(args.ctx)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px;">${escape(k)}</td>` +
        `<td style="padding:4px 0;font-family:monospace;font-size:12px;color:#111;">${escape(String(v))}</td></tr>`,
    )
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a00;">Order path failure</p>
    <h1 style="margin:0 0 14px;font-size:19px;font-weight:600;color:#111;">${escape(args.summary)}</h1>
    <table style="border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px;">function</td>
          <td style="padding:4px 0;font-family:monospace;font-size:12px;color:#111;">${escape(args.fn)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px;">stage</td>
          <td style="padding:4px 0;font-family:monospace;font-size:12px;color:#111;">${escape(args.stage)}</td></tr>
      ${rows}
    </table>
    <pre style="background:#fafafa;border:1px solid #e4e4e4;border-radius:6px;padding:12px;font-size:11.5px;color:#333;white-space:pre-wrap;word-break:break-word;">${escape(args.detail)}</pre>
    <p style="margin-top:18px;color:#888;font-size:12px;">
      Automated alert · check Supabase → Edge Functions → logs and filter on the order number above.
    </p>
  </div>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Email the operator that an order/payment path failed, and log the same
 * event structurally. Best-effort by construction: if Resend is the thing
 * that is down, the structured log line is still written, and that is the
 * fallback of record.
 *
 * Awaited by callers so the isolate does not get torn down mid-send, but it
 * never throws and never changes the caller's response.
 */
export async function alertOperator(args: {
  fn: string;
  stage: string;
  summary: string;
  error?: unknown;
  ctx?: EventContext;
}): Promise<void> {
  const ctx = compactContext({ ...args.ctx, stage: args.stage });
  const described = args.error !== undefined ? describeError(args.error) : null;
  const detail = described
    ? `${described.name}: ${described.message}${described.stack ? "\n\n" + described.stack : ""}`
    : args.summary;

  // The log line is unconditional — it is the record that survives an
  // email outage.
  logEvent("fatal", args.fn, `ALERT: ${args.summary}`, { ...ctx, detail: described?.message });

  if (!ALERTS_ENABLED || !RESEND_API_KEY) {
    logEvent("warn", args.fn, "Alert email skipped (alerts disabled or RESEND_API_KEY unset)", ctx);
    return;
  }

  try {
    const orderTag = typeof ctx.orderNumber === "string" ? ` ${ctx.orderNumber}` : "";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ALERT_TO_EMAIL,
        subject: `🚨 ${args.fn} failure${orderTag} — ${args.summary}`,
        html: alertHtml({ fn: args.fn, stage: args.stage, summary: args.summary, detail, ctx }),
        text: [
          `ORDER PATH FAILURE`,
          `function: ${args.fn}`,
          `stage:    ${args.stage}`,
          ...Object.entries(ctx).map(([k, v]) => `${k}: ${String(v)}`),
          ``,
          detail,
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      logEvent("error", args.fn, `Alert email rejected by Resend (status ${res.status})`, ctx);
    }
  } catch (err) {
    // Deliberately terminal: we are already in the failure path. Log and stop.
    logEvent("error", args.fn, `Alert email threw: ${describeError(err).message}`, ctx);
  }
}

/**
 * Wrap a handler so an unhandled throw is logged and alerted instead of
 * vanishing into a bare runtime 500.
 *
 * Rethrows deliberately: this is instrumentation, so the response the caller
 * sees is byte-identical to today's. Converting the runtime 500 into a
 * truthful JSON error is a separate, behavioral change.
 */
export function withTelemetry(
  fn: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      captureException(fn, err, { stage: "unhandled" });
      await alertOperator({
        fn,
        stage: "unhandled",
        summary: "Unhandled exception — request failed with a runtime 500",
        error: err,
        ctx: { method: req.method },
      });
      throw err;
    }
  };
}
