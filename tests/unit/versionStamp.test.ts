/**
 * Unit tests for scripts/viteVersionStamp.ts — the release-provenance stamp.
 *
 * Gap under test: Workers Builds deploys say "Source: Unknown"
 * (docs/PRO_REVIEW_2026-07-18-full-a-verdict.md §4.3). These pin (1) the
 * sha resolution order — git → Cloudflare lane env vars → "unknown" — with
 * injected exec/env so no test shells out, (2) the emitted version.json
 * shape, and (3) the soft-failure contract: a git-less, env-less build
 * stamps "unknown" instead of breaking.
 */
import { describe, expect, test } from 'vitest';
import {
  BRANCH_ENV_VARS,
  COMMIT_SHA_ENV_VARS,
  releaseMetaTag,
  resolveVersionInfo,
  versionJsonSource,
  versionStamp,
  type ExecFn,
} from '../../scripts/viteVersionStamp';

const HEAD_SHA = 'f7cb9da00704a5e2a83c3b1ce4a702eb50be4c65';
const LANE_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const FIXED_NOW = () => new Date('2026-07-18T12:00:00.000Z');

/** exec stub for a working git checkout. */
const gitExec: ExecFn = (command) => {
  if (command === 'git rev-parse HEAD') return `${HEAD_SHA}\n`;
  if (command === 'git rev-parse --abbrev-ref HEAD') return 'main\n';
  throw new Error(`unexpected command: ${command}`);
};

/** exec stub for an environment with no usable git. */
const noGitExec: ExecFn = () => {
  throw new Error('git: command not found');
};

describe('resolveVersionInfo — sha resolution order', () => {
  test('git wins when available, even with lane env vars set', () => {
    const info = resolveVersionInfo({
      exec: gitExec,
      env: { WORKERS_CI_COMMIT_SHA: LANE_SHA },
      now: FIXED_NOW,
    });
    expect(info.commit).toBe(HEAD_SHA);
    expect(info.source).toBe('git');
    expect(info.branch).toBe('main');
  });

  test('falls back to WORKERS_CI_COMMIT_SHA when git fails', () => {
    const info = resolveVersionInfo({
      exec: noGitExec,
      env: { WORKERS_CI_COMMIT_SHA: LANE_SHA, WORKERS_CI_BRANCH: 'main' },
      now: FIXED_NOW,
    });
    expect(info.commit).toBe(LANE_SHA);
    expect(info.source).toBe('env');
    expect(info.branch).toBe('main');
  });

  test('falls back to CF_PAGES_COMMIT_SHA when the Workers var is absent', () => {
    const info = resolveVersionInfo({
      exec: noGitExec,
      env: { CF_PAGES_COMMIT_SHA: LANE_SHA },
      now: FIXED_NOW,
    });
    expect(info.commit).toBe(LANE_SHA);
    expect(info.source).toBe('env');
  });

  test('soft failure: no git, no env → "unknown" everywhere, no throw', () => {
    const info = resolveVersionInfo({ exec: noGitExec, env: {}, now: FIXED_NOW });
    expect(info).toEqual({
      commit: 'unknown',
      shortCommit: 'unknown',
      branch: 'unknown',
      source: 'unknown',
      buildTime: '2026-07-18T12:00:00.000Z',
    });
  });

  test('empty or whitespace-only git output counts as failure', () => {
    const blankExec: ExecFn = () => '   \n';
    const info = resolveVersionInfo({
      exec: blankExec,
      env: { WORKERS_CI_COMMIT_SHA: LANE_SHA },
      now: FIXED_NOW,
    });
    expect(info.commit).toBe(LANE_SHA);
    expect(info.source).toBe('env');
  });

  test('empty or whitespace-only env values count as unset', () => {
    const info = resolveVersionInfo({
      exec: noGitExec,
      env: { WORKERS_CI_COMMIT_SHA: '  ', CF_PAGES_COMMIT_SHA: '' },
      now: FIXED_NOW,
    });
    expect(info.commit).toBe('unknown');
    expect(info.source).toBe('unknown');
  });

  test('branch falls back to lane env vars independently of the sha path', () => {
    const branchlessGit: ExecFn = (command) => {
      if (command === 'git rev-parse HEAD') return HEAD_SHA;
      throw new Error('detached HEAD lookup failed');
    };
    const info = resolveVersionInfo({
      exec: branchlessGit,
      env: { CF_PAGES_BRANCH: 'main' },
      now: FIXED_NOW,
    });
    expect(info.source).toBe('git');
    expect(info.branch).toBe('main');
  });

  test('shortCommit is the first 7 chars of the resolved sha', () => {
    const info = resolveVersionInfo({ exec: gitExec, env: {}, now: FIXED_NOW });
    expect(info.shortCommit).toBe('f7cb9da');
    expect(info.shortCommit).toBe(HEAD_SHA.slice(0, 7));
  });

  test('pins the lane env var precedence lists', () => {
    expect([...COMMIT_SHA_ENV_VARS]).toEqual([
      'WORKERS_CI_COMMIT_SHA',
      'CF_PAGES_COMMIT_SHA',
    ]);
    expect([...BRANCH_ENV_VARS]).toEqual(['WORKERS_CI_BRANCH', 'CF_PAGES_BRANCH']);
  });
});

describe('versionJsonSource — the emitted dist/version.json bytes', () => {
  test('serializes the full shape as pretty JSON with a trailing newline', () => {
    const info = resolveVersionInfo({ exec: gitExec, env: {}, now: FIXED_NOW });
    const text = versionJsonSource(info);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      commit: HEAD_SHA,
      shortCommit: 'f7cb9da',
      branch: 'main',
      source: 'git',
      buildTime: '2026-07-18T12:00:00.000Z',
    });
  });
});

describe('releaseMetaTag — the index.html stamp', () => {
  test('injects a head meta tag carrying the full commit sha', () => {
    const info = resolveVersionInfo({ exec: gitExec, env: {}, now: FIXED_NOW });
    expect(releaseMetaTag(info)).toEqual({
      tag: 'meta',
      attrs: { name: 'release', content: HEAD_SHA },
      injectTo: 'head',
    });
  });
});

describe('versionStamp plugin surface', () => {
  test('is build-only and importable without side effects', () => {
    const plugin = versionStamp();
    expect(plugin.name).toBe('vsr-version-stamp');
    expect(plugin.apply).toBe('build');
    // The stamp lives in a separate emitted asset + index.html, never the
    // hashed bundles — so the plugin must not register transform/renderChunk
    // hooks that could perturb dist/assets reproducibility.
    expect(plugin).not.toHaveProperty('transform');
    expect(plugin).not.toHaveProperty('renderChunk');
  });
});
