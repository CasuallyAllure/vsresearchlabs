// supabase/functions/send-contact/index.ts
// Deno shim for the public /contact form intake.
//
// The WHOLE orchestration lives in handler.ts (Deno-free, driven directly by
// the vitest suite — tests/unit/sendContactHandler.test.ts). This file is the
// only place that touches Deno: it reads env once at cold start (same
// semantics as the old module-load consts), wires the real runtime
// dependencies, and mounts the handler under Deno.serve. Keep it dumb — any
// new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   INQUIRY_TO_EMAIL
//   ALLOWED_ORIGIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyTurnstile, clientIp } from "../_shared/turnstile.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  createContactHandler,
  type ContactSupabaseClient,
} from "./handler.ts";

Deno.serve(createContactHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    businessEmail: Deno.env.get("INQUIRY_TO_EMAIL") ?? "inquire@vsresearchlabs.com",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice ContactSupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) =>
      createClient(url, key) as unknown as ContactSupabaseClient,
    fetch: (input, init) => fetch(input, init),
    verifyTurnstile,
    clientIp,
  },
));
