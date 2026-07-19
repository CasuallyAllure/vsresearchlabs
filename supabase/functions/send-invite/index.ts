// supabase/functions/send-invite/index.ts
//
// Deno shim for the branded admin "send invite" email — invites a guest
// (order/inquiry contact) to create a portal account and claim their banked
// reward points. The WHOLE orchestration lives in handler.ts (Deno-free,
// driven directly by tests/unit/sendInviteHandler.test.ts). This file only
// reads env once at cold start (same semantics as the old module-load
// consts), wires the real requireAdmin + fetch, and mounts the handler under
// Deno.serve. Keep it dumb — any new decision logic belongs in handler.ts
// where tests can see it.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected; used for the admin auth gate)
//   SUPABASE_ANON_KEY         (auto-injected; used for the admin auth gate)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import { createSendInviteHandler } from "./handler.ts";

const handleSendInvite = createSendInviteHandler(
  {
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  { requireAdmin, fetch: (input, init) => fetch(input, init) },
);

Deno.serve(handleSendInvite);
