/**
 * Global unit-test setup — the offline guard.
 *
 * The repo `.env` carries a REAL Supabase URL + publishable key, and vitest
 * (via vite) loads it, so `src/lib/supabase.ts` builds a live-capable client
 * at import time. A test that forgets to mock the seam would silently hit
 * production (this happened once: a test pulled real prod SKUs). This file
 * makes that impossible: every network primitive is replaced with a stub that
 * throws. Tests that need fetch stub it themselves (vi.stubGlobal / vi.fn),
 * which overrides this guard per-test.
 */

const networkDisabled = (name: string) => () => {
  throw new Error(
    `${name} is disabled in unit tests — mock the supabase seam (vi.mock('src/lib/supabase')) ` +
      'or stub fetch (vi.stubGlobal) instead of hitting live network.'
  );
};

// The real-database tiers (tests/rls + tests/integration) are the ONE
// legitimate network consumer under vitest: they talk to a LOCAL
// `supabase start` stack and self-skip unless TEST_SUPABASE_URL /
// TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY are set (and the
// URL is loopback). When that env is present, allow fetch to LOOPBACK hosts
// only — every non-loopback request (i.e. anything that could be prod) still
// throws exactly as before. When the env is absent, nothing changes: fetch
// throws unconditionally.
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

const isLoopbackUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
};

const realFetch = globalThis.fetch;
const allowLoopback = isLoopbackUrl(process.env.TEST_SUPABASE_URL) && typeof realFetch === 'function';

globalThis.fetch = (allowLoopback
  ? (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isLoopbackUrl(url)) return realFetch(input, init);
      return networkDisabled('fetch (non-loopback host)')();
    }
  : networkDisabled('fetch')) as unknown as typeof fetch;

// The place-order orchestration suite imports handler.ts, which pulls the
// shared email templates (_shared/emailBrand.ts / invoiceEmail.ts). Those read
// Deno.env at module load — a Deno-only global. Provide the minimal shim so
// the modules load under Node; every lookup misses, so each value falls back
// to its documented default exactly as an unset env var would in production.
(globalThis as Record<string, unknown>).Deno ??= {
  env: { get: (_key: string) => undefined },
};

// supabase-js realtime would use WebSocket; block it too so nothing connects.
(globalThis as Record<string, unknown>).WebSocket = new Proxy(function () {}, {
  construct: networkDisabled('WebSocket'),
});
(globalThis as Record<string, unknown>).XMLHttpRequest = new Proxy(function () {}, {
  construct: networkDisabled('XMLHttpRequest'),
});
