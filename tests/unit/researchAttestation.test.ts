// @vitest-environment happy-dom
/**
 * Pins src/lib/researchAttestation.ts — the disclaimer-gate persistence layer.
 *
 * Runs under happy-dom because the module reads/writes `localStorage`
 * directly (key: siteConfig.storage.disclaimerKey, currently
 * `vsrl_disclaimer_accepted_v2`). The tests pin:
 *   • writeDisclaimerAcceptance — the exact stored record shape, and that a
 *     blocked storage (private mode) is swallowed rather than thrown
 *   • readDisclaimerAcceptance  — roundtrip, plus every tolerated corruption:
 *     missing key, legacy v1 bare-ISO value, malformed JSON, wrong shapes
 *   • orderAttestationPayload   — the snake_case place-order block, and
 *     undefined when nothing is on record (server stores NULL)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { siteConfig } from '../../src/config';
import {
  DISCLAIMER_VERSION,
  INDUSTRY_OPTIONS,
  orderAttestationPayload,
  readDisclaimerAcceptance,
  writeDisclaimerAcceptance,
} from '../../src/lib/researchAttestation';

const KEY = siteConfig.storage.disclaimerKey;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('writeDisclaimerAcceptance', () => {
  test('persists the full versioned record under the site storage key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));

    writeDisclaimerAcceptance('research_lab');

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({
      version: DISCLAIMER_VERSION,
      acceptedAt: '2026-07-17T12:00:00.000Z',
      industry: 'research_lab',
      age21Confirmed: true,
      researchUseConfirmed: true,
    });
  });

  test('swallows a blocked storage write (private mode) instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => writeDisclaimerAcceptance('academic')).not.toThrow();
  });
});

describe('readDisclaimerAcceptance', () => {
  test('round-trips what writeDisclaimerAcceptance stored', () => {
    writeDisclaimerAcceptance('biotech_pharma');

    const rec = readDisclaimerAcceptance();

    expect(rec).not.toBeNull();
    expect(rec?.version).toBe(DISCLAIMER_VERSION);
    expect(rec?.industry).toBe('biotech_pharma');
    expect(rec?.age21Confirmed).toBe(true);
    expect(rec?.researchUseConfirmed).toBe(true);
  });

  test('returns null when nothing is stored', () => {
    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('tolerates the legacy v1 value (bare ISO timestamp, not JSON) as null', () => {
    localStorage.setItem(KEY, '2026-01-01T00:00:00.000Z');

    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('returns null for valid JSON that is not an object', () => {
    localStorage.setItem(KEY, JSON.stringify('2026-01-01T00:00:00.000Z'));

    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('returns null for an object missing acceptedAt', () => {
    localStorage.setItem(KEY, JSON.stringify({ industry: 'academic' }));

    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('returns null for an object missing industry', () => {
    localStorage.setItem(KEY, JSON.stringify({ acceptedAt: '2026-01-01T00:00:00.000Z' }));

    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('returns null for JSON null (typeof object, but not a record)', () => {
    localStorage.setItem(KEY, 'null');

    expect(readDisclaimerAcceptance()).toBeNull();
  });

  test('returns null when storage reads throw (blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(readDisclaimerAcceptance()).toBeNull();
  });
});

describe('orderAttestationPayload', () => {
  test('maps the stored record into the snake_case place-order block', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    writeDisclaimerAcceptance('independent');

    expect(orderAttestationPayload()).toEqual({
      accepted_at: '2026-07-17T12:00:00.000Z',
      disclaimer_version: DISCLAIMER_VERSION,
      industry: 'independent',
      age_21_confirmed: true,
      research_use_confirmed: true,
    });
  });

  test('returns undefined when nothing is on record (server stores NULL)', () => {
    expect(orderAttestationPayload()).toBeUndefined();
  });

  test('returns undefined when the stored value is corrupt', () => {
    localStorage.setItem(KEY, '{not json');

    expect(orderAttestationPayload()).toBeUndefined();
  });
});

describe('INDUSTRY_OPTIONS', () => {
  test('every option has a machine value and a human label', () => {
    expect(INDUSTRY_OPTIONS.length).toBeGreaterThan(0);
    for (const opt of INDUSTRY_OPTIONS) {
      expect(opt.value).toMatch(/^[a-z0-9_]+$/);
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});
