/**
 * membersView — the view-model the Members control center renders.
 *
 * The STABLE contract between the layout (AdminMembers) and its data source.
 * The layout only ever reads `MembersViewData`; it never knows where the data
 * came from. Live data arrives via `useMembersData` → admin_member_stats() /
 * admin_member_roster() / admin_member_attention() (migrations 071/072) over
 * the EXISTING customer_profiles / customers / orders / reward_ledger /
 * customer_discounts / member_invites records.
 *
 * Expansion rule: add optional fields here and populate them in the hook —
 * never reshape what the layout already renders.
 */

export type Segment = 'new' | 'active' | 'at-risk' | 'dormant';
export type Tier = 'member' | 'pro';
export type AccountType = 'individual' | 'business';
export type MemberStatus = 'active' | 'waitlisted' | 'suspended';
export type DiscountScope = 'lifetime' | 'business';

export interface MemberRow {
  /** CRM customers.id — the full-profile deep-link. Null when the portal
   *  account has not been soft-linked to a CRM record yet. */
  id: string | null;
  /** auth.users.id — the stable key for reward/discount lookups. */
  userId: string;
  name: string;
  contact: string;
  org: string | null;
  tier: Tier;
  accountType: AccountType;
  businessName: string | null;
  freeShipping: boolean;
  status: MemberStatus;
  spendCents: number;
  ttmSpendCents: number;
  paidOrders: number;
  points: number;
  rewardReady: boolean;
  effectivePercent: number;
  discountLabel: string | null;
  discountScope: DiscountScope | null;
  discountExpiresIso: string | null;
  joinedIso: string;
  lastOrderIso: string | null;
  segment: Segment;
  vip: boolean;
  spendPercentile: number;
}

/** Loaded lazily when a roster row is expanded — just the activity timeline.
 *  Reward balance and discount rules are owned by the shared management panels
 *  (accountPanels), which fetch their own authoritative data, so the roster RPC
 *  ships no per-row history and the list stays cheap at any page size. */
export interface MemberDetail {
  timeline: Array<{ label: string; iso: string }>;
}

export interface MemberStat {
  label: string;
  value: string;
  meta: string[];
  emphasis?: boolean;
}

export interface MemberQueueItem {
  tone: 'good' | 'warn';
  title: string;
  meta: string;
  action: string;
}

/** The complete payload the Members layout renders. */
export interface MembersViewData {
  stats: MemberStat[];
  queue: MemberQueueItem[];
  members: MemberRow[];
  /** Server-side total for the current filter — drives pagination. */
  total: number;
}
