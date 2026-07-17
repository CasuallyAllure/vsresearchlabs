/**
 * Unit tests for src/lib/format.ts — pure procurement formatting helpers.
 */
import { describe, expect, test } from 'vitest';
import {
  formatDate,
  formatProcurementNumber,
  formatQuantityUnit,
  formatShortCode,
} from '../../src/lib/format';

describe('formatDate', () => {
  test('slices an ISO datetime down to the YYYY-MM-DD date portion', () => {
    // Arrange
    const iso = '2026-07-17T12:34:56.000Z';

    // Act
    const result = formatDate(iso);

    // Assert
    expect(result).toBe('2026-07-17');
  });

  test('returns a bare YYYY-MM-DD date unchanged', () => {
    expect(formatDate('2026-07-17')).toBe('2026-07-17');
  });

  test('returns the input unchanged when it is shorter than a full date', () => {
    // Arrange — length < 10, e.g. a malformed/partial date string.
    const iso = '2026-07';

    // Act / Assert
    expect(formatDate(iso)).toBe('2026-07');
  });

  test('returns an empty string unchanged', () => {
    expect(formatDate('')).toBe('');
  });
});

describe('formatProcurementNumber', () => {
  test('returns "Inquire for pricing" for null', () => {
    expect(formatProcurementNumber(null)).toBe('Inquire for pricing');
  });

  test('returns "Inquire for pricing" for zero cents', () => {
    expect(formatProcurementNumber(0)).toBe('Inquire for pricing');
  });

  test('formats a whole-dollar amount with two decimal places', () => {
    expect(formatProcurementNumber(10_000)).toBe('$100.00 USD');
  });

  test('formats a sub-dollar amount correctly', () => {
    expect(formatProcurementNumber(99)).toBe('$0.99 USD');
  });

  test('formats an amount with a fractional cent by rounding via toFixed', () => {
    // Arrange — 333 cents / 100 = 3.33 exactly, no rounding ambiguity here.
    expect(formatProcurementNumber(333)).toBe('$3.33 USD');
  });

  test('formats a single cent', () => {
    expect(formatProcurementNumber(1)).toBe('$0.01 USD');
  });
});

describe('formatQuantityUnit', () => {
  test('joins a quantity and unit with a space', () => {
    expect(formatQuantityUnit(5, 'mg')).toBe('5 mg');
  });

  test('formats a zero quantity', () => {
    expect(formatQuantityUnit(0, 'units')).toBe('0 units');
  });

  test('formats a negative quantity without special-casing it', () => {
    expect(formatQuantityUnit(-3, 'mg')).toBe('-3 mg');
  });

  test('formats a fractional quantity', () => {
    expect(formatQuantityUnit(2.5, 'mL')).toBe('2.5 mL');
  });

  test('formats an empty unit string', () => {
    expect(formatQuantityUnit(10, '')).toBe('10 ');
  });
});

describe('formatShortCode', () => {
  test('uppercases a lowercase code', () => {
    expect(formatShortCode('sem')).toBe('SEM');
  });

  test('trims leading and trailing whitespace', () => {
    expect(formatShortCode('  bpc  ')).toBe('BPC');
  });

  test('leaves an already-uppercase code unchanged', () => {
    expect(formatShortCode('TB500')).toBe('TB500');
  });

  test('returns an empty string for an empty or whitespace-only input', () => {
    expect(formatShortCode('   ')).toBe('');
  });

  test('preserves internal whitespace and hyphens while trimming only the ends', () => {
    expect(formatShortCode('  bpc-157 vial  ')).toBe('BPC-157 VIAL');
  });
});
