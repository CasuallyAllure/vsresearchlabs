// supabase/functions/health/index.ts
//
// Deno shim for the PUBLIC uptime probe (verify_jwt = false in config.toml —
// an external monitor sends no Supabase JWT). The WHOLE decision body lives
// in handler.ts (Deno-free, driven directly by tests/unit/healthHandler.test.ts).
// This file only reads env once at cold start (same semantics as the old
// module-load consts) and mounts the handler under Deno.serve. Keep it dumb —
// any new decision logic belongs in handler.ts where tests can see it.

import { createHealthHandler } from "./handler.ts";

const handleHealth = createHealthHandler(
  {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  },
  { fetch: (input, init) => fetch(input, init) },
);

Deno.serve(handleHealth);
