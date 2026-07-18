// supabase/functions/place-order/index.ts
// Deno shim for the auto-invoice checkout.
//
// The WHOLE orchestration lives in handler.ts (Deno-free, driven directly by
// the vitest orchestration suite — tests/unit/placeOrderHandler.*.test.ts).
// This file is the only place that touches Deno: it reads env once at cold
// start (same semantics as the old module-load consts), wires the real
// runtime dependencies, and mounts the handler under Deno.serve. Keep it
// dumb — any new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   RESEND_API_KEY
//   INQUIRY_TO_EMAIL        business inbox (default below)
//   RESEND_FROM_EMAIL       from header (default below)
//   ALLOWED_ORIGIN          production domain (falls back to vsresearchlabs.com if unset)
//   ZELLE_HANDLE            <-- SET THIS (phone/email Zelle is registered to)
//   BRAND_STAMP_URL         optional hosted PNG of the stamp for the email

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { alertOperator, logEvent, withTelemetry } from "../_shared/telemetry.ts";
import {
  createOrderHandler,
  TELEMETRY_FN,
  type OrderSupabaseClient,
} from "./handler.ts";

const handleOrder = createOrderHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    businessEmail: Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>",
    zelleHandle: Deno.env.get("ZELLE_HANDLE") ?? "info@velariss.co",
    brandStampUrl: Deno.env.get("BRAND_STAMP_URL") ?? "",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice OrderSupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key, options) =>
      createClient(url, key, options) as unknown as OrderSupabaseClient,
    fetch: (input, init) => fetch(input, init),
    verifyTurnstile,
    clientIp,
    alertOperator,
    logEvent,
  },
);

// Instrumentation only: an unhandled throw is logged + alerted, then
// rethrown so the response the caller sees is exactly what it is today.
Deno.serve(withTelemetry(TELEMETRY_FN, handleOrder));
