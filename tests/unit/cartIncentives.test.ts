import { describe, test, expect } from 'vitest';
import {
  cartIncentives,
  winningDiscount,
  memberUpliftCents,
  type CartIncentiveInput,
} from '../../src/lib/cartIncentives';
import { GUEST_SHIPPING_CENTS } from '../../src/lib/shipping';
import { SAME_DAY_MINIMUM_CENTS } from '../../src/lib/sameDayDelivery';

/** A guest cart with nothing special applied. */
function base(over: Partial<CartIncentiveInput> = {}): CartIncentiveInput {
  return {
    subtotalCents: 20_000,
    isMember: false,
    memberPercent: 15,
    b2g1Cents: 0,
    wholesaleApplies: false,
    bundleCents: 0,
    ...over,
  };
}

describe('winningDiscount — precedence ladder', () => {
  test('wholesale outranks every other discount', () => {
    // Arrange — a cart where bundle, B2G1 and the member % would all apply
    const input = base({
      isMember: true,
      wholesaleApplies: true,
      bundleCents: 5_000,
      b2g1Cents: 9_000,
    });

    // Act
    const win = winningDiscount(input);

    // Assert
    expect(win.kind).toBe('wholesale');
  });

  test('bundle outranks B2G1 and the member percentage', () => {
    const input = base({ isMember: true, bundleCents: 4_000, b2g1Cents: 9_000 });

    expect(winningDiscount(input)).toEqual({ kind: 'bundle', valueCents: 4_000 });
  });

  test('B2G1 wins when it is worth more than the member percentage', () => {
    // 15% of $200 = $30; B2G1 worth $60
    const input = base({ isMember: true, b2g1Cents: 6_000 });

    expect(winningDiscount(input)).toEqual({ kind: 'b2g1', valueCents: 6_000 });
  });

  test('member percentage wins when it is worth more than B2G1', () => {
    // 15% of $200 = $30; B2G1 worth $10
    const input = base({ isMember: true, b2g1Cents: 1_000 });

    expect(winningDiscount(input)).toEqual({ kind: 'member', valueCents: 3_000 });
  });

  test('a tie breaks to B2G1, matching owner policy', () => {
    // 15% of $200 = $30 exactly
    const input = base({ isMember: true, b2g1Cents: 3_000 });

    expect(winningDiscount(input).kind).toBe('b2g1');
  });

  test('returns none when nothing applies to a guest', () => {
    expect(winningDiscount(base())).toEqual({ kind: 'none', valueCents: 0 });
  });

  test('a guest with a live B2G1 term still wins it', () => {
    expect(winningDiscount(base({ b2g1Cents: 2_500 }))).toEqual({
      kind: 'b2g1',
      valueCents: 2_500,
    });
  });

  test('zero subtotal yields no member value', () => {
    const input = base({ isMember: true, subtotalCents: 0 });

    expect(winningDiscount(input).kind).toBe('none');
  });

  test('a zero member percentage yields no member value', () => {
    const input = base({ isMember: true, memberPercent: 0 });

    expect(winningDiscount(input).kind).toBe('none');
  });
});

describe('memberUpliftCents — what an account is actually worth', () => {
  test('is zero for someone who already has an account', () => {
    expect(memberUpliftCents(base({ isMember: true }))).toBe(0);
  });

  test('is the discount plus the shipping waiver for a plain guest cart', () => {
    // 15% of $200 = $30, plus the flat guest shipping fee
    expect(memberUpliftCents(base())).toBe(3_000 + GUEST_SHIPPING_CENTS);
  });

  test('counts only the margin over a B2G1 term the guest already receives', () => {
    // Member % worth $30, B2G1 already giving them $20 → only $10 of new discount
    expect(memberUpliftCents(base({ b2g1Cents: 2_000 }))).toBe(1_000 + GUEST_SHIPPING_CENTS);
  });

  test('never goes negative when B2G1 already beats the percentage', () => {
    expect(memberUpliftCents(base({ b2g1Cents: 9_000 }))).toBe(GUEST_SHIPPING_CENTS);
  });

  test('is shipping only when a bundle final price outranks the percentage', () => {
    expect(memberUpliftCents(base({ bundleCents: 4_000 }))).toBe(GUEST_SHIPPING_CENTS);
  });

  test('is shipping only when wholesale outranks the percentage', () => {
    expect(memberUpliftCents(base({ wholesaleApplies: true }))).toBe(GUEST_SHIPPING_CENTS);
  });
});

describe('cartIncentives — panel model', () => {
  test('a member sees their discount and their free shipping as applied', () => {
    const model = cartIncentives(base({ isMember: true }));

    expect(model.applied.map((r) => r.id)).toEqual(['member-discount', 'member-shipping']);
    expect(model.savingCents).toBe(3_000 + GUEST_SHIPPING_CENTS);
  });

  test('a guest is invited to create an account, quoted the real uplift', () => {
    const model = cartIncentives(base());

    const invite = model.reachable.find((r) => r.id === 'member-invite');
    expect(invite?.kind).toBe('invitation');
    expect(invite?.valueCents).toBe(3_000 + GUEST_SHIPPING_CENTS);
    expect(model.memberUpliftCents).toBe(3_000 + GUEST_SHIPPING_CENTS);
  });

  test('a member is not invited to create an account', () => {
    const model = cartIncentives(base({ isMember: true }));

    expect(model.reachable.find((r) => r.id === 'member-invite')).toBeUndefined();
  });

  test('counts the buyer up to the same-day floor', () => {
    // $200 cart against a $300 floor → $100 to go
    const model = cartIncentives(base({ subtotalCents: 20_000 }));

    const sameDay = model.reachable.find((r) => r.id === 'same-day');
    expect(sameDay?.label).toBe('Add $100 for same-day delivery');
    expect(sameDay?.met).toBe(false);
    expect(sameDay?.progress).toBeCloseTo(20_000 / SAME_DAY_MINIMUM_CENTS);
  });

  test('marks same-day as met once the floor is cleared', () => {
    const model = cartIncentives(base({ subtotalCents: SAME_DAY_MINIMUM_CENTS }));

    const sameDay = model.reachable.find((r) => r.id === 'same-day');
    expect(sameDay?.met).toBe(true);
    expect(sameDay?.progress).toBe(1);
  });

  test('formats a fractional remainder to cents', () => {
    // $257.42 cart → $42.58 to go
    const model = cartIncentives(base({ subtotalCents: 25_742 }));

    expect(model.reachable.find((r) => r.id === 'same-day')?.label).toBe(
      'Add $42.58 for same-day delivery',
    );
  });

  test('omits same-day entirely for a wholesale order, which is excluded', () => {
    const model = cartIncentives(base({ wholesaleApplies: true }));

    expect(model.reachable.find((r) => r.id === 'same-day')).toBeUndefined();
  });

  test('a wholesale order reports a final price and no stacked value', () => {
    const model = cartIncentives(base({ isMember: true, wholesaleApplies: true }));

    expect(model.applied.map((r) => r.id)).toEqual(['wholesale', 'member-shipping']);
    // Wholesale is a final price — it contributes no separate savings figure
    expect(model.savingCents).toBe(GUEST_SHIPPING_CENTS);
  });

  test('a bundle order shows the bundle, not the member percentage', () => {
    const model = cartIncentives(base({ isMember: true, bundleCents: 4_000 }));

    expect(model.applied.map((r) => r.id)).toEqual(['bundle', 'member-shipping']);
  });

  test('B2G1 copy does not reference a percentage a guest does not have', () => {
    const model = cartIncentives(base({ b2g1Cents: 2_000 }));

    const row = model.applied.find((r) => r.id === 'b2g1');
    expect(row?.detail).not.toMatch(/member percentage/i);
  });

  test('B2G1 copy explains the exclusivity to a member who has both', () => {
    const model = cartIncentives(base({ isMember: true, b2g1Cents: 9_000 }));

    expect(model.applied.find((r) => r.id === 'b2g1')?.detail).toMatch(/never stack/i);
  });

  test('a guest with nothing applied has no applied rows', () => {
    const model = cartIncentives(base());

    expect(model.applied).toEqual([]);
    expect(model.savingCents).toBe(0);
  });
});
