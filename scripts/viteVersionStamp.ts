/**
 * Release-provenance stamp — closes the "Workers deploys say Source: Unknown"
 * gap (docs/PRO_REVIEW_2026-07-18-full-a-verdict.md §4, item 3).
 *
 * At `vite build` time this plugin:
 *   1. Emits `dist/version.json` — { commit, shortCommit, branch, source,
 *      buildTime } — so the live origin self-identifies its deployed commit
 *      (`curl https://vsresearchlabs.com/version.json`; the Worker serves
 *      dist/ as-is via wrangler.jsonc → assets.directory).
 *   2. Injects `<meta name="release" content="<sha>">` into index.html via
 *      transformIndexHtml.
 *
 * Reproducibility contract (CRITICAL): the hashed assets under dist/assets/
 * must stay byte-identical for a given source tree — the pro review verifies
 * live == local by hash. So the commit stamp is NEVER injected into the
 * hashed bundles: version.json is a separate emitted asset and index.html is
 * not a content-hashed file.
 *
 * Failure contract: SOFT. Sha resolution order is git → Cloudflare lane env
 * vars → "unknown" (with a build warning). A missing git binary, a shallow
 * .git-less export, or a bare env must never break the build.
 */
import { execSync } from 'node:child_process';
import type { HtmlTagDescriptor, Plugin } from 'vite';

export interface VersionInfo {
  /** Full commit sha, or "unknown". */
  commit: string;
  /** First 7 chars of the sha, or "unknown". */
  shortCommit: string;
  /** Branch name if cheaply available, else "unknown". */
  branch: string;
  /** Where the sha came from. */
  source: 'git' | 'env' | 'unknown';
  /** ISO-8601 build timestamp. */
  buildTime: string;
}

export type ExecFn = (command: string) => string;

/** Commit-sha env vars provided by Cloudflare build lanes, precedence order. */
export const COMMIT_SHA_ENV_VARS = [
  'WORKERS_CI_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
] as const;

/** Branch env vars provided by Cloudflare build lanes, precedence order. */
export const BRANCH_ENV_VARS = ['WORKERS_CI_BRANCH', 'CF_PAGES_BRANCH'] as const;

const SHORT_SHA_LENGTH = 7;

export interface ResolveVersionOptions {
  /** Command runner — injectable so the unit suite never shells out. */
  exec?: ExecFn;
  /** Env source — injectable; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Clock — injectable; defaults to Date. */
  now?: () => Date;
}

const defaultExec: ExecFn = (command) =>
  // stderr ignored: a non-repo dir would otherwise print git noise into the
  // build log; the catch in tryExec is the real handler.
  execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Runs a command, mapping any throw or empty output to undefined. */
function tryExec(exec: ExecFn, command: string): string | undefined {
  try {
    const output = exec(command).trim();
    return output === '' ? undefined : output;
  } catch {
    return undefined;
  }
}

function firstEnvValue(
  env: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolves the build's provenance. Pure given injected exec/env/now, so the
 * unit suite can pin the git → env → unknown resolution order without a repo.
 */
export function resolveVersionInfo(options: ResolveVersionOptions = {}): VersionInfo {
  const { exec = defaultExec, env = process.env, now = () => new Date() } = options;

  const gitSha = tryExec(exec, 'git rev-parse HEAD');
  const envSha = firstEnvValue(env, COMMIT_SHA_ENV_VARS);
  const commit = gitSha ?? envSha ?? 'unknown';
  const source: VersionInfo['source'] = gitSha ? 'git' : envSha ? 'env' : 'unknown';

  const branch =
    tryExec(exec, 'git rev-parse --abbrev-ref HEAD') ??
    firstEnvValue(env, BRANCH_ENV_VARS) ??
    'unknown';

  return {
    commit,
    shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, SHORT_SHA_LENGTH),
    branch,
    source,
    buildTime: now().toISOString(),
  };
}

/** The exact bytes emitted as dist/version.json. */
export function versionJsonSource(info: VersionInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}

/** The <meta name="release"> descriptor injected into index.html. */
export function releaseMetaTag(info: VersionInfo): HtmlTagDescriptor {
  return {
    tag: 'meta',
    attrs: { name: 'release', content: info.commit },
    injectTo: 'head',
  };
}

/**
 * The Vite plugin. Build-only; dev server and vitest are untouched. Never
 * fails the build — worst case is an "unknown" stamp plus a warning.
 */
export function versionStamp(): Plugin {
  let cached: VersionInfo | undefined;
  const getInfo = (): VersionInfo => {
    cached ??= resolveVersionInfo();
    return cached;
  };

  return {
    name: 'vsr-version-stamp',
    apply: 'build',
    buildStart() {
      if (getInfo().source === 'unknown') {
        this.warn(
          'version stamp: commit sha unresolvable (no git, no WORKERS_CI_COMMIT_SHA/CF_PAGES_COMMIT_SHA) — version.json will report "unknown"',
        );
      }
    },
    transformIndexHtml() {
      return [releaseMetaTag(getInfo())];
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionJsonSource(getInfo()),
      });
    },
  };
}
