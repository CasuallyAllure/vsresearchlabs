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
  },
});
