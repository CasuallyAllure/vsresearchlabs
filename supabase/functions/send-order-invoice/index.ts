// supabase/functions/send-order-invoice/index.ts
// Deno shim for the admin invoice re-send.
//
// The WHOLE decision body lives in handler.ts (Deno-free, driven directly by
// the vitest suite — tests/unit/sendOrderInvoiceHandler.test.ts). This file
// is the only place that touches Deno: it reads env once at cold start (same
// semantics as the old module-load consts), wires the real runtime
// dependencies, and mounts the handler under Deno.serve. Keep it dumb — any
// new decision logic belongs in handler.ts where tests can see it.
//
// Required env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected; used for the admin auth gate)
//   RESEND_API_KEY
//   RESEND_FROM_EMAIL
//   ALLOWED_ORIGIN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import {
  createInvoiceHandler,
  type InvoiceSupabaseClient,
} from "./handler.ts";

const handleInvoice = createInvoiceHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseServiceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    resendApiKey: Deno.env.get("RESEND_API_KEY") ?? "",
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") ?? "VS Research Labs <inquire@vsresearchlabs.com>",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice InvoiceSupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) => createClient(url, key) as unknown as InvoiceSupabaseClient,
    fetch: (input, init) => fetch(input, init),
    requireAdmin,
  },
);

Deno.serve(handleInvoice);
