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
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import { createSendInviteHandler } from "./handler.ts";

// Service-role client for best-effort invite-funnel logging (migration 070).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected in the edge runtime.
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminDb = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

const handleSendInvite = createSendInviteHandler(
  {
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    requireAdmin,
    fetch: (input, init) => fetch(input, init),
    recordInvite: adminDb
      ? async ({ email, points }) => {
          const { error } = await adminDb.rpc("record_member_invite", {
            p_email: email,
            p_points: points,
            p_channel: "email",
          });
          if (error) throw error;
        }
      : undefined,
  },
);

Deno.serve(handleSendInvite);
