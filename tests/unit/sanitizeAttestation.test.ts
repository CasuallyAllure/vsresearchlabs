/**
 * Unit tests for supabase/functions/place-order/sanitizeAttestation.ts — pure
 * sanitizer for the research-use disclaimer acceptance snapshot, extracted
 * verbatim from the place-order handler.
 */
import { describe, expect, test } from 'vitest';
import {
  ATTESTATION_INDUSTRIES,
  sanitizeAttestation,
} from '../../supabase/functions/place-order/sanitizeAttestation';

const VALID_INPUT = {
  accepted_at: '2026-07-17T12:00:00.000Z',
  disclaimer_version: 2,
  industry: 'biotech_pharma',
  age_21_confirmed: true,
  research_use_confirmed: true,
};

describe('sanitizeAttestation — rejection cases', () => {
  test('returns null for undefined input', () => {
    expect(sanitizeAttestation(undefined)).toBeNull();
  });

  test('returns null for null input', () => {
    // @ts-expect-error — exercising runtime guard against a non-object client payload.
    expect(sanitizeAttestation(null)).toBeNull();
  });

  test('returns null for a non-object primitive', () => {
    // @ts-expect-error — exercising runtime guard against a garbage client payload.
    expect(sanitizeAttestation('garbage')).toBeNull();
  });

  test('returns null for an empty object', () => {
    expect(sanitizeAttestation({})).toBeNull();
  });

  test('returns null when accepted_at is missing', () => {
    const { accepted_at: _a, ...rest } = VALID_INPUT; void _a;
    expect(sanitizeAttestation(rest)).toBeNull();
  });

  test('returns null when accepted_at is unparseable', () => {
    expect(sanitizeAttestation({ ...VALID_INPUT, accepted_at: 'not-a-date' })).toBeNull();
  });

  test('returns null when age_21_confirmed is missing', () => {
    const { age_21_confirmed: _b, ...rest } = VALID_INPUT; void _b;
    expect(sanitizeAttestation(rest)).toBeNull();
  });

  test('returns null when age_21_confirmed is false', () => {
    expect(sanitizeAttestation({ ...VALID_INPUT, age_21_confirmed: false })).toBeNull();
  });

  test('returns null when research_use_confirmed is missing', () => {
    const { research_use_confirmed: _c, ...rest } = VALID_INPUT; void _c;
    expect(sanitizeAttestation(rest)).toBeNull();
  });

  test('returns null when research_use_confirmed is false', () => {
    expect(sanitizeAttestation({ ...VALID_INPUT, research_use_confirmed: false })).toBeNull();
  });
});

describe('sanitizeAttestation — industry normalization', () => {
  test('accepts every whitelisted industry unchanged', () => {
    for (const industry of ATTESTATION_INDUSTRIES) {
      const result = sanitizeAttestation({ ...VALID_INPUT, industry });
      expect(result?.industry).toBe(industry);
    }
  });

  test('falls back unknown industries to "other"', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, industry: 'crypto_dao' });
    expect(result?.industry).toBe('other');
  });

  test('falls back a missing industry to "other"', () => {
    const { industry: _d, ...rest } = VALID_INPUT; void _d;
    const result = sanitizeAttestation(rest);
    expect(result?.industry).toBe('other');
  });
});

describe('sanitizeAttestation — disclaimer_version clamping', () => {
  test('clamps a version below 1 up to 1', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, disclaimer_version: 0 });
    expect(result?.disclaimer_version).toBe(1);
  });

  test('clamps a negative version up to 1', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, disclaimer_version: -5 });
    expect(result?.disclaimer_version).toBe(1);
  });

  test('clamps a version above 999 down to 999', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, disclaimer_version: 5000 });
    expect(result?.disclaimer_version).toBe(999);
  });

  test('rounds a fractional version', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, disclaimer_version: 2.6 });
    expect(result?.disclaimer_version).toBe(3);
  });

  test('defaults a missing version to 1', () => {
    const { disclaimer_version: _e, ...rest } = VALID_INPUT; void _e;
    const result = sanitizeAttestation(rest);
    expect(result?.disclaimer_version).toBe(1);
  });

  test('defaults a non-finite version to 1', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, disclaimer_version: Infinity });
    expect(result?.disclaimer_version).toBe(1);
  });
});

describe('sanitizeAttestation — valid round-trip', () => {
  test('returns a sanitized snapshot for a fully valid payload', () => {
    const result = sanitizeAttestation(VALID_INPUT);
    expect(result).toMatchObject({
      accepted_at: '2026-07-17T12:00:00.000Z',
      disclaimer_version: 2,
      age_21_confirmed: true,
      research_use_confirmed: true,
      industry: 'biotech_pharma',
    });
    expect(typeof result?.recorded_at).toBe('string');
    // recorded_at is stamped "now" — assert it parses to a real, current timestamp.
    expect(Number.isNaN(Date.parse(result?.recorded_at as string))).toBe(false);
  });

  test('normalizes accepted_at to a full ISO string even from a bare date', () => {
    const result = sanitizeAttestation({ ...VALID_INPUT, accepted_at: '2026-07-17' });
    expect(result?.accepted_at).toBe(new Date('2026-07-17').toISOString());
  });

  test('trims and caps an overlong industry string before whitelist matching', () => {
    const longIndustry = 'x'.repeat(100);
    const result = sanitizeAttestation({ ...VALID_INPUT, industry: `  ${longIndustry}  ` });
    // Not on the whitelist even after trim/slice, so falls back to "other".
    expect(result?.industry).toBe('other');
  });
});
