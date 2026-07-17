/**
 * Unit tests for supabase/functions/place-order/orderIdentifiers.ts — pure
 * reference/order-number generation extracted verbatim from the place-order
 * handler (stamp, randomCode, generateReferenceId, generateOrderNumber).
 */
import { describe, expect, test } from 'vitest';
import {
  ORDER_ALPHABET,
  randomCode,
  generateReferenceId,
  generateOrderNumber,
} from '../../supabase/functions/place-order/orderIdentifiers';

describe('randomCode', () => {
  test('returns a string of the requested length', () => {
    expect(randomCode(6)).toHaveLength(6);
    expect(randomCode(1)).toHaveLength(1);
    expect(randomCode(12)).toHaveLength(12);
  });

  test('returns an empty string for length 0', () => {
    expect(randomCode(0)).toBe('');
  });

  test('never emits the ambiguous characters O, 0, I, 1, L', () => {
    // Generate a large sample so a low-probability alphabet bug would show up.
    for (let i = 0; i < 500; i++) {
      const code = randomCode(20);
      expect(code).not.toMatch(/[O0I1L]/);
    }
  });

  test('only emits characters from ORDER_ALPHABET', () => {
    const code = randomCode(50);
    for (const ch of code) {
      expect(ORDER_ALPHABET).toContain(ch);
    }
  });

  test('ORDER_ALPHABET itself excludes ambiguous characters', () => {
    expect(ORDER_ALPHABET).not.toMatch(/[O0I1L]/);
  });
});

describe('generateOrderNumber', () => {
  test('matches the VSR-XXXXXX format with a 6-char code', () => {
    const orderNumber = generateOrderNumber();
    expect(orderNumber).toMatch(/^VSR-[A-Z0-9]{6}$/);
  });

  test('the 6-char suffix never contains ambiguous characters', () => {
    const orderNumber = generateOrderNumber();
    const suffix = orderNumber.slice('VSR-'.length);
    expect(suffix).toHaveLength(6);
    expect(suffix).not.toMatch(/[O0I1L]/);
  });

  test('produces distinct values across calls', () => {
    const numbers = new Set(Array.from({ length: 50 }, () => generateOrderNumber()));
    // Astronomically unlikely to collide across 50 draws from a 32^6 space —
    // a collision here would indicate a broken RNG, not bad luck.
    expect(numbers.size).toBe(50);
  });
});

describe('generateReferenceId', () => {
  test('matches the VSR-REQ-YYMMDD-NNN format', () => {
    const referenceId = generateReferenceId();
    expect(referenceId).toMatch(/^VSR-REQ-\d{6}-\d{3}$/);
  });

  test('encodes today\'s UTC date in the YYMMDD segment', () => {
    const referenceId = generateReferenceId();
    const now = new Date();
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    expect(referenceId).toContain(`VSR-REQ-${yy}${mm}${dd}-`);
  });
});
