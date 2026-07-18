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
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/rls/**/*.test.ts', 'src/**/*.test.ts'],
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
        'supabase/functions/reconcile/reconcilePlan.ts',
        'src/lib/**/*.ts',
      ],
      exclude: ['supabase/functions/place-order/index.ts'],
      reporter: ['text-summary', 'text'],
      // Measured floor on 2026-07-18 (checkout-orchestration wave): 99.86 L /
      // 99.50 S / 94.70 B / 99.39 F across 1,018 tests — handler.ts itself at
      // 100% lines / 100% functions / 88% branches (the residue is ??
      // fallbacks on defensive defaults). Lines/statements/functions sit
      // ~1.5-2 points under the floor; branches stay at 94 because the floor
      // (94.70) is only 0.7 above it and a razor-thin margin is the
      // brittleness the A- review flagged.
      // RATCHET: never lower.
      thresholds: { lines: 98, statements: 97.5, branches: 94, functions: 97 },
    },
  },
});
