// supabase/functions/send-prepared-cart/index.ts
//
// Deno shim for the branded prepared-cart email — mails a member the link that
// opens the cart the owner built for them (migrations 081 + 082). The WHOLE
// orchestration lives in handler.ts (Deno-free, driven directly by
// tests/unit/sendPreparedCartHandler.test.ts). This file only reads env once at
// cold start, wires the real requireAdmin + fetch + service-role database
// seams, and mounts the handler under Deno.serve. Keep it dumb — any new
// decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL               (auto-injected; admin auth gate + service client)
//   SUPABASE_ANON_KEY          (auto-injected; admin auth gate)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; cart lookup + email_log claim)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts). Nothing here is reachable by a member — the member
// half is the claim RPC, called from the browser as themselves.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import { createSendPreparedCartHandler, type PreparedCartEmailPayload } from "./handler.ts";

// Service-role client. It reaches two things no browser role can: 082's
// prepared_cart_email_payload (which returns a member's email address, so it is
// granted to nobody) and email_log, whose writes are service-role only by
// design (075).
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminDb = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

/** PostgreSQL unique_violation — the email_log claim losing the race, which is
 *  the SUCCESSFUL outcome of "this was already sent", not a failure. */
const UNIQUE_VIOLATION = "23505";

const handleSendPreparedCart = createSendPreparedCartHandler(
  {
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    requireAdmin,
    fetch: (input, init) => fetch(input, init),

    loadCart: async (cartId, token) => {
      if (!adminDb) throw new Error("Service-role client not configured.");
      const { data, error } = await adminDb.rpc("prepared_cart_email_payload", {
        p_cart_id: cartId,
        p_token: token,
      });
      if (error) throw error;
      return (data ?? null) as PreparedCartEmailPayload | null;
    },

    claimSend: async ({ userId, recipient, periodKey, metadata }) => {
      if (!adminDb) throw new Error("Service-role client not configured.");
      const { error } = await adminDb.from("email_log").insert({
        user_id: userId,
        recipient,
        kind: "prepared_cart",
        period_key: periodKey,
        metadata,
      });
      // A conflict means an earlier press already claimed (and sent) this cart.
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw error;
      return true;
    },

    releaseSend: async ({ recipient, periodKey }) => {
      if (!adminDb) return;
      // Only ever removes the row THIS call just inserted: same recipient, same
      // kind, same period key. Scoped this tightly so a release can never take
      // out an unrelated send's audit row.
      await adminDb
        .from("email_log")
        .delete()
        .eq("recipient", recipient)
        .eq("kind", "prepared_cart")
        .eq("period_key", periodKey);
    },
  },
);

Deno.serve(handleSendPreparedCart);
