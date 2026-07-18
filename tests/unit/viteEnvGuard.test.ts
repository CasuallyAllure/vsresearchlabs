/**
 * Unit tests for scripts/viteEnvGuard.ts — the build-time env contract.
 *
 * Incident class under test: 2026-07-17/18, when an auto-build lane with
 * no VITE_ZELLE_HANDLE shipped "[Set VITE_ZELLE_HANDLE]" to live payment
 * surfaces. These pin (1) the required-var detection that fails such a
 * build up front, and (2) the emitted-asset placeholder scan that fails
 * it even if a placeholder sneaks in another way.
 */
import { describe, expect, test } from 'vitest';
import {
  REQUIRED_VITE_VARS,
  findMissingEnvVars,
  findPlaceholders,
  isScannableAsset,
  missingEnvMessage,
  placeholderMessage,
} from '../../scripts/viteEnvGuard';

const FULL_ENV = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test',
  VITE_ZELLE_HANDLE: 'owner@zelle.example',
};

describe('REQUIRED_VITE_VARS', () => {
  test('pins the frontend env contract enumerated from src/ usage', () => {
    expect([...REQUIRED_VITE_VARS]).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_ZELLE_HANDLE',
    ]);
  });
});

describe('findMissingEnvVars', () => {
  test('returns empty when every required var is set', () => {
    expect(findMissingEnvVars(FULL_ENV)).toEqual([]);
  });

  test('flags an absent var — the incident lane (no VITE_ZELLE_HANDLE)', () => {
    const { VITE_ZELLE_HANDLE: _omitted, ...laneEnv } = FULL_ENV;
    expect(findMissingEnvVars(laneEnv)).toEqual(['VITE_ZELLE_HANDLE']);
  });

  test('flags empty and whitespace-only values', () => {
    expect(findMissingEnvVars({ ...FULL_ENV, VITE_SUPABASE_URL: '' })).toEqual([
      'VITE_SUPABASE_URL',
    ]);
    expect(findMissingEnvVars({ ...FULL_ENV, VITE_ZELLE_HANDLE: '   ' })).toEqual([
      'VITE_ZELLE_HANDLE',
    ]);
  });

  test('flags a var set to a placeholder literal verbatim', () => {
    expect(
      findMissingEnvVars({ ...FULL_ENV, VITE_ZELLE_HANDLE: '[Set VITE_ZELLE_HANDLE]' }),
    ).toEqual(['VITE_ZELLE_HANDLE']);
  });

  test('reports every missing var, not just the first', () => {
    expect(findMissingEnvVars({})).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_ZELLE_HANDLE',
    ]);
  });

  test('honors a custom required list', () => {
    expect(findMissingEnvVars({}, ['VITE_CUSTOM'])).toEqual(['VITE_CUSTOM']);
    expect(findMissingEnvVars({ VITE_CUSTOM: 'x' }, ['VITE_CUSTOM'])).toEqual([]);
  });
});

describe('findPlaceholders', () => {
  test('finds a "[Set …]" literal in an emitted chunk', () => {
    const hits = findPlaceholders([
      {
        fileName: 'assets/payment-q5ehtlAh.js',
        // The exact byte pattern the 2026-07-17/18 live asset carried.
        text: 'const A={zelle:"[Set VITE_ZELLE_HANDLE]"};',
      },
    ]);
    expect(hits).toEqual([
      { fileName: 'assets/payment-q5ehtlAh.js', match: '[Set VITE_ZELLE_HANDLE]' },
    ]);
  });

  test('clean assets produce no hits', () => {
    const hits = findPlaceholders([
      { fileName: 'assets/payment-x.js', text: 'const A={zelle:"info@velariss.co"};' },
      { fileName: 'index.html', text: '<div>VS Research Labs</div>' },
    ]);
    expect(hits).toEqual([]);
  });

  test('does not false-positive on bracketed non-placeholder text', () => {
    const hits = findPlaceholders([
      { fileName: 'a.js', text: 'x = arr[Setting]; y = "[set lowercase]"; z = "[SetX y]"' },
    ]);
    expect(hits).toEqual([]);
  });

  test('reports one hit per offending file', () => {
    const hits = findPlaceholders([
      { fileName: 'a.js', text: '"[Set VITE_A]" and "[Set VITE_B]"' },
      { fileName: 'b.js', text: '"[Set VITE_C]"' },
    ]);
    expect(hits.map((h) => h.fileName)).toEqual(['a.js', 'b.js']);
  });
});

describe('isScannableAsset', () => {
  test('scans text bundle outputs, skips binaries', () => {
    expect(isScannableAsset('assets/index-abc.js')).toBe(true);
    expect(isScannableAsset('index.html')).toBe(true);
    expect(isScannableAsset('assets/style-x.css')).toBe(true);
    expect(isScannableAsset('assets/logo-x.svg')).toBe(true);
    expect(isScannableAsset('assets/photo-x.webp')).toBe(false);
    expect(isScannableAsset('assets/font-x.woff2')).toBe(false);
  });
});

describe('failure messages', () => {
  test('missing-env message names every var and the fix location', () => {
    const msg = missingEnvMessage(['VITE_ZELLE_HANDLE']);
    expect(msg).toContain('VITE_ZELLE_HANDLE');
    expect(msg).toContain('Cloudflare');
    expect(msg).toContain('.env.example');
  });

  test('placeholder message names the file and the matched literal', () => {
    const msg = placeholderMessage([
      { fileName: 'assets/payment-x.js', match: '[Set VITE_ZELLE_HANDLE]' },
    ]);
    expect(msg).toContain('assets/payment-x.js');
    expect(msg).toContain('[Set VITE_ZELLE_HANDLE]');
  });
});
