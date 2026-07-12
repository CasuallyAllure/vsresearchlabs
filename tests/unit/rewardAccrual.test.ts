/**
 * Unit tests for the reward accrual rule (1 point per whole dollar billed).
 * See tests/fixtures/rewardAccrual.ts for why this is a fixture, not an
 * import from src/ — the rule lives in SQL (migration 044).
 */
import { describe, expect, test } from 'vitest';
import { rewardPointsForCents } from '../fixtures/rewardAccrual';

describe('rewardPointsForCents', () => {
  test('floors to whole dollars — 9999¢ earns 99 points', () => {
    expect(rewardPointsForCents(9_999)).toBe(99);
  });

  test('earns exactly 1 point per whole dollar for an even amount', () => {
    expect(rewardPointsForCents(10_000)).toBe(100);
  });

  test('earns 0 points for any amount under $1', () => {
    expect(rewardPointsForCents(99)).toBe(0);
    expect(rewardPointsForCents(1)).toBe(0);
    expect(rewardPointsForCents(0)).toBe(0);
  });

  test('earns 0 points at exactly $0', () => {
    expect(rewardPointsForCents(0)).toBe(0);
  });

  test('a fractional-cent-free order right at $1 earns exactly 1 point', () => {
    expect(rewardPointsForCents(100)).toBe(1);
  });
});
