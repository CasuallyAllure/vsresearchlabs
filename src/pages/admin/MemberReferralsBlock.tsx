/**
 * MemberReferralsBlock — compact member-referral summary for the AdminCoupons
 * Affiliates tab (migration 076).
 *
 * Member referral codes ARE affiliate-linked coupons, so the affiliate rows
 * themselves already appear in the list above; this block adds the member-side
 * rollup the raw rows can't show — who each code belongs to and its recorded
 * uses (self-use excluded server-side). Read-only over admin_member_referrals;
 * a stack without 076 applied degrades to a calm note (isMissingBackend
 * posture, same as the Members sub-views).
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, isMissingBackend } from './members/backend';

interface ReferralRow {
  memberName: string | null;
  contact: string | null;
  code: string;
  uses: number;
  createdIso: string;
}

interface ReferralSummary {
  codesIssued: number;
  totalUses: number;
}

interface ReferralResponse {
  rows: ReferralRow[];
  total: number;
  summary: ReferralSummary;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'unmigrated' }
  | { kind: 'ok'; data: ReferralResponse };

const PAGE_LIMIT = 50;

export function MemberReferralsBlock() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setState({ kind: 'error', message: 'Backend not configured.' });
        return;
      }
      const { data, error } = await supabase.rpc('admin_member_referrals', {
        p_limit: PAGE_LIMIT,
        p_offset: 0,
      });
      if (cancelled) return;
      if (error) {
        setState(isMissingBackend(error) ? { kind: 'unmigrated' } : { kind: 'error', message: getErrorMessage(error) });
        return;
      }
      setState({ kind: 'ok', data: data as ReferralResponse });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'unmigrated') return null; // pre-076 stack: nothing to show

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <div className="mb-[var(--space-3)] flex items-baseline justify-between gap-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink/45">Member referrals</p>
        {state.kind === 'ok' && (
          <p className="font-mono text-[10.5px] tabular-nums text-ink/45">
            {state.data.summary.codesIssued} code{state.data.summary.codesIssued === 1 ? '' : 's'} issued
            {' · '}{state.data.summary.totalUses} recorded use{state.data.summary.totalUses === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {state.kind === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-[12px] text-red-400">{state.message}</p>
      )}

      {state.kind === 'ok' && state.data.rows.length === 0 && (
        <p className="text-[13px] text-ink/55">No member referral codes issued yet.</p>
      )}

      {state.kind === 'ok' && state.data.rows.length > 0 && (
        <ul className="divide-y divide-ink/[0.04]">
          {state.data.rows.map((row) => (
            <li key={row.code} className="flex flex-wrap items-baseline gap-x-[var(--space-4)] gap-y-1 py-[var(--space-3)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{row.memberName ?? row.contact ?? '—'}</span>
                {row.contact && <span className="block truncate font-mono text-[10.5px] text-ink/45">{row.contact}</span>}
              </span>
              <span className="font-mono text-[11.5px] tracking-[0.04em] text-ink/80">{row.code}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink/45">
                {row.uses} use{row.uses === 1 ? '' : 's'} · {row.createdIso}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MemberReferralsBlock;
