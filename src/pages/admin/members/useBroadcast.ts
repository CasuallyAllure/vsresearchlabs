/**
 * useBroadcast — the data layer behind Members → Broadcast.
 *
 * Recipients are resolved SERVER-side by admin_campaign_recipients (088), which
 * is where marketing consent is enforced: an opted-out member is never in the
 * list, so the count the owner reads is the count that will be mailed. The
 * client only ever narrows that list (unticking a row); it cannot add to it.
 *
 * Sending reuses the bulk-invite shape already proven here (useInvites.
 * bulkInvite): one throttled request per recipient to an admin-gated edge
 * function, so a long campaign is retryable rather than one request that can
 * time out halfway. The send-member-offer function claims each recipient in
 * email_log (075) before mailing, so a second run over the same campaign key
 * reports `already_sent` instead of mailing twice.
 *
 * The offer is an EXISTING coupon (031/058) — this module reads the active
 * percent codes so the composer can quote one; it never creates one.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { MEMBER_DISCOUNT_PERCENT, TIER_FLOOR_PERCENTS } from '../../../lib/memberPricing';
import type { Segment, Tier } from '../membersView';
import type { RosterSegment } from '../useMembersData';
import { getErrorMessage, isMissingBackend } from './backend';

export interface CampaignRecipient {
  userId: string | null;
  name: string | null;
  contact: string;
  segment: Segment;
  vip: boolean;
  tier: Tier;
  joinedIso: string;
  optOut: boolean;
}

/** An active percent coupon, as the composer quotes it. */
export interface OfferCoupon {
  code: string;
  percent: number;
  /** YYYY-MM-DD, or null when the code has no expiry. */
  expiresOn: string | null;
  oncePerContact: boolean;
}

export interface CampaignOffer {
  code: string;
  percent: number;
  expiresOn: string | null;
}

export interface SendProgress {
  sent: number;
  /** Already covered by this campaign key on an earlier run. */
  skipped: number;
  optedOut: number;
  failed: number;
  total: number;
  done: boolean;
}

/**
 * What a member actually pays with this code: coupon percents and the
 * automatic account rate are two slices off the SAME base in place-order
 * (orderTotals pass 2a/2b), so they ADD. A 15% code lands a standard member
 * at 30% — that combined figure is what the campaign should advertise, and
 * what this returns. Pro accounts carry a higher floor (20%), so they land
 * ABOVE the advertised number, never below it.
 */
export function advertisedPercent(codePercent: number): number {
  return Math.min(100, codePercent + MEMBER_DISCOUNT_PERCENT);
}

/** The account rate a tier gets automatically, for the composer's warning. */
export function tierFloorPercent(tier: Tier): number {
  return TIER_FLOOR_PERCENTS[tier] ?? MEMBER_DISCOUNT_PERCENT;
}

/** The members a campaign would reach under the current filter. */
export function useCampaignRecipients(segment: RosterSegment, search: string) {
  const [rows, setRows] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('admin_campaign_recipients', {
        p_segment: segment,
        p_search: search || undefined,
      });
      if (cancelled) return;
      if (rpcError) {
        if (isMissingBackend(rpcError)) setUnmigrated(true);
        else setError(getErrorMessage(rpcError));
        setRows([]);
        setLoading(false);
        return;
      }
      const payload = data as unknown as { rows: CampaignRecipient[] } | null;
      setRows(payload?.rows ?? []);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [segment, search]);

  return { rows, loading, error, unmigrated };
}

/** Active percent coupons — the codes a campaign can quote. */
export function usePercentCoupons() {
  const [coupons, setCoupons] = useState<OfferCoupon[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) return;
      const { data } = await supabase
        .from('coupons')
        .select('code, percent, expires_at, once_per_contact')
        .eq('active', true)
        .eq('kind', 'percent')
        .order('code');
      if (cancelled || !data) return;
      setCoupons(
        data
          .filter((c): c is typeof c & { percent: number } => c.percent != null)
          .map((c) => ({
            code: c.code,
            percent: c.percent,
            expiresOn: c.expires_at ? c.expires_at.slice(0, 10) : null,
            oncePerContact: c.once_per_contact,
          })),
      );
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return coupons;
}

/**
 * Mail each recipient through the admin-gated send-member-offer function.
 * Sequential + throttled so a batch never hammers Resend — the same discipline
 * bulk invites use.
 */
export async function sendCampaign(
  recipients: CampaignRecipient[],
  campaign: { subject: string; body: string; campaignKey: string; offer: CampaignOffer | null },
  onProgress: (p: SendProgress) => void,
  delayMs = 400,
): Promise<SendProgress> {
  const progress: SendProgress = {
    sent: 0, skipped: 0, optedOut: 0, failed: 0, total: recipients.length, done: false,
  };

  for (const r of recipients) {
    if (!supabase) {
      progress.failed += 1;
      onProgress({ ...progress });
      continue;
    }
    const { data, error } = await supabase.functions.invoke('send-member-offer', {
      body: {
        contact: r.contact,
        subject: campaign.subject,
        body: campaign.body,
        campaign_key: campaign.campaignKey,
        offer: campaign.offer
          ? { code: campaign.offer.code, percent: campaign.offer.percent, expires_on: campaign.offer.expiresOn }
          : null,
      },
    });
    const status = (data as { status?: string } | null)?.status;
    if (error) progress.failed += 1;
    else if (status === 'already_sent') progress.skipped += 1;
    else if (status === 'opted_out') progress.optedOut += 1;
    else progress.sent += 1;
    onProgress({ ...progress });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  progress.done = true;
  onProgress({ ...progress });
  return progress;
}

/** `member30-2026-08-24` — stable per code per day, so an accidental second
 *  run of the same campaign is caught by email_log instead of re-mailing. */
export function defaultCampaignKey(code: string | null, today = new Date()): string {
  const slug = (code ?? 'note').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'note';
  const day = today.toISOString().slice(0, 10);
  return `${slug}-${day}`;
}
