// supabase/functions/resolve-video/index.ts
//
// Deno shim for the social-video (TikTok) citation resolver. The WHOLE
// orchestration lives in handler.ts (Deno-free, driven directly by
// tests/unit/resolveVideoHandler.test.ts). This file only reads env once at
// cold start (same semantics as the old module-load consts), wires the real
// createClient/requireAdmin/fetch, and mounts the handler under Deno.serve.
// Keep it dumb — any new decision logic belongs in handler.ts where tests
// can see it.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//   SUPABASE_ANON_KEY (auto-injected; used for the admin auth gate),
//   ALLOWED_ORIGIN (falls back to vsresearchlabs.com if unset).
//
// Admin-only: requires a valid session JWT for an active admin (see
// ../_shared/adminGate.ts).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGate.ts";
import {
  createResolveVideoHandler,
  type VideoSupabaseClient,
} from "./handler.ts";

const handleResolveVideo = createResolveVideoHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    corsHeaders: buildCorsHeaders(),
  },
  {
    // The handler only uses the structural slice VideoSupabaseClient names;
    // the cast erases supabase-js generics that don't survive injection.
    createClient: (url, key) => createClient(url, key) as unknown as VideoSupabaseClient,
    requireAdmin,
    fetch: (input, init) => fetch(input, init),
  },
);

Deno.serve(handleResolveVideo);
