/**
 * src/config/tierBenefits.ts — the portal's tier-benefit config.
 *
 * Pins the shape the Overview membership card and Benefits page render from:
 * both tiers present with non-empty benefit lists, and the pro tier carries
 * the 20% account-rate line (the concrete term that distinguishes it).
 */
import { describe, expect, test } from 'vitest';

import { TIER_BENEFITS } from '../../src/config/tierBenefits';

describe('TIER_BENEFITS', () => {
  test('both tiers are present with labels and non-empty benefit lists', () => {
    for (const tier of ['member', 'pro'] as const) {
      expect(TIER_BENEFITS[tier].label.length).toBeGreaterThan(0);
      expect(TIER_BENEFITS[tier].benefits.length).toBeGreaterThan(0);
      for (const benefit of TIER_BENEFITS[tier].benefits) {
        expect(benefit.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('member lists the 15% account rate', () => {
    expect(TIER_BENEFITS.member.benefits.some((b) => b.includes('15%'))).toBe(true);
  });

  test('pro includes the 20% account-rate line', () => {
    expect(TIER_BENEFITS.pro.benefits.some((b) => b.includes('20%'))).toBe(true);
  });
});
