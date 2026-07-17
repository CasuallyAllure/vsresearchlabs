import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `video/` is a separate, gitignored Remotion project with its own runtime
  // conventions — not part of the web app's lint surface.
  globalIgnores(['dist', 'video']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Honor the `_name` throwaway convention already used in the codebase
      // (e.g. discarded destructured props in Button.tsx).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // React-Compiler-adjacent hazards from eslint-plugin-react-hooks v6.
      // This project does NOT run React Compiler, so these are advisory
      // refactors, not current-runtime bugs — kept visible as warnings, not
      // merge-blocking errors. rules-of-hooks stays an error (it ships that way).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/immutability': 'warn',
      // Dev-only fast-refresh hint — no runtime/production impact.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
