/**
 * RewardsPanel — reward_ledger balance + recent entries, with manual
 * credit/debit via admin_adjust_reward_points (044). A note is mandatory and
 * the RPC appends an audit-logged ledger row; balances are never mutated in
 * place.
 *
 * A balance at or over the 300-point threshold also gets a REDEEM action
 * (admin_redeem_reward_for, 092): the admin-side twin of the button the member
 * has in their own portal. Before it existed, a member sitting on a ready
 * balance was something the admin could see and not resolve.
 *
 * Shared by the customer-detail page and the /admin/members rows. Pure
 * extraction from the original CustomerAccountPanels — behaviour unchanged.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { InlineError, InlineSuccess, Label, MutedNote, PanelCaption, SubmitButton } from './atoms';
import {
  NOT_MIGRATED_NOTE, RECENT_REWARD_ENTRIES, fmtDateShort, fmtSignedPoints, inputCls, isMissingBackend,
  type ConfirmFn, type RewardEntry,
} from './shared';

/** 050's redemption terms, mirrored by admin_redeem_reward_for (092). */
const REWARD_THRESHOLD = 300;
const REWARD_PERCENT = 40;

interface RewardsPanelProps {
  userId: string;
  confirm: ConfirmFn;
}

export function RewardsPanel({ userId, confirm }: RewardsPanelProps) {
  const [entries, setEntries] = useState<RewardEntry[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unmigrated' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const [pointsDraft, setPointsDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setLoadState('error');
        setLoadError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('reward_ledger')
        .select('kind, points, note, created_at, order_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        if (isMissingBackend(error)) setLoadState('unmigrated');
        else {
          setLoadState('error');
          setLoadError(error.message);
        }
        return;
      }
      setEntries((data ?? []) as RewardEntry[]);
      setLoadState('ready');
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshCounter]);

  const balance = (entries ?? []).reduce((sum, e) => sum + e.points, 0);
  const recent = (entries ?? []).slice(0, RECENT_REWARD_ENTRIES);

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !supabase) return;
    setFormError(null);
    setFormSuccess(null);

    const points = Number(pointsDraft);
    if (!Number.isInteger(points) || points === 0) {
      setFormError('Points must be a non-zero whole number (negative to debit).');
      return;
    }
    const note = noteDraft.trim();
    if (note === '') {
      setFormError('A note is required for manual adjustments.');
      return;
    }

    const ok = await confirm(
      `Adjust reward balance by ${fmtSignedPoints(points)} points? Note: "${note}"`,
      { confirmLabel: 'Adjust points' },
    );
    if (!ok) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_adjust_reward_points', {
      p_user_id: userId,
      p_points: points,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setFormError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    setPointsDraft('');
    setNoteDraft('');
    setFormSuccess('Adjustment recorded.');
    setRefreshCounter((c) => c + 1);
  }

  async function handleRedeem() {
    if (busy || !supabase) return;
    setFormError(null);
    setFormSuccess(null);

    const note = noteDraft.trim();
    if (note === '') {
      setFormError('A note is required — redeeming spends the member\u2019s points for them.');
      return;
    }

    const ok = await confirm(
      `Spend ${REWARD_THRESHOLD} of this member\u2019s points for a ${REWARD_PERCENT}% off one item voucher? Note: "${note}"`,
      { confirmLabel: 'Redeem for member' },
    );
    if (!ok) return;

    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('admin_redeem_reward_for', {
      p_user_id: userId,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setFormError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    // The RPC refuses in-band (already holds a voucher, balance moved under
    // us) rather than throwing — surface its reason instead of claiming success.
    const result = data as { ok?: boolean; reason?: string } | null;
    if (!result?.ok) {
      setFormError(result?.reason ?? 'Could not redeem this balance.');
      return;
    }
    setNoteDraft('');
    setFormSuccess(`Voucher issued — ${REWARD_PERCENT}% off one item.`);
    setRefreshCounter((c) => c + 1);
  }

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <PanelCaption>Rewards</PanelCaption>

      {loadState === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}
      {loadState === 'unmigrated' && <MutedNote>{NOT_MIGRATED_NOTE}</MutedNote>}
      {loadState === 'error' && loadError && <InlineError>{loadError}</InlineError>}

      {loadState === 'ready' && entries && (
        <>
          <div className="mb-[var(--space-4)]">
            <p className="text-[10px] uppercase tracking-[0.2em] text-ink/40 mb-1">Balance</p>
            <p className="font-mono text-[18px] tabular-nums text-ink">{balance} pts</p>
            {balance >= REWARD_THRESHOLD && (
              <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-3)]">
                <span className="text-[11.5px] text-holo">
                  Ready to redeem — {REWARD_THRESHOLD} pts buys {REWARD_PERCENT}% off one item.
                </span>
                <button
                  type="button"
                  onClick={handleRedeem}
                  disabled={busy}
                  className="rounded-full border border-holo/35 px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-holo transition-colors hover:border-holo/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? 'Working…' : 'Redeem for member'}
                </button>
              </div>
            )}
          </div>

          {recent.length === 0 ? (
            <MutedNote>No reward activity yet.</MutedNote>
          ) : (
            <ul className="mb-[var(--space-4)] divide-y divide-ink/[0.04] border-y border-ink/[0.06]">
              {recent.map((entry, i) => (
                <li key={`${entry.created_at}-${i}`} className="py-[var(--space-2)] flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-0.5">
                  <span className={`font-mono text-[12px] tabular-nums w-[52px] shrink-0 ${entry.points > 0 ? 'text-[color:var(--color-status-success)]' : 'text-red-400/80'}`}>
                    {fmtSignedPoints(entry.points)}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45 w-[80px] shrink-0">{entry.kind}</span>
                  <span className="font-mono text-[10.5px] text-ink/40 tabular-nums shrink-0">{fmtDateShort(entry.created_at)}</span>
                  {entry.note && <span className="min-w-0 w-full text-[11.5px] text-ink/60 sm:w-auto sm:flex-1">{entry.note}</span>}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdjust}>
            <div className="grid grid-cols-1 gap-x-[var(--space-3)] sm:grid-cols-[140px_1fr]">
              <div>
                <Label>Points (±)</Label>
                <input
                  type="number"
                  step="1"
                  value={pointsDraft}
                  onChange={(e) => setPointsDraft(e.target.value)}
                  placeholder="-25"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Note (required)</Label>
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Goodwill credit for shipping delay"
                  className={inputCls}
                />
              </div>
            </div>

            {formError && <InlineError>{formError}</InlineError>}
            {formSuccess && <InlineSuccess>{formSuccess}</InlineSuccess>}

            <div className="flex items-center justify-end">
              <SubmitButton disabled={busy}>{busy ? 'Adjusting…' : 'Adjust points'}</SubmitButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
