/**
 * Unit tests for supabase/functions/place-order/orderFormat.ts — pure
 * formatting/validation primitives extracted verbatim from the place-order
 * handler (EMAIL_REGEX, UUID_REGEX, escapeHtml, clampQty, clampCents, usd).
 */
import { describe, expect, test } from 'vitest';
import {
  EMAIL_REGEX,
  UUID_REGEX,
  escapeHtml,
  clampQty,
  clampCents,
  usd,
} from '../../supabase/functions/place-order/orderFormat';

describe('clampQty', () => {
  test('clamps zero up to the minimum of 1', () => {
    expect(clampQty(0)).toBe(1);
  });

  test('clamps a negative quantity up to the minimum of 1', () => {
    expect(clampQty(-5)).toBe(1);
  });

  test('returns 1 for NaN input', () => {
    expect(clampQty('not-a-number')).toBe(1);
  });

  test('returns 1 for Infinity', () => {
    expect(clampQty(Infinity)).toBe(1);
  });

  test('returns 1 for -Infinity', () => {
    expect(clampQty(-Infinity)).toBe(1);
  });

  test('clamps a quantity above 9999 down to the cap', () => {
    expect(clampQty(10000)).toBe(9999);
  });

  test('passes through a quantity exactly at the cap', () => {
    expect(clampQty(9999)).toBe(9999);
  });

  test('truncates a fractional quantity toward zero (floor)', () => {
    expect(clampQty(3.9)).toBe(3);
  });

  test('passes through a normal integer quantity unchanged', () => {
    expect(clampQty(5)).toBe(5);
  });
});

describe('clampCents', () => {
  test('returns 0 for zero cents', () => {
    expect(clampCents(0)).toBe(0);
  });

  test('returns 0 for negative cents', () => {
    expect(clampCents(-100)).toBe(0);
  });

  test('returns 0 for NaN input', () => {
    expect(clampCents('garbage')).toBe(0);
  });

  test('returns 0 for Infinity', () => {
    expect(clampCents(Infinity)).toBe(0);
  });

  test('caps cents at the $100k-per-line sanity ceiling', () => {
    expect(clampCents(100_000_00 + 1)).toBe(100_000_00);
  });

  test('passes through cents exactly at the cap', () => {
    expect(clampCents(100_000_00)).toBe(100_000_00);
  });

  test('truncates fractional cents toward zero (floor)', () => {
    expect(clampCents(1999.9)).toBe(1999);
  });

  test('passes through a normal cent amount unchanged', () => {
    expect(clampCents(2499)).toBe(2499);
  });
});

describe('usd', () => {
  test('formats whole dollars with two decimal places', () => {
    expect(usd(10000)).toBe('$100.00');
  });

  test('formats zero cents', () => {
    expect(usd(0)).toBe('$0.00');
  });

  test('formats sub-dollar cents', () => {
    expect(usd(5)).toBe('$0.05');
  });

  test('adds thousands separators for large amounts', () => {
    expect(usd(123456789)).toBe('$1,234,567.89');
  });
});

describe('EMAIL_REGEX', () => {
  test('accepts a standard email address', () => {
    expect(EMAIL_REGEX.test('buyer@example.com')).toBe(true);
  });

  test('accepts an email with a subdomain and plus tag', () => {
    expect(EMAIL_REGEX.test('buyer+tag@mail.example.co')).toBe(true);
  });

  test('rejects an address with no @', () => {
    expect(EMAIL_REGEX.test('not-an-email')).toBe(false);
  });

  test('rejects an address with no domain', () => {
    expect(EMAIL_REGEX.test('buyer@')).toBe(false);
  });

  test('rejects an address with no TLD', () => {
    expect(EMAIL_REGEX.test('buyer@example')).toBe(false);
  });

  test('rejects an address containing whitespace', () => {
    expect(EMAIL_REGEX.test('buyer @example.com')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(EMAIL_REGEX.test('')).toBe(false);
  });
});

describe('UUID_REGEX', () => {
  test('accepts a lowercase v4-shaped UUID', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('accepts an uppercase UUID (case-insensitive)', () => {
    expect(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  test('rejects a UUID missing a hyphen group', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716446655440000')).toBe(false);
  });

  test('rejects a UUID with a non-hex character', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-44665544000z')).toBe(false);
  });

  test('rejects a plain string', () => {
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(UUID_REGEX.test('')).toBe(false);
  });
});

describe('escapeHtml', () => {
  test('escapes ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  test('escapes all entity types together in one pass', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  test('leaves plain text unchanged', () => {
    expect(escapeHtml('Retatrutide 5mg')).toBe('Retatrutide 5mg');
  });

  test('returns an empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});
