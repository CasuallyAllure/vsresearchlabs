// supabase/functions/send-inquiry/index.ts
// Deno shim for the S1 inquiry-persistence function.
//
// The WHOLE orchestration lives in handler.ts (Deno-free, driven directly by
// the vitest suite — tests/unit/sendInquiryHandler.test.ts). This file is the
// only place that touches Deno: it reads env once at cold start (same
// semantics as the old module-load consts), wires the real runtime
// dependencies, and mounts the handler under Deno.serve. Keep it dumb — any
// new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected by Supabase runtime)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase runtime)
//   RESEND_API_KEY
//   INQUIRY_TO_EMAIL
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN            (production domain; falls back to vsresearchlabs.com if unset)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  createInquiryHandler,
  type InquirySupabaseClient,
} from "./handler.ts";

Deno.serve(createInquiryHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    businessEmail: Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquiries@vsresearchlabs.com",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquiries@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice InquirySupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) =>
      createClient(url, key) as unknown as InquirySupabaseClient,
    fetch: (input, init) => fetch(input, init),
    verifyTurnstile,
    clientIp,
  },
));
