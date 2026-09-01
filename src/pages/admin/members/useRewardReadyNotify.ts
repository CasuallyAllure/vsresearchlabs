/**
 * useRewardReadyNotify — the Needs-attention queue's "Notify" action for
 * reward_ready: one click mails every member currently over the 300-point
 * threshold, from the queue item, with no roster detour.
 *
 * Recipients come from admin_member_roster's 'reward-ready' segment (092) —
 * the same rows the queue counts. Marketing consent is read from
 * customer_profiles.marketing_opt_out (075) BEFORE the confirm dialog so the
 * owner sees how many are skipped and why; send-member-offer re-checks it
 * server-side regardless. Each send goes through sendRewardReadyNotice (the
 * RewardsPanel "Notify member" call), keyed 'rr-<stage>' per recipient, so a
 * second press reports already_sent instead of mailing twice.
 */

import { useCallback, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { ConfirmFn } from '../../../components/admin/accountPanels/shared';
import { getErrorMessage } from '../../../components/admin/accountPanels/shared';
import { REWARD_READY_SUBJECT, sendRewardReadyNotice } from '../../../components/admin/accountPanels/rewardNotify';
import type { MemberRow } from '../membersView';

/** ponytail: one page; the queue count is single digits today. Paginate if it ever isn't. */
const RECIPIENT_LIMIT = 500;
const NAMES_IN_DIALOG = 6;
const SEND_DELAY_MS = 400;

export interface RewardReadyRecipient {
  userId: string;
  name: string;
  contact: string;
  points: number;
}

export interface RewardNotifyResult {
  sent: number;
  alreadySent: number;
  failed: number;
  /** Excluded before the dialog (marketing_opt_out) plus any the server refused. */
  optedOut: number;
  total: number;
}

/** Reward-ready members split by marketing consent. */
export async function loadRewardReadyRecipients(): Promise<{ eligible: RewardReadyRecipient[]; optedOut: number }> {
  if (!supabase) throw new Error('Backend not configured.');
  const { data, error } = await supabase.rpc('admin_member_roster', {
    p_segment: 'reward-ready', p_sort: 'points', p_search: null, p_limit: RECIPIENT_LIMIT, p_offset: 0,
  });
  if (error) throw error;
  const rows = ((data as { rows?: MemberRow[] } | null)?.rows ?? [])
    .map((r) => ({ userId: r.userId, name: r.name, contact: r.contact, points: r.points }));
  if (rows.length === 0) return { eligible: [], optedOut: 0 };

  const { data: profiles, error: profileError } = await supabase
    .from('customer_profiles')
    .select('user_id, marketing_opt_out')
    .in('user_id', rows.map((r) => r.userId));
  if (profileError) throw profileError;
  const optedOutIds = new Set((profiles ?? []).filter((p) => p.marketing_opt_out).map((p) => p.user_id));

  const eligible = rows.filter((r) => !optedOutIds.has(r.userId));
  return { eligible, optedOut: rows.length - eligible.length };
}

export function rewardNotifyDialogMessage(eligible: RewardReadyRecipient[], optedOut: number): string {
  const names = eligible.slice(0, NAMES_IN_DIALOG).map((r) => `${r.name} (${r.points.toLocaleString()} pts)`);
  const more = eligible.length - names.length;
  const who = `${eligible.length} ${eligible.length === 1 ? 'member' : 'members'}: ${names.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
  const skipped = optedOut > 0
    ? ` ${optedOut} ${optedOut === 1 ? 'member' : 'members'} skipped — opted out of marketing email.`
    : '';
  return `Send "${REWARD_READY_SUBJECT}" to ${who}?${skipped}`;
}

export function summarizeRewardNotify(r: RewardNotifyResult): string {
  const parts = [`${r.sent} sent`];
  if (r.alreadySent > 0) parts.push(`${r.alreadySent} already sent`);
  if (r.optedOut > 0) parts.push(`${r.optedOut} opted out`);
  if (r.failed > 0) parts.push(`${r.failed} failed`);
  return parts.join(' · ');
}

/**
 * Load → confirm → send sequentially. Resolves null when the owner cancels.
 * Throws only on the load step (nothing has been mailed yet).
 */
export async function notifyRewardReadyMembers(
  confirm: ConfirmFn,
  delayMs = SEND_DELAY_MS,
): Promise<RewardNotifyResult | null> {
  const { eligible, optedOut } = await loadRewardReadyRecipients();
  const result: RewardNotifyResult = { sent: 0, alreadySent: 0, failed: 0, optedOut, total: eligible.length };
  if (eligible.length === 0) return result;

  const ok = await confirm(rewardNotifyDialogMessage(eligible, optedOut), { confirmLabel: 'Send' });
  if (!ok) return null;

  for (const [i, r] of eligible.entries()) {
    const { status } = await sendRewardReadyNotice(r.contact, r.points);
    if (status === 'sent') result.sent += 1;
    else if (status === 'already_sent') result.alreadySent += 1;
    else if (status === 'opted_out') result.optedOut += 1;
    else result.failed += 1;
    if (delayMs > 0 && i < eligible.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return result;
}

export function useRewardReadyNotify(confirm: ConfirmFn) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RewardNotifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await notifyRewardReadyMembers(confirm);
      if (r) setResult(r);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy, confirm]);

  return { busy, result, error, run };
}
