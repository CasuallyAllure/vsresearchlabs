// supabase/functions/reconcile/handler.ts
// Reward-voucher reconciliation probe — the whole orchestration, Deno-free.
//
// Extracted verbatim from index.ts (2026-07-18) so vitest can drive the
// probe's decisions directly (method gate, missing-env fail path, RPC
// success/HTTP-failure/throw paths, exact {ok, clean, repaired, ts} response
// shape, log-not-body detail routing) — same split as place-order/handler.ts.
// index.ts is now a thin Deno shim: it reads env once at cold start, wires
// the real fetch + telemetry, and mounts the handler this factory returns
// under Deno.serve. NOTHING in this file may reference Deno globals or
// jsr:/npm: imports — that is the whole point of the split.
//
// The response-planning half (planReconcileResponse) was ALREADY extracted to
// reconcilePlan.ts and has its own suite; this factory owns the remaining
// orchestration around it: the RPC call and the log/response assembly.
//
// Public by design, and safe to be: the repair is idempotent (ON CONFLICT DO
// NOTHING), corroborated against the voucher math before any write, changes
// no customer-visible amount, and the scan is bounded to 60 days — a hostile
// caller can only make the system re-verify itself. The response carries NO
// ids or amounts; mismatch details go to the structured function log only.

import { planReconcileResponse } from "./reconcilePlan.ts";

/** Env-derived configuration — index.ts reads Deno.env once at cold start
 *  and passes the resolved values here, preserving the old module-load
 *  semantics. */
export interface ReconcileHandlerConfig {
  supabaseUrl: string;
  serviceKey: string;
}

/** Runtime seams. Destructured below under the exact names the body has
 *  always used (`fetch` deliberately shadows the global inside the
 *  factory). */
export interface ReconcileHandlerDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  logEvent: typeof import("../_shared/telemetry.ts")["logEvent"];
}

export function createReconcileHandler(
  cfg: ReconcileHandlerConfig,
  deps: ReconcileHandlerDeps,
): (req: Request) => Promise<Response> {
  const SUPABASE_URL = cfg.supabaseUrl;
  const SERVICE_KEY = cfg.serviceKey;
  const FN = "reconcile";

  const { fetch, logEvent } = deps;

  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }

    let rpcData: unknown = null;
    let rpcError: { message?: string } | null = null;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      rpcError = { message: "missing runtime env (SUPABASE_URL / service key)" };
    } else {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reconcile_reward_vouchers`, {
          method: "POST",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_repair: true }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          rpcData = await res.json();
        } else {
          rpcError = { message: `PostgREST status ${res.status}: ${await res.text()}` };
        }
      } catch (err) {
        rpcError = { message: err instanceof Error ? err.message : String(err) };
      }
    }

    const plan = planReconcileResponse(rpcData, rpcError);
    if (plan.log) {
      // Full summary (ids included) goes to the log line, never the body.
      logEvent(plan.log.severity, FN, plan.log.message, { summary: rpcData });
    }

    return new Response(JSON.stringify({ ...plan.body, ts: new Date().toISOString() }), {
      status: plan.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  };
}
