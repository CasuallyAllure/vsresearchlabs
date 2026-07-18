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
    include: ['tests/unit/**/*.test.ts', 'tests/rls/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    // Coverage is scoped to the money-path logic modules — the Deno-free
    // place-order modules the unit suite pins plus the client-side pricing
    // mirrors in src/lib — because that is where the 80% bar has teeth.
    // index.ts is excluded: it is Deno (jsr:/npm: imports vitest cannot load)
    // and is gated by `deno check` instead. Thresholds are a RATCHET: set at
    // the measured floor so CI fails on regression; raise them as coverage
    // grows toward the CLAUDE.md 80% bar.
    coverage: {
      provider: 'v8',
      all: true,
      include: ['supabase/functions/place-order/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['supabase/functions/place-order/index.ts'],
      reporter: ['text-summary', 'text'],
      // Measured floor on 2026-07-17 (night, money-path extraction wave):
      // 45.20 L / 44.60 S / 46.63 B / 44.05 F — the place-order money engine
      // (orderTotals/orderPayload/orderShipping + the earlier extractions) now
      // measures ~100% (dir: 99.67 S / 96.88 B / 100 F / 100 L), clearing the
      // 80% bar ON the checkout money path; index.ts is I/O orchestration.
      // Functions floor kept at 43 (0.05 margin at 44 is too brittle).
      // RATCHET: raise as coverage grows toward the 80% bar; never lower.
      thresholds: { lines: 45, statements: 44, branches: 46, functions: 43 },
    },
  },
});
