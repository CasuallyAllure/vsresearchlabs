// supabase/functions/mark-payment-claimed/index.ts
// Deno shim for the "✓ I've sent payment" endpoint.
//
// The WHOLE decision body lives in handler.ts (Deno-free, driven directly by
// the vitest suite — tests/unit/markPaymentClaimedHandler.test.ts). This file
// is the only place that touches Deno: it reads env once at cold start (same
// semantics as the old module-load consts), wires the real runtime
// dependencies, and mounts the handler under Deno.serve. Keep it dumb — any
// new decision logic belongs in handler.ts where tests can see it.
//
// PUBLIC endpoint (verify_jwt off): the 256-bit lookup_token is the
// authorization — see handler.ts for the fail-closed token semantics.
//
// Env vars consumed:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — for RPC + lookup
//   RESEND_API_KEY, RESEND_FROM_EMAIL        — for admin notification
//   INQUIRY_TO_EMAIL                         — admin notification recipient
//   PUBLIC_SITE_URL                          — link back in the confirmation page
//   ZELLE_HANDLE                             — recipient hint in the admin email

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  createClaimHandler,
  type ClaimSupabaseClient,
} from "./handler.ts";

const handleClaim = createClaimHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    businessEmail: Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquire@vsresearchlabs.com",
    zelleHandle: Deno.env.get("ZELLE_HANDLE") ?? "info@velariss.co",
    corsHeaders: buildCorsHeaders("GET, POST, OPTIONS"),
  },
  {
    // The handler only uses the structural slice ClaimSupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) => createClient(url, key) as unknown as ClaimSupabaseClient,
    fetch: (input, init) => fetch(input, init),
  },
);

Deno.serve(handleClaim);
