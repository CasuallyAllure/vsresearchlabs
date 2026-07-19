// supabase/functions/report-error/handler.ts
// Client error sink — the whole orchestration, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision path directly (OPTIONS preflight, method gate, per-IP rate limit,
// body-size cap, JSON validation, field sanitization/truncation, the exact
// log line written, exact response contracts) — same split as
// place-order/handler.ts. index.ts is now a thin Deno shim: it reads env
// once at cold start, wires the real telemetry, and mounts the handler this
// factory returns under Deno.serve. NOTHING in this file may reference Deno
// globals or jsr:/npm: imports — that is the whole point of the split.
//
// The `hits` rate-limit map moved from module scope to factory scope: the
// shim constructs ONE handler at cold start, so the map's lifetime is still
// exactly per-isolate in production, while each test harness gets a fresh
// window.
//
// Deliberately NOT alerting: client errors are noisy by nature (extensions,
// bots, offline blips). Alerting is reserved for the order path, which is
// instrumented server-side in place-order. This function is a sink, not a
// pager.
//
// This endpoint is public by necessity — a crashing client cannot
// authenticate. It is therefore treated as untrusted input: every field is
// validated and capped, and a per-IP rate limit keeps log spam bounded.

const TELEMETRY_FN = "report-error";

const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 3000;
const MAX_FIELD_CHARS = 300;
const MAX_CONTEXT_KEYS = 10;

const RATE_LIMIT_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;

const VALID_SOURCES = new Set(["boundary", "window", "rejection", "manual"]);

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

/** Env-derived configuration — index.ts reads Deno.env once at cold start
 *  (via buildCorsHeaders) and passes the resolved values here, preserving
 *  the old module-load semantics. */
export interface ReportErrorHandlerConfig {
  corsHeaders: Record<string, string>;
}

/** Runtime seams — the telemetry fns, injected because ../_shared/telemetry.ts
 *  reads Deno.env at module load (type-only references here are erased). */
export interface ReportErrorHandlerDeps {
  logEvent: typeof import("../_shared/telemetry.ts")["logEvent"];
  truncate: typeof import("../_shared/telemetry.ts")["truncate"];
}

export function createReportErrorHandler(
  cfg: ReportErrorHandlerConfig,
  deps: ReportErrorHandlerDeps,
): (req: Request) => Promise<Response> {
  const CORS_HEADERS = cfg.corsHeaders;

  const { logEvent, truncate } = deps;

/**
 * Per-isolate rate limit. Approximate by design: isolates come and go, so
 * this is a spam ceiling, not an access control. The endpoint exposes no
 * data and performs no writes, so approximate is sufficient.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string, now: number): boolean {
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_PER_WINDOW;
}

/** Drop stale buckets so the map cannot grow without bound. */
function sweep(now: number): void {
  if (hits.size < 500) return;
  for (const [ip, entry] of hits) if (now > entry.resetAt) hits.delete(ip);
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? truncate(v, max) : null;
}

/** Accept only known keys with known shapes; everything else is discarded. */
function sanitizeContext(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_CONTEXT_KEYS) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue; // no nesting
    out[k] = truncate(String(v), MAX_FIELD_CHARS);
  }
  return out;
}

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const now = Date.now();
    const ip = clientIp(req);
    sweep(now);
    if (rateLimited(ip, now)) {
      // Intentionally quiet: a rate-limited reporter should not itself
      // generate a log line per request.
      return new Response(null, { status: 429, headers: CORS_HEADERS });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large." }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const message = str(body.message, MAX_MESSAGE_CHARS);
    if (!message) {
      return new Response(JSON.stringify({ error: "message is required." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const source = typeof body.source === "string" && VALID_SOURCES.has(body.source) ? body.source : "unknown";

    logEvent("error", TELEMETRY_FN, message, {
      clientSource: source,
      errorName: str(body.name, MAX_FIELD_CHARS) ?? "Error",
      path: str(body.path, MAX_FIELD_CHARS),
      userAgent: str(body.userAgent, MAX_FIELD_CHARS),
      clientAt: str(body.at, 40),
      stack: str(body.stack, MAX_STACK_CHARS),
      ...sanitizeContext(body.context),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  };
}
