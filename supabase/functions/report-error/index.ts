// supabase/functions/report-error/index.ts
//
// Deno shim for the client error sink. The WHOLE orchestration lives in
// handler.ts (Deno-free, driven directly by tests/unit/reportErrorHandler.test.ts).
// This file only reads env once at cold start (via buildCorsHeaders — same
// semantics as the old module-load consts), wires the real telemetry fns,
// and mounts the handler under Deno.serve. Keep it dumb — any new decision
// logic belongs in handler.ts where tests can see it.
//
// Reports are written as one structured JSON line per report into the
// Supabase function logs, greppable by `"fn":"report-error"` /
// `"clientSource":"boundary"`.
//
// Required env vars:
//   ALLOWED_ORIGIN   production domain (falls back to vsresearchlabs.com)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { logEvent, truncate } from "../_shared/telemetry.ts";
import { createReportErrorHandler } from "./handler.ts";

const handleReportError = createReportErrorHandler(
  { corsHeaders: buildCorsHeaders() },
  { logEvent, truncate },
);

Deno.serve(handleReportError);
