/**
 * Ambient Deno global for the TESTS project only.
 *
 * The place-order orchestration suite imports handler.ts, whose module graph
 * reaches the shared email templates (_shared/emailBrand.ts, invoiceEmail.ts)
 * and — type-only — turnstile.ts/telemetry.ts. Those files read Deno.env, a
 * global tsc doesn't know outside Deno. This declaration gives the tests
 * project the one member they use; at runtime tests/setup.ts installs the
 * matching shim. Scoped to tests/tsconfig.json — the app/node projects and
 * `deno check` (which has the real types) never see it.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
};
