// Shared admin authorization gate for edge functions.
//
// Verifies the caller is an authenticated admin before allowing access to
// admin-only operations. Two checks:
//   1. The Authorization header must carry a valid Supabase session JWT
//      (verified via auth.getUser() against a client built with the anon key).
//   2. That authenticated user must pass the is_admin() Postgres RPC
//      (SECURITY DEFINER, granted to `authenticated`, checks admin_users.active
//      — defined in supabase/migrations/003_inventory_ops.sql).
//
// On any failure this returns a generic 401 — it never reveals which check
// failed, so callers can't use it to enumerate valid sessions or admin status.

import { createClient } from "jsr:@supabase/supabase-js@2";

export interface AdminGateResult {
  ok: boolean;
  status: number;
  body?: { error: string };
}

const UNAUTHORIZED: AdminGateResult = { ok: false, status: 401, body: { error: "Unauthorized" } };

/**
 * Verify the incoming request carries a valid session JWT for an active admin.
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY to be set (both auto-injected
 * by the Supabase edge runtime).
 */
export async function requireAdmin(req: Request): Promise<AdminGateResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return UNAUTHORIZED;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) return UNAUTHORIZED;

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return UNAUTHORIZED;

    const { data: isAdmin, error: rpcError } = await supabase.rpc("is_admin");
    if (rpcError || isAdmin !== true) return UNAUTHORIZED;

    return { ok: true, status: 200 };
  } catch {
    return UNAUTHORIZED;
  }
}
