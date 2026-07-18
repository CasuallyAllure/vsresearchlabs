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
    // Deno-free place-order modules the unit suite pins. place-order/index.ts
    // is excluded: it is Deno (jsr:/npm: imports vitest cannot load) and is
    // gated by `deno check` instead. Thresholds are a RATCHET: set just under
    // the measured floor so CI fails on regression; never lowered.
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
      // Measured floor on 2026-07-18 (whole-surface coverage wave): 99.11 L /
      // 98.94 S / 95.65 B / 98.27 F across 879 tests — every src/lib module
      // now ≥81%, the place-order money engine at ~100%, clearing the
      // CLAUDE.md 80% bar on the WHOLE surface, not just the money path.
      // Thresholds sit ~2 points under the measured floor so CI fails on real
      // regression, not on one refactored file (the razor-thin-margin
      // brittleness the A- review flagged).
      // RATCHET: never lower.
      thresholds: { lines: 97, statements: 97, branches: 94, functions: 96 },
    },
  },
});
