// supabase/functions/send-shipment-notification/index.ts
// Deno shim for the "Your order has shipped" notification.
//
// The WHOLE decision body lives in handler.ts (Deno-free, driven directly by
// the vitest suite — tests/unit/sendShipmentNotificationHandler.test.ts).
// This file is the only place that touches Deno: it reads env once at cold
// start (same semantics as the old module-load consts), wires the real
// runtime dependencies, and mounts the handler under Deno.serve. Keep it
// dumb — any new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars (same as send-order-invoice):
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected; used for the admin auth gate)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import {
  createShipmentNotificationHandler,
  type NotificationSupabaseClient,
} from "./handler.ts";

Deno.serve(createShipmentNotificationHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice NotificationSupabaseClient
    // names; the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) =>
      createClient(url, key) as unknown as NotificationSupabaseClient,
    fetch: (input, init) => fetch(input, init),
    requireAdmin,
  },
));
