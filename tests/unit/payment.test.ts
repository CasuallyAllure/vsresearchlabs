/**
 * Unit tests for src/lib/payment.ts — formatUsd().
 *
 * PAYMENT_CONFIG reads Vite env at module scope; formatUsd is the pure,
 * user-facing money formatter that renders on the invoice / payment surfaces.
 * These pin the null-safety and cent→USD rules so no order ever shows a bare
 * number or a wrong decimal.
 */
import { describe, expect, test } from 'vitest';
import { formatUsd, PAYMENT_CONFIG } from '../../src/lib/payment';

describe('formatUsd', () => {
  test('formats whole-dollar cents with two decimals', () => {
    expect(formatUsd(10500)).toBe('$105.00');
  });

  test('formats sub-dollar cents', () => {
    expect(formatUsd(5)).toBe('$0.05');
  });

  test('adds thousands separators', () => {
    expect(formatUsd(1234567)).toBe('$12,345.67');
  });

  test('renders zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  test('renders an em-dash for null', () => {
    expect(formatUsd(null)).toBe('—');
  });

  test('renders an em-dash for undefined', () => {
    expect(formatUsd(undefined)).toBe('—');
  });
});

describe('PAYMENT_CONFIG', () => {
  test('exposes zelle and paypal handle fields', () => {
    // In the test env the real handles may or may not be set; the contract is
    // that both keys always resolve to a non-empty string (real or placeholder).
    expect(typeof PAYMENT_CONFIG.zelle).toBe('string');
    expect(PAYMENT_CONFIG.zelle.length).toBeGreaterThan(0);
    expect(typeof PAYMENT_CONFIG.paypal).toBe('string');
    expect(PAYMENT_CONFIG.paypal.length).toBeGreaterThan(0);
  });
});
