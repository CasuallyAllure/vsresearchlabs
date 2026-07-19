// supabase/functions/reconcile/index.ts
//
// Deno shim for the reward-voucher reconciliation probe (verify_jwt = false
// in config.toml — the uptime cron sends no Supabase JWT). The WHOLE
// orchestration lives in handler.ts (Deno-free, driven directly by
// tests/unit/reconcileHandler.test.ts; the response-planning half was
// already extracted to reconcilePlan.ts with its own suite). This file only
// reads env once at cold start (same semantics as the old module-load
// consts), wires the real fetch + telemetry, and mounts the handler under
// Deno.serve. Keep it dumb — any new decision logic belongs in handler.ts
// where tests can see it.
//
// Alerting: .github/workflows/uptime.yml greps this body for `"clean":true`
// and fails the workflow otherwise — GitHub's scheduled-failure email is the
// pager, the same channel as every other probe. No Resend send from here: a
// detect-only mismatch can legitimately stay open for days awaiting a human,
// and a 15-minute email loop would train the operator to ignore the pager.

import { logEvent } from "../_shared/telemetry.ts";
import { createReconcileHandler } from "./handler.ts";

const handleReconcile = createReconcileHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  },
  { fetch: (input, init) => fetch(input, init), logEvent },
);

Deno.serve(handleReconcile);
