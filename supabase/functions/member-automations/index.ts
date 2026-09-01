// supabase/functions/member-automations/index.ts
//
// Deno shim for the membership automation runner (verify_jwt = false in
// config.toml — the scheduled GitHub workflow sends no Supabase JWT; the
// MANDATORY x-automations-secret header gate in handler.ts is the real
// authorization, and an unset AUTOMATIONS_CRON_SECRET fails closed with 503).
// The WHOLE orchestration lives in handler.ts (Deno-free, driven directly by
// tests/unit/memberAutomationsHandler.test.ts). This file only reads env once
// at cold start (same semantics as the old module-load consts), wires the
// real fetch + telemetry, and mounts the handler under Deno.serve. Keep it
// dumb — any new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL               (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   AUTOMATIONS_CRON_SECRET    (shared with the GitHub Actions secret)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//
// Alerting: .github/workflows/member-automations.yml fails on non-200 or any
// "error" in the body — GitHub's scheduled-failure email is the pager, the
// same channel as uptime.yml.

import { logEvent } from "../_shared/telemetry.ts";
import { createMemberAutomationsHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** settle_referral_conversions() (090) — service-role only, idempotent. Banks
 *  every referral order that qualified since the last run and mints each
 *  referrer's bonus code, so the referral_bonus notice below has something to
 *  send. Returns how many conversions it granted. */
async function settleReferrals(): Promise<number> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/settle_referral_conversions`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`referral settlement failed: PostgREST status ${res.status}`);
  const data = (await res.json()) as { granted?: number } | null;
  return Number(data?.granted ?? 0);
}

const handleMemberAutomations = createMemberAutomationsHandler(
  {
    supabaseUrl,
    serviceKey,
    cronSecret: Deno.env.get("AUTOMATIONS_CRON_SECRET") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
  },
  { fetch: (input, init) => fetch(input, init), logEvent, settleReferrals },
);

Deno.serve(handleMemberAutomations);
