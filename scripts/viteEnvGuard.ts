/**
 * Build-time env guard — the code-side defense against the 2026-07-17/18
 * incident, where a push-triggered auto-build lane (Cloudflare Workers
 * Builds) shipped a bundle built without VITE_ZELLE_HANDLE and live buyers
 * saw a literal "[Set VITE_ZELLE_HANDLE]" on payment surfaces for ~8 hours.
 *
 * Two gates, both hard build failures (non-zero exit):
 *   1. Required VITE_* vars must be present and non-empty at `vite build`
 *      time — a misconfigured build lane fails its build instead of
 *      silently shipping a mis-baked bundle.
 *   2. No emitted asset may contain a "[Set …]"-style placeholder — the
 *      belt-and-suspenders check that no placeholder text of any origin
 *      can reach a deployable artifact.
 *
 * Applies to `vite build` only: dev server and vitest are untouched, so
 * local dev without a .env still works. There is deliberately NO opt-out
 * env var — a lane that cannot satisfy the env contract must not produce
 * a deployable artifact.
 */
import { loadEnv, type Plugin } from 'vite';

/**
 * The frontend env contract. Enumerated from actual usage in src/:
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — supabase.ts, telemetry.ts,
 *     AdminSystemHealth.tsx (missing → site boots "backend not configured").
 *   VITE_ZELLE_HANDLE — payment.ts (missing → fallback handle; env must
 *     still be explicit so lane drift is caught at build time, not later).
 * Not required: VITE_TURNSTILE_SITE_KEY (real site key baked as default),
 * VITE_ADMIN_PASSPHRASE (deprecated), VITE_PAYPAL_HANDLE (PayPal removed
 * from the payment flow).
 */
export const REQUIRED_VITE_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_ZELLE_HANDLE',
] as const;

/** Matches "[Set VITE_ANYTHING]"-style placeholder literals. */
export const PLACEHOLDER_RE = /\[Set [A-Z0-9_]+\]/;

/**
 * Returns the names from `required` that are missing, empty, or
 * whitespace-only in `env` — placeholder-valued vars (e.g. a lane that set
 * the var to "[Set VITE_ZELLE_HANDLE]" verbatim) count as missing too.
 */
export function findMissingEnvVars(
  env: Record<string, string | undefined>,
  required: readonly string[] = REQUIRED_VITE_VARS,
): string[] {
  return required.filter((name) => {
    const value = env[name];
    return (
      typeof value !== 'string' || value.trim() === '' || PLACEHOLDER_RE.test(value)
    );
  });
}

export interface PlaceholderHit {
  fileName: string;
  match: string;
}

/** Text file extensions worth scanning in the output bundle. */
const SCANNABLE_RE = /\.(js|mjs|css|html|svg|json|txt|webmanifest)$/;

export function isScannableAsset(fileName: string): boolean {
  return SCANNABLE_RE.test(fileName);
}

/**
 * Scans emitted text assets for "[Set …]" placeholders. Pure so the unit
 * suite can pin it without running a build.
 */
export function findPlaceholders(
  files: ReadonlyArray<{ fileName: string; text: string }>,
): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  for (const file of files) {
    const match = PLACEHOLDER_RE.exec(file.text);
    if (match) hits.push({ fileName: file.fileName, match: match[0] });
  }
  return hits;
}

export function missingEnvMessage(missing: string[]): string {
  return [
    `Build FAILED: required env var${missing.length === 1 ? '' : 's'} missing or empty: ${missing.join(', ')}.`,
    'Every production build must bake the full frontend env contract.',
    'Set the variable(s) in .env (local) or the build lane\'s environment',
    '(Cloudflare Workers Builds → Settings → Variables), then rebuild.',
    'See .env.example for the expected values.',
  ].join('\n');
}

export function placeholderMessage(hits: PlaceholderHit[]): string {
  const list = hits.map((h) => `  ${h.fileName}: contains "${h.match}"`).join('\n');
  return [
    'Build FAILED: placeholder text found in emitted assets — this artifact',
    'would show configuration placeholders to customers (the 2026-07-17/18',
    'live-payment-surface incident class):',
    list,
  ].join('\n');
}

/**
 * The Vite plugin. Fails `vite build` (never dev/test) when the env
 * contract is unmet or a placeholder survives into the output bundle.
 */
export function buildEnvGuard(): Plugin {
  return {
    name: 'vsr-build-env-guard',
    apply: 'build',
    config(_config, { mode }) {
      // loadEnv merges .env files for this mode with process.env (process
      // env wins) — the same resolution order Vite uses for import.meta.env.
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const missing = findMissingEnvVars(env);
      if (missing.length > 0) {
        throw new Error(missingEnvMessage(missing));
      }
    },
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .map((entry) =>
          entry.type === 'chunk'
            ? { fileName: entry.fileName, text: entry.code }
            : typeof entry.source === 'string'
              ? { fileName: entry.fileName, text: entry.source }
              : null,
        )
        .filter((f): f is { fileName: string; text: string } => f !== null && isScannableAsset(f.fileName));
      const hits = findPlaceholders(files);
      if (hits.length > 0) {
        throw new Error(placeholderMessage(hits));
      }
    },
  };
}
