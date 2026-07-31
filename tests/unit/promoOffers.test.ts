import { describe, test, expect, beforeEach } from 'vitest';
import {
  activeOffers,
  offersSignature,
  memberPercentFor,
  isPromoSurface,
} from '../../src/lib/promoOffers';
import { usePromoSettings } from '../../src/lib/promoSettings';
import { TIER_FLOOR_PERCENTS, MEMBER_DISCOUNT_PERCENT } from '../../src/lib/memberPricing';

/** The store is module-level state; reset it between cases. */
function setPromo(over: Partial<{ b2g1Enabled: boolean; b2g1EndsAt: string | null }> = {}) {
  usePromoSettings.setState({
    b2g1Enabled: false,
    b2g1EndsAt: null,
    b2g1ExcludedSkus: [],
    ...over,
  });
}

beforeEach(() => setPromo());

describe('memberPercentFor', () => {
  test('quotes a guest the advertised entry offer', () => {
    expect(memberPercentFor({ isMember: false })).toBe(MEMBER_DISCOUNT_PERCENT);
  });

  test('quotes a base member their floor', () => {
    expect(memberPercentFor({ isMember: true, tier: 'member' })).toBe(TIER_FLOOR_PERCENTS.member);
  });

  test('quotes a pro member the higher pro floor', () => {
    expect(memberPercentFor({ isMember: true, tier: 'pro' })).toBe(TIER_FLOOR_PERCENTS.pro);
  });

  test('degrades an unknown tier to the base member floor', () => {
    expect(memberPercentFor({ isMember: true, tier: 'mystery' })).toBe(TIER_FLOOR_PERCENTS.member);
    expect(memberPercentFor({ isMember: true, tier: null })).toBe(TIER_FLOOR_PERCENTS.member);
  });
});

describe('activeOffers — never advertises a dead promo', () => {
  test('omits B2G1 while the promo is switched off', () => {
    setPromo({ b2g1Enabled: false });

    expect(activeOffers({ isMember: false }).map((o) => o.id)).not.toContain('b2g1');
  });

  test('includes B2G1 while the promo is live', () => {
    setPromo({ b2g1Enabled: true });

    expect(activeOffers({ isMember: false }).map((o) => o.id)).toContain('b2g1');
  });

  test('omits B2G1 once the term has ended', () => {
    setPromo({ b2g1Enabled: true, b2g1EndsAt: '2020-01-01T00:00:00Z' });

    expect(activeOffers({ isMember: false }).map((o) => o.id)).not.toContain('b2g1');
  });

  test('names the end date when the live term has one', () => {
    setPromo({ b2g1Enabled: true, b2g1EndsAt: '2099-06-15T00:00:00Z' });

    const b2g1 = activeOffers({ isMember: false }).find((o) => o.id === 'b2g1');
    expect(b2g1?.detail).toMatch(/Effective through/);
  });

  test('always offers the four standing terms', () => {
    expect(activeOffers({ isMember: false }).map((o) => o.id)).toEqual([
      'member-discount',
      'member-shipping',
      'wholesale',
      'same-day',
    ]);
  });
});

describe('activeOffers — phrasing adapts to who is looking', () => {
  test('invites a guest to create an account', () => {
    const offers = activeOffers({ isMember: false });

    expect(offers.find((o) => o.id === 'member-discount')?.held).toBe(false);
    expect(offers.find((o) => o.id === 'member-discount')?.detail).toMatch(/Create an account/);
    expect(offers.find((o) => o.id === 'member-shipping')?.detail).toMatch(/Guests pay/);
  });

  test('tells a member the perks are already theirs', () => {
    const offers = activeOffers({ isMember: true, tier: 'member' });

    expect(offers.find((o) => o.id === 'member-discount')?.held).toBe(true);
    expect(offers.find((o) => o.id === 'member-discount')?.label).toMatch(/Your member pricing/);
    expect(offers.find((o) => o.id === 'member-shipping')?.label).toBe('Your orders ship free');
  });

  test('quotes a pro member 20 percent, not the entry 15', () => {
    const offers = activeOffers({ isMember: true, tier: 'pro' });

    expect(offers.find((o) => o.id === 'member-discount')?.label).toContain('20%');
  });

  test('tells a guest that wholesale needs an account', () => {
    expect(activeOffers({ isMember: false }).find((o) => o.id === 'wholesale')?.detail).toMatch(
      /Requires an account/,
    );
  });

  test('does not repeat the account requirement to a member', () => {
    expect(activeOffers({ isMember: true }).find((o) => o.id === 'wholesale')?.detail).not.toMatch(
      /Requires an account/,
    );
  });
});

describe('activeOffers — states exclusivity, never implies a stack', () => {
  test('the member percentage says it does not stack', () => {
    const detail = activeOffers({ isMember: true }).find((o) => o.id === 'member-discount')?.detail;

    expect(detail).toMatch(/does not stack/i);
  });

  test('B2G1 says the larger of the two bills', () => {
    setPromo({ b2g1Enabled: true });

    expect(activeOffers({ isMember: true }).find((o) => o.id === 'b2g1')?.detail).toMatch(
      /does not combine/i,
    );
  });

  test('wholesale says it is a final price that outranks the rest', () => {
    expect(activeOffers({ isMember: true }).find((o) => o.id === 'wholesale')?.detail).toMatch(
      /final price/i,
    );
  });

  test('B2G1 excludes 24 hour items, matching the server gate', () => {
    setPromo({ b2g1Enabled: true });

    expect(activeOffers({ isMember: false }).find((o) => o.id === 'b2g1')?.detail).toMatch(
      /24 hours are not part of the term/,
    );
  });

  test('same-day names the floor and the wholesale exclusion', () => {
    const detail = activeOffers({ isMember: false }).find((o) => o.id === 'same-day')?.detail;

    expect(detail).toMatch(/\$300/);
    expect(detail).toMatch(/Wholesale case orders are excluded/);
  });
});

describe('isPromoSurface — shop surfaces only', () => {
  test.each([
    '/catalog',
    '/cart',
    '/product/VSR-RS-RTT-005',
    '/research-supplies',
    '/research-supplies/biopeptide',
    '/laboratory-equipment',
  ])('shows the ticker on %s', (path) => {
    expect(isPromoSurface(path)).toBe(true);
  });

  test.each([
    '/',
    '/research',
    '/contact',
    '/track',
    '/account',
    '/account/orders',
    '/admin',
    '/c/retatrutide',
  ])('keeps the ticker off %s', (path) => {
    expect(isPromoSurface(path)).toBe(false);
  });

  test('does not match a prefix that merely starts with a surface name', () => {
    // '/cartography' must not count as '/cart'
    expect(isPromoSurface('/cartography')).toBe(false);
    expect(isPromoSurface('/catalogue-archive')).toBe(false);
  });

  test('handles a missing or empty path without throwing', () => {
    expect(isPromoSurface('')).toBe(false);
    expect(isPromoSurface(undefined as unknown as string)).toBe(false);
  });
});

describe('offersSignature — dismissal survives, new promos return', () => {
  test('is stable for the same set of offers', () => {
    const a = offersSignature(activeOffers({ isMember: false }));
    const b = offersSignature(activeOffers({ isMember: false }));

    expect(a).toBe(b);
  });

  test('changes when a new promo goes live', () => {
    const before = offersSignature(activeOffers({ isMember: false }));
    setPromo({ b2g1Enabled: true });
    const after = offersSignature(activeOffers({ isMember: false }));

    expect(after).not.toBe(before);
  });

  test('changes when the buyer signs in and the perks become theirs', () => {
    const guest = offersSignature(activeOffers({ isMember: false }));
    const member = offersSignature(activeOffers({ isMember: true }));

    expect(member).not.toBe(guest);
  });
});
