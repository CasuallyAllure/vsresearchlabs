// supabase/functions/health/handler.ts
// PUBLIC uptime probe — the whole decision body, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive every
// decision directly (method gate, db probe, degraded 503 path, exact
// {ok, db, ts} response shape) — same split as place-order/handler.ts.
// index.ts is now a thin Deno shim: it reads env once at cold start and
// mounts the handler this factory returns under Deno.serve. NOTHING in this
// file may reference Deno globals or jsr:/npm: imports — that is the whole
// point of the split.
//
// The DB probe is a single-row read of promo_settings (1 row, service-role,
// 5s timeout) via PostgREST directly — no SDK import, so the probe stays a
// tiny, fast cold start and never lies "up" because a cached client existed.
// No secrets, order data, or internals are ever included in the response.

/** Env-derived configuration — index.ts reads Deno.env once at cold start
 *  and passes the resolved values here, preserving the old module-load
 *  semantics. */
export interface HealthHandlerConfig {
  supabaseUrl: string;
  serviceKey: string;
}

/** Runtime seams. Destructured below under the exact names the probe body
 *  has always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface HealthHandlerDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createHealthHandler(
  cfg: HealthHandlerConfig,
  deps: HealthHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL = cfg.supabaseUrl;
  const SERVICE_KEY  = cfg.serviceKey;

  const { fetch } = deps;

  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }

    let dbOk = false;
    if (SUPABASE_URL && SERVICE_KEY) {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/promo_settings?select=id&limit=1`,
          {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            signal: AbortSignal.timeout(5000),
          },
        );
        dbOk = res.ok;
        await res.body?.cancel();
      } catch {
        dbOk = false;
      }
    }

    return new Response(
      JSON.stringify({ ok: dbOk, db: dbOk, ts: new Date().toISOString() }),
      {
        status: dbOk ? 200 : 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    );
  };
}
