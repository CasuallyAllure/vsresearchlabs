/**
 * rewardNotify — the ONE "your reward credit is available" mail, sent through
 * send-member-offer's single-recipient mode with kind 'reward_ready' and the
 * 'rr-<stage>' period key the reward_ready cron uses (091). Shared by
 * RewardsPanel's "Notify member" and the Needs-attention queue's bulk notify,
 * so both surfaces send byte-for-byte the same email against the same
 * email_log claim — a second press (or the cron) reports already_sent.
 *
 * The offer is 40% off ONE ITEM (050/052), never off the order.
 */

import { supabase } from '../../../lib/supabase';
import { getErrorMessage, rewardCampaignKey } from './shared';

/** 050's redemption terms, mirrored by admin_redeem_reward_for (092). */
export const REWARD_THRESHOLD = 300;
export const REWARD_PERCENT = 40;

export const REWARD_READY_SUBJECT = 'Your reward credit is available';

export function rewardReadyBody(balance: number): string {
  return [
    'Hello,',
    '',
    `Your VS Research Labs account holds ${balance.toLocaleString()} reward points, which meets the ` +
      `${REWARD_THRESHOLD}-point redemption threshold — enough for ${REWARD_PERCENT}% off one catalog item ` +
      '(laboratory equipment excluded).',
    'A reward credit can be redeemed from your account portal whenever you choose.',
    '',
    'Thank you,',
    'VS Research Labs',
  ].join('\n');
}

export type NoticeStatus = 'sent' | 'already_sent' | 'opted_out' | 'failed';

export interface NoticeResult {
  status: NoticeStatus;
  error?: string;
}

/** Mail one member. Never throws — a failure is a status, so a batch keeps going. */
export async function sendRewardReadyNotice(contact: string, balance: number): Promise<NoticeResult> {
  if (!supabase) return { status: 'failed', error: 'Backend not configured.' };
  const { data, error } = await supabase.functions.invoke('send-member-offer', {
    body: {
      // automation_candidates emits the raw auth.users.email (091) as the
      // reward_ready recipient; normalizing here matches what send-member-
      // offer itself normalizes contact to, so the two claims land on the
      // same email_log row instead of two differently-cased ones.
      contact: contact.trim().toLowerCase(),
      subject: REWARD_READY_SUBJECT,
      body: rewardReadyBody(balance),
      campaign_key: rewardCampaignKey(balance),
      kind: 'reward_ready',
      offer: null,
    },
  });
  if (error) return { status: 'failed', error: getErrorMessage(error) };
  const status = (data as { status?: string } | null)?.status;
  if (status === 'already_sent' || status === 'opted_out') return { status };
  return { status: 'sent' };
}
