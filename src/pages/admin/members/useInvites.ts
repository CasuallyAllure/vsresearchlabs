/**
 * useInvites — the Invites sub-view data source.
 *
 * Reads admin_member_invites (funnel + list) and admin_invitable_guests
 * (server-side bulk-invite eligibility), both migration 073. The actual send
 * reuses the existing audited send-invite edge function via composeInvite —
 * no new email/invite-logging path. Missing 073 degrades to `unmigrated`.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { composeInvite } from '../CustomerInvite';
import { isMissingBackend } from './backend';

export interface InviteRow {
  id: string;
  email: string;
  customerId: string | null;
  pointsPromised: number;
  channel: string;
  sentIso: string;
  convertedIso: string | null;
  converted: boolean;
  staleDays: number | null;
}

export interface InviteSummary {
  sent: number;
  converted: number;
  outstanding: number;
  conversionPct: number;
}

interface InviteResponse { rows: InviteRow[]; total: number; summary: InviteSummary }

export type InviteFilter = 'all' | 'outstanding' | 'converted';

interface UseInvitesResult {
  rows: InviteRow[];
  total: number;
  summary: InviteSummary | null;
  loading: boolean;
  error: string | null;
  unmigrated: boolean;
  reload: () => void;
}

export function useInvites(filter: InviteFilter): UseInvitesResult {
  const [data, setData] = useState<InviteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); setLoading(false); return; }
      setLoading(true);
      const { data: res, error: rpcError } = await supabase.rpc('admin_member_invites', {
        p_filter: filter, p_limit: 200, p_offset: 0,
      });
      if (cancelled) return;
      if (rpcError) {
        if (isMissingBackend(rpcError)) setUnmigrated(true);
        else setError(rpcError.message);
        setLoading(false);
        return;
      }
      setData(res as InviteResponse);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [filter, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    summary: data?.summary ?? null,
    loading, error, unmigrated, reload,
  };
}

export interface InvitableGuest {
  contact: string;
  displayName: string;
  points: number;
  customerId: string | null;
}

/** Load the server-computed set of invitable guests (points banked, no account,
 *  not invited in the last 7 days). Lazy — only when the bulk flow opens. */
export function useInvitableGuests(enabled: boolean): {
  guests: InvitableGuest[]; total: number; loading: boolean; error: string | null;
} {
  const [guests, setGuests] = useState<InvitableGuest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !supabase) return;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase!.rpc('admin_invitable_guests', { p_limit: 500 });
      if (cancelled) return;
      if (rpcError) { setError(rpcError.message); setLoading(false); return; }
      const payload = data as { rows: InvitableGuest[]; total: number } | null;
      setGuests(payload?.rows ?? []);
      setTotal(payload?.total ?? 0);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [enabled]);

  return { guests, total, loading, error };
}

export type BulkProgress = { sent: number; failed: number; total: number; done: boolean };

/**
 * Send an invite to each guest through the existing send-invite edge function
 * (which emails via Resend AND logs to member_invites). Sequential + throttled
 * so a batch never hammers Resend. Reuses composeInvite — no duplicated copy.
 */
export async function bulkInvite(
  guests: InvitableGuest[],
  onProgress: (p: BulkProgress) => void,
  delayMs = 400,
): Promise<BulkProgress> {
  let sent = 0;
  let failed = 0;
  const total = guests.length;
  for (const g of guests) {
    if (!supabase) { failed += 1; onProgress({ sent, failed, total, done: false }); continue; }
    const { subject, body } = composeInvite({ display_name: g.displayName, contact: g.contact }, g.points);
    const { error } = await supabase.functions.invoke('send-invite', {
      body: { contact: g.contact, subject, body, points: g.points },
    });
    if (error) failed += 1; else sent += 1;
    onProgress({ sent, failed, total, done: false });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  const final = { sent, failed, total, done: true };
  onProgress(final);
  return final;
}
