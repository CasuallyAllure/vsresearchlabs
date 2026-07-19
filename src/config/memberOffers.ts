/**
 * memberOffers — account-holder pricing term(s) advertised on the
 * customer portal (Benefits page + Overview dashboard) regardless of whether
 * the customer has any per-customer `customer_discounts` rows. Edit this
 * array to change or remove the active offer(s); no code change needed.
 */

export interface MemberOffer {
  code: string;
  headline: string;
  detail: string;
  expiresLabel: string;
}

export const MEMBER_OFFERS: MemberOffer[] = [
  {
    code: 'Q3MEMBER15',
    headline: '15% account-holder discount',
    detail: 'Applies to account-holder orders. Enter the code at checkout.',
    expiresLabel: 'Current term · through Q3'
  },
];
