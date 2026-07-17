import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to tests/** (unit + rls) and any co-located src/**/*.test.ts files.
// Playwright e2e specs (tests/e2e/**) are intentionally excluded — they run
// via `npm run test:e2e` / the Playwright CLI, not Vitest.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
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
      // Measured floor on 2026-07-17 (PM, money-mirror suites landed):
      // 38.52 L / 37.92 S / 38.03 B / 40.15 F — pricing/wholesale/coupons/
      // lineDiscounts now 95-100%, productOverrides ~54% (reload() network
      // branches untested), place-order modules ~100%. RATCHET: raise as
      // coverage grows toward the 80% bar; never lower.
      thresholds: { lines: 38, statements: 37, branches: 37, functions: 39 },
    },
  },
});
