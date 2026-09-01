/**
 * The one number a member campaign must not get wrong: what the recipient is
 * actually charged. Coupon percents and the automatic account rate are two
 * slices off the same base in place-order (orderTotals pass 2a/2b), so the
 * mail has to quote their SUM, not the code's own percent.
 */

import { describe, expect, test } from 'vitest';
import { MEMBER_DISCOUNT_PERCENT, TIER_FLOOR_PERCENTS } from '../../src/lib/memberPricing';
import { advertisedPercent, defaultCampaignKey, tierFloorPercent } from '../../src/pages/admin/members/useBroadcast';

describe('advertisedPercent', () => {
  test('a 15% code lands a standard member at 30% — the owner-facing headline', () => {
    expect(advertisedPercent(15)).toBe(30);
  });

  test('it always adds the automatic account rate, never replaces it', () => {
    expect(advertisedPercent(10)).toBe(10 + MEMBER_DISCOUNT_PERCENT);
  });

  test('it never advertises more than the whole order', () => {
    expect(advertisedPercent(95)).toBe(100);
  });

  test('pro accounts land ABOVE the advertised figure, never below it', () => {
    expect(tierFloorPercent('pro')).toBe(TIER_FLOOR_PERCENTS.pro);
    expect(tierFloorPercent('pro')).toBeGreaterThan(MEMBER_DISCOUNT_PERCENT);
    expect(tierFloorPercent('member')).toBe(MEMBER_DISCOUNT_PERCENT);
  });
});

describe('defaultCampaignKey', () => {
  test('is stable per code per day, so a re-run is caught by email_log', () => {
    const day = new Date('2026-08-24T12:00:00Z');
    expect(defaultCampaignKey('MEMBER30', day)).toBe('member30-2026-08-24');
    expect(defaultCampaignKey('MEMBER30', day)).toBe(defaultCampaignKey('MEMBER30', day));
  });

  test('strips anything the edge function would reject as a key', () => {
    expect(defaultCampaignKey('SUMMER SALE!', new Date('2026-08-24T00:00:00Z'))).toBe('summersale-2026-08-24');
    expect(defaultCampaignKey(null, new Date('2026-08-24T00:00:00Z'))).toBe('note-2026-08-24');
  });
});
