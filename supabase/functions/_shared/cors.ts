// Shared CORS header builder for edge functions.
//
// Origin resolution: use ALLOWED_ORIGIN if set; otherwise hard-fallback to
// the production domain. NEVER fall back to "*" — an unset env var must not
// silently open the API to every origin.

const PRODUCTION_ORIGIN = "https://vsresearchlabs.com";

export const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? PRODUCTION_ORIGIN;

/**
 * Build the standard CORS header set for an edge function.
 * `methods` defaults to "POST, OPTIONS" (the common case); pass an override
 * for functions that also accept other methods (e.g. GET).
 */
export function buildCorsHeaders(methods = "POST, OPTIONS"): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}
