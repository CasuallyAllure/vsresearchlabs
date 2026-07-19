// @vitest-environment happy-dom
/**
 * Reward surfaces read as an account statement, not a loyalty programme.
 *
 * The reward/discount system is kept exactly as it is — accrual, threshold,
 * percentage, and eligibility are server-side and untouched. What changed is
 * the presentation: a balance line with tabular figures and hairline rules
 * instead of a promotional card.
 *
 * These tests pin BEHAVIOUR, not pixels: the figures a customer reads off
 * these surfaces must be the ones the summary carries, in every state
 * (accruing, ready, voucher on file), and the term must still be stated.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { RewardTracker } from '../../src/components/account/RewardTracker';
import { MemberOfferCard } from '../../src/components/account/MemberOfferCard';
import type { RewardSummary } from '../../src/lib/accountData';

afterEach(cleanup);

function makeSummary(overrides: Partial<RewardSummary> = {}): RewardSummary {
  return {
    balance: 240,
    threshold: 300,
    percent: 40,
    reward_ready: false,
    active_voucher: null,
    entries: [],
    ...overrides,
  };
}

const noop = () => {};

describe('RewardTracker', () => {
  test('reads the balance off the summary, in units', () => {
    // Arrange / Act
    render(<RewardTracker summary={makeSummary({ balance: 1240 })} onChanged={noop} />);

    // Assert
    expect(screen.getByText('Balance')).toBeTruthy();
    expect(screen.getByText('1,240')).toBeTruthy();
    expect(screen.getByText('units')).toBeTruthy();
  });

  test('states the remaining units to the next credit while accruing', () => {
    render(<RewardTracker summary={makeSummary({ balance: 240, threshold: 300 })} onChanged={noop} />);

    expect(screen.getByText('To next credit')).toBeTruthy();
    expect(screen.getByText('60 units')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });

  test('offers the redemption once the threshold is met', () => {
    render(
      <RewardTracker
        summary={makeSummary({ balance: 300, reward_ready: true })}
        onChanged={noop}
      />,
    );

    expect(screen.getByText('Credit available')).toBeTruthy();
    expect(screen.getByRole('button', { name: /apply 40% credit to an item/i })).toBeTruthy();
  });

  test('reports an active voucher as credit on file, with its percentage', () => {
    render(
      <RewardTracker
        summary={makeSummary({
          balance: 0,
          active_voucher: { id: 'v1', percent: 40, created_at: '2026-01-01T00:00:00.000Z' },
        })}
        onChanged={noop}
      />,
    );

    expect(screen.getByText('Credit on file')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText(/highest-priced line/i)).toBeTruthy();
  });

  test('states the accrual term factually', () => {
    render(<RewardTracker summary={makeSummary()} onChanged={noop} />);

    expect(screen.getByText(/accrues 1 unit per \$1 ordered/i)).toBeTruthy();
    expect(screen.getByText(/does not apply to volume orders/i)).toBeTruthy();
  });
});

describe('MemberOfferCard', () => {
  test('states the term, its figure, and its code', () => {
    render(
      <MemberOfferCard
        offer={{
          code: 'Q3MEMBER15',
          headline: '15% account-holder discount',
          detail: 'Applies to account-holder orders. Enter the code at checkout.',
          expiresLabel: 'Current term · through Q3',
        }}
      />,
    );

    expect(screen.getByText('Pricing term')).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText('account-holder discount')).toBeTruthy();
    expect(screen.getByText('Q3MEMBER15')).toBeTruthy();
  });
});
