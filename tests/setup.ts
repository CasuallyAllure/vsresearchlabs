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

globalThis.fetch = networkDisabled('fetch') as unknown as typeof fetch;

// supabase-js realtime would use WebSocket; block it too so nothing connects.
(globalThis as Record<string, unknown>).WebSocket = new Proxy(function () {}, {
  construct: networkDisabled('WebSocket'),
});
(globalThis as Record<string, unknown>).XMLHttpRequest = new Proxy(function () {}, {
  construct: networkDisabled('XMLHttpRequest'),
});
