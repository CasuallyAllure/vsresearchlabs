/**
 * The one number a member campaign must not get wrong: what the recipient is
 * actually charged. Coupon percents and the automatic account rate are two
 * slices off the same base in place-order (orderTotals pass 2a/2b), so the
 * mail has to quote their SUM, not the code's own percent.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MEMBER_DISCOUNT_PERCENT, TIER_FLOOR_PERCENTS } from '../../src/lib/memberPricing';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import {
  advertisedPercent, defaultCampaignKey, sendCampaign, tierFloorPercent,
} from '../../src/pages/admin/members/useBroadcast';

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

describe('sendCampaign', () => {
  beforeEach(() => { seam.client = null; });

  test('sends no kind field — the edge function must default it to campaign', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'sent' }, error: null }));
    seam.client = { functions: { invoke } };

    const recipient = {
      userId: 'u1', name: 'Ada Reyes', contact: 'ada@example.com',
      segment: 'active' as const, vip: false, tier: 'member' as const,
      joinedIso: '2026-01-01', optOut: false,
    };
    await sendCampaign(
      [recipient],
      { subject: 'Hi', body: 'Hello', campaignKey: 'member30-2026-08-24', offer: null },
      () => {},
      0,
    );

    expect(invoke).toHaveBeenCalledOnce();
    const body = invoke.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('kind');
    expect(body.campaign_key).toBe('member30-2026-08-24');
  });
});
