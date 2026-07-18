/**
 * Unit tests for src/lib/payment.ts — formatUsd().
 *
 * PAYMENT_CONFIG reads Vite env at module scope; formatUsd is the pure,
 * user-facing money formatter that renders on the invoice / payment surfaces.
 * These pin the null-safety and cent→USD rules so no order ever shows a bare
 * number or a wrong decimal.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatUsd } from '../../src/lib/payment';

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
  // PAYMENT_CONFIG reads import.meta.env at module scope, so each case
  // stubs the env then re-imports a fresh copy of the module.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('the env var wins when set', async () => {
    vi.stubEnv('VITE_ZELLE_HANDLE', 'owner@zelle.example');
    vi.resetModules();
    const { PAYMENT_CONFIG } = await import('../../src/lib/payment');
    expect(PAYMENT_CONFIG.zelle).toBe('owner@zelle.example');
  });

  test('a build without VITE_ZELLE_HANDLE still shows the real handle — never a placeholder', async () => {
    // The 2026-07-17/18 incident: an out-of-band build lane with no
    // VITE_ZELLE_HANDLE shipped "[Set VITE_ZELLE_HANDLE]" to live buyers.
    vi.stubEnv('VITE_ZELLE_HANDLE', '');
    vi.resetModules();
    const { PAYMENT_CONFIG } = await import('../../src/lib/payment');
    expect(PAYMENT_CONFIG.zelle).toBe('info@velariss.co');
    expect(PAYMENT_CONFIG.zelle).not.toContain('[Set');
  });
});
