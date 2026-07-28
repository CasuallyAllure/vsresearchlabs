/**
 * tierBenefits — the standing terms of each membership tier, as presented on
 * the customer portal (Overview membership card + Benefits page). Stated as
 * facts about the account, in the same register as the pricing-term card
 * (src/config/memberOffers.ts). Edit this config to add/rotate benefits —
 * no code change needed.
 */

import type { CustomerTier } from '../lib/customerProfile';

export interface TierBenefitList {
  /** Tier display name as shown in the portal. */
  label: string;
  /** One line per standing term. Factual, no urgency, no outcome language. */
  benefits: string[];
}

export const TIER_BENEFITS: Record<CustomerTier, TierBenefitList> = {
  member: {
    label: 'Member',
    benefits: [
      '15% account rate, applied automatically at checkout',
      'Free shipping on standard orders',
      'Reward accrual — 1 point per $1 paid, redeemable at 300 points',
      'Order history, invoices, and tracking in the portal',
    ],
  },
  pro: {
    label: 'Pro member',
    benefits: [
      'Everything in Member',
      '20% account rate, applied automatically at checkout',
      'Priority fulfillment handling',
    ],
  },
};
