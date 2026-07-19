import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to tests/** (unit + rls) and any co-located src/**/*.test.ts files.
// Playwright e2e specs (tests/e2e/**) are intentionally excluded — they run
// via `npm run test:e2e` / the Playwright CLI, not Vitest.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Offline guard: kills fetch/WebSocket/XHR so no unit test can hit the
    // real Supabase project whose keys live in .env (see tests/setup.ts).
    setupFiles: ['tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/rls/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    // Coverage spans the whole logic surface: every src/lib module plus the
    // place-order modules INCLUDING handler.ts — the full checkout
    // orchestration, extracted Deno-free on 2026-07-18 and driven directly by
    // tests/unit/placeOrderHandler.*.test.ts. Only the thin Deno shim
    // (place-order/index.ts: env reads + Deno.serve wiring, no decisions) is
    // excluded — it is jsr:-importing Deno code vitest cannot load, gated by
    // `deno check` instead. Thresholds are a RATCHET: set just under the
    // measured floor so CI fails on regression; never lowered.
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'supabase/functions/place-order/**/*.ts',
        // Every edge function's orchestration, extracted Deno-free on
        // 2026-07-18 (same pattern as place-order): the decisions live in
        // handler.ts, driven by tests/unit/*Handler.test.ts; only the Deno
        // shims (index.ts) stay outside vitest, gated by `deno check`.
        'supabase/functions/*/handler.ts',
        'supabase/functions/reconcile/reconcilePlan.ts',
        'src/lib/**/*.ts',
      ],
      exclude: ['supabase/functions/place-order/index.ts'],
      reporter: ['text-summary', 'text'],
      // Measured floor on 2026-07-18 (sibling-orchestration wave): 99.77 L /
      // 99.24 S / 96.32 B / 99.29 F across 1,353 tests — the surface now
      // includes every edge function's extracted handler.ts, and the
      // place-order branch residue was worked down to genuinely-defensive
      // fallbacks (96% branches on the money handler). All four thresholds
      // sit ~0.75-0.85 points under the measured floor — a uniform margin,
      // wide enough to absorb formatting-level drift, tight enough that a
      // real coverage regression fails CI.
      // RATCHET: never lower.
      thresholds: { lines: 99, statements: 98.5, branches: 95.5, functions: 98.5 },
    },
  },
});
