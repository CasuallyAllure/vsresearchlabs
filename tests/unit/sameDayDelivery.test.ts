import { describe, test, expect } from 'vitest';
import {
  SAME_DAY_MINIMUM_CENTS,
  SAME_DAY_ZONES,
  centsToSameDay,
  sameDayProgress,
} from '../../src/lib/sameDayDelivery';

describe('same-day term constants', () => {
  test('the floor is the $300 the storefront advertises', () => {
    expect(SAME_DAY_MINIMUM_CENTS).toBe(30_000);
  });

  test('lists the seven Bay Area zones the owner delivers to', () => {
    expect(SAME_DAY_ZONES).toHaveLength(7);
    expect(SAME_DAY_ZONES).toContain('Benicia, CA');
    expect(SAME_DAY_ZONES).toContain('Pinole, CA');
  });
});

describe('centsToSameDay', () => {
  test('reports the full floor for an empty cart', () => {
    expect(centsToSameDay(0)).toBe(SAME_DAY_MINIMUM_CENTS);
  });

  test('counts down toward the floor', () => {
    expect(centsToSameDay(20_000)).toBe(10_000);
  });

  test('is zero exactly at the floor', () => {
    expect(centsToSameDay(SAME_DAY_MINIMUM_CENTS)).toBe(0);
  });

  test('never goes negative past the floor', () => {
    expect(centsToSameDay(90_000)).toBe(0);
  });

  test('treats a negative or non-finite subtotal as an empty cart', () => {
    expect(centsToSameDay(-500)).toBe(SAME_DAY_MINIMUM_CENTS);
    expect(centsToSameDay(Number.NaN)).toBe(SAME_DAY_MINIMUM_CENTS);
    expect(centsToSameDay(Number.POSITIVE_INFINITY)).toBe(SAME_DAY_MINIMUM_CENTS);
  });

  test('rounds a fractional subtotal to whole cents', () => {
    expect(centsToSameDay(20_000.4)).toBe(10_000);
  });
});

describe('sameDayProgress', () => {
  test('is zero for an empty cart', () => {
    expect(sameDayProgress(0)).toBe(0);
  });

  test('is the fraction of the floor reached', () => {
    expect(sameDayProgress(15_000)).toBeCloseTo(0.5);
  });

  test('clamps to one past the floor', () => {
    expect(sameDayProgress(90_000)).toBe(1);
  });

  test('treats a negative or non-finite subtotal as zero', () => {
    expect(sameDayProgress(-1)).toBe(0);
    expect(sameDayProgress(Number.NaN)).toBe(0);
  });
});
