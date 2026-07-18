// supabase/functions/reconcile/index.ts
//
// Reward-voucher reconciliation probe (verify_jwt = false in config.toml —
// the uptime cron sends no Supabase JWT). Runs the
// reconcile_reward_vouchers(p_repair => true) RPC (migration 067), which
// detects every reward mismatch state left by the order-persist→voucher-claim
// crash window and auto-repairs the one deterministic, money-invisible state
// (the missing source='reward' order_coupons row).
//
// Public by design, and safe to be: the repair is idempotent (ON CONFLICT DO
// NOTHING), corroborated against the voucher math before any write, changes
// no customer-visible amount, and the scan is bounded to 60 days — a hostile
// caller can only make the system re-verify itself. The response carries NO
// ids or amounts; mismatch details go to the structured function log only.
//
// Alerting: .github/workflows/uptime.yml greps this body for `"clean":true`
// and fails the workflow otherwise — GitHub's scheduled-failure email is the
// pager, the same channel as every other probe. No Resend send from here: a
// detect-only mismatch can legitimately stay open for days awaiting a human,
// and a 15-minute email loop would train the operator to ignore the pager.

import { logEvent } from "../_shared/telemetry.ts";
import { planReconcileResponse } from "./reconcilePlan.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FN = "reconcile";

Deno.serve(async (req: Request): Promise<Response> => {
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
});
