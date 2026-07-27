/**
 * accountPanels — shared, writable member-management controls.
 *
 * The single home for the profile-flags / rewards / discount panels and their
 * audited RPC calls (admin_set_profile_flags / admin_adjust_reward_points /
 * admin_set_customer_discount / admin_deactivate_customer_discount). Consumed
 * by the customer-detail page (via LinkedAccountPanels) and the /admin/members
 * expandable rows (via the individual panels + useLinkedProfile), so there is
 * exactly one write path for every member mutation.
 */

export { LinkedAccountPanels } from './LinkedAccountPanels';
export { ProfileFlagsPanel } from './ProfileFlagsPanel';
export { RewardsPanel } from './RewardsPanel';
export { DiscountsPanel } from './DiscountsPanel';
export { useLinkedProfile, type ProfileLookup, type LinkedProfileState } from './useLinkedProfile';
export type { ProfileRow, AccountType, ProfileTier, ProfileStatus, ConfirmFn } from './shared';
