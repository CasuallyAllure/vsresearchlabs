/**
 * accountPanels/shared — types, constants and helpers shared by the three
 * member-management panels (ProfileFlags / Rewards / Discounts). No JSX here so
 * fast-refresh treats the panel files as pure component modules; the UI atoms
 * live in ./atoms.
 *
 * Extracted verbatim from the former src/pages/admin/CustomerAccountPanels.tsx
 * so the customer-detail page and the /admin/members rows share one code path.
 */

import { FIELD_SURFACE, FIELD_DEFAULT } from '../../ui/Field';

// ── Domain types ─────────────────────────────────────────────────────────────

export type ProfileTier = 'member' | 'pro';
export type ProfileStatus = 'active' | 'waitlisted' | 'suspended';
export type AccountType = 'individual' | 'business';

export interface ProfileRow {
  user_id: string;
  full_name: string;
  tier: ProfileTier;
  status: ProfileStatus;
  account_type: AccountType;
  business_name: string | null;
  free_shipping: boolean;
}

export interface RewardEntry {
  kind: 'earn' | 'reversal' | 'adjustment';
  points: number;
  note: string | null;
  created_at: string;
  order_id: string | null;
}

export interface DiscountRow {
  id: string;
  scope: 'lifetime' | 'business';
  percent: number;
  label: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

export type ConfirmFn = (
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string },
) => Promise<boolean>;

export const RECENT_REWARD_ENTRIES = 10;

export const NOT_MIGRATED_NOTE =
  'Portal backend not migrated yet — apply migrations 043–045 (and 049 for free shipping) to enable this panel.';

/** Canonical input class for the panel forms (AdminCoupons house style). */
export const inputCls = [
  FIELD_SURFACE,
  FIELD_DEFAULT,
  'mb-[var(--space-3)] disabled:opacity-40 disabled:cursor-not-allowed',
].join(' ');

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/**
 * True when the failure smells like migrations 043–045 not being applied:
 * undefined table (42P01), undefined column (42703), or PostgREST's
 * missing-function code (PGRST202).
 */
export function isMissingBackend(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42P01' || code === '42703' || code === 'PGRST202') return true;
  const msg = getErrorMessage(error);
  return /does not exist|could not find the function|schema cache/i.test(msg);
}

export function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtSignedPoints(points: number): string {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

/** Active AND not past its expiry (module-scope so render stays pure). */
export function isLiveDiscount(row: DiscountRow): boolean {
  if (!row.active) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

/** Mirrors automation_candidates' reward_ready periodKey ('rr-' ||
 *  floor(balance/300), 091) so RewardsPanel's manual "Notify member" keys the
 *  same 300-point stage the reward_ready cron would. send-member-offer claims
 *  (recipient, kind, period_key) in email_log before sending, so a second
 *  press on the same stage is a no-op rather than a second mail. */
export function rewardCampaignKey(balance: number): string {
  return `rr-${Math.floor(balance / 300)}`;
}
