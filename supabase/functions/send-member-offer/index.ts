// supabase/functions/send-member-offer/index.ts
//
// Deno shim for the branded member-offer email — mails ONE member the campaign
// the owner composed in Members → Broadcast (migration 088 resolves who is a
// recipient; 075's email_log is the idempotency ledger). The WHOLE
// orchestration lives in handler.ts (Deno-free, driven directly by
// tests/unit/sendMemberOfferHandler.test.ts). This file only reads env once at
// cold start, wires the real requireAdmin + fetch + database seams, and mounts
// the handler under Deno.serve. Keep it dumb — any new decision logic belongs
// in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL               (auto-injected; admin auth gate + both clients)
//   SUPABASE_ANON_KEY          (auto-injected; admin auth gate + recipient RPC)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; email_log claim)
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
import { createSendMemberOfferHandler, type CampaignRecipient } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Service-role client, for the ONE thing no browser role can do: write
// email_log (075 grants its writes to service-role only).
const adminDb = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

/** PostgreSQL unique_violation — the email_log claim losing the race, which is
 *  the SUCCESSFUL outcome of "this was already sent", not a failure. */
const UNIQUE_VIOLATION = "23505";

interface RecipientsPayload {
  rows?: Array<{ userId: string | null; name: string | null; contact: string; optOut: boolean }>;
}

const handleSendMemberOffer = createSendMemberOfferHandler(
  {
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    requireAdmin,
    fetch: (input, init) => fetch(input, init),

    // Resolved AS THE CALLING ADMIN, not with the service key: 088 is
    // is_admin()-gated, so the same authorization that let the request in is
    // the one that reads the roster. The service key is reserved for email_log.
    loadRecipient: async (req, contact) => {
      if (!supabaseUrl || !anonKey) throw new Error("Auth client not configured.");
      const authHeader = req.headers.get("Authorization") ?? "";
      const asAdmin = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await asAdmin.rpc("admin_campaign_recipients", { p_contact: contact });
      if (error) throw error;
      const rows = (data as RecipientsPayload | null)?.rows ?? [];
      return (rows[0] ?? null) as CampaignRecipient | null;
    },

    claimSend: async ({ userId, recipient, periodKey, metadata }) => {
      if (!adminDb) throw new Error("Service-role client not configured.");
      const { error } = await adminDb.from("email_log").insert({
        user_id: userId,
        recipient,
        kind: "campaign",
        period_key: periodKey,
        metadata,
      });
      // A conflict means an earlier send already covered this (recipient,
      // campaign) pair — the whole point of the campaign key.
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw error;
      return true;
    },

    releaseSend: async ({ recipient, periodKey }) => {
      if (!adminDb) return;
      // Only ever removes the row THIS call just inserted: same recipient, same
      // kind, same period key.
      await adminDb
        .from("email_log")
        .delete()
        .eq("recipient", recipient)
        .eq("kind", "campaign")
        .eq("period_key", periodKey);
    },
  },
);

Deno.serve(handleSendMemberOffer);
