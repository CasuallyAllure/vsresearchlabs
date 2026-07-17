// supabase/functions/health/index.ts
//
// PUBLIC uptime probe (verify_jwt = false in config.toml — an external
// monitor sends no Supabase JWT). Answers two questions an external monitor
// needs: is the edge-function gateway serving this project, and can a
// function reach the database. Returns 200 {ok:true} when both hold, 503
// when the DB read fails — so a keyword/status monitor alerts on either the
// gateway or the database being down.
//
// The DB probe is a single-row read of promo_settings (1 row, service-role,
// 5s timeout) via PostgREST directly — no SDK import, so the probe stays a
// tiny, fast cold start and never lies "up" because a cached client existed.
// No secrets, order data, or internals are ever included in the response.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }

  let dbOk = false;
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/promo_settings?select=id&limit=1`,
        {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      dbOk = res.ok;
      await res.body?.cancel();
    } catch {
      dbOk = false;
    }
  }

  return new Response(
    JSON.stringify({ ok: dbOk, db: dbOk, ts: new Date().toISOString() }),
    {
      status: dbOk ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
});
