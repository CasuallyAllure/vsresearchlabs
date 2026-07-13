/**
 * AccountRewards — /account/rewards
 *
 * Reward point balance + full ledger, via `get_my_reward_summary()`
 * (`src/lib/accountData.ts`). Append-only ledger — this view is read-only;
 * points are earned/reversed/adjusted entirely server-side.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { getMyRewardSummary, type RewardEntryKind, type RewardSummary } from '../../lib/accountData';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';
import { RewardTracker } from '../../components/account/RewardTracker';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; summary: RewardSummary };

const KIND_LABEL: Record<RewardEntryKind, string> = {
  earn: 'Earned',
  reversal: 'Reversed',
  adjustment: 'Adjustment',
  redemption: 'Redeemed',
};

const KIND_CLASS: Record<RewardEntryKind, string> = {
  earn: 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]',
  reversal: 'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]',
  adjustment: 'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]',
  redemption: 'border-ink/10 text-[color:var(--color-status-info)] bg-[color:var(--color-status-infoMuted)]',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatPoints(points: number): string {
  const sign = points > 0 ? '+' : '';
  return `${sign}${points.toLocaleString()}`;
}

function AccountRewardsContent() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  async function reload() {
    const { data, error } = await getMyRewardSummary();
    if (error || !data) {
      setState({ kind: 'error', message: error ?? 'Rewards are unavailable right now.' });
      return;
    }
    setState({ kind: 'ok', summary: data });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await getMyRewardSummary();
      if (cancelled) return;
      if (error || !data) {
        setState({ kind: 'error', message: error ?? 'Rewards are unavailable right now.' });
        return;
      }
      setState({ kind: 'ok', summary: data });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your rewards…</p>;
  }
  if (state.kind === 'error') {
    return <ErrorState message={state.message} />;
  }

  const { entries } = state.summary;

  return (
    <>
      <div className="mb-[var(--space-6)]">
        <RewardTracker summary={state.summary} onChanged={reload} />
      </div>

      <h2 className="mb-[var(--space-3)] text-[11px] uppercase tracking-[0.22em] text-ink/45">History</h2>

      {entries.length === 0 ? (
        <EmptyState label="No reward activity yet." meta="Points post automatically once a paid order is on file." />
      ) : (
        <ul className="space-y-[var(--space-3)]">
          {entries.map((e) => (
            <li key={e.id} className="research-surface-solid p-[var(--space-4)] flex items-center justify-between gap-[var(--space-4)]">
              <div className="min-w-0">
                <div className="flex items-center gap-[var(--space-2)]">
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${KIND_CLASS[e.kind]}`}>
                    {KIND_LABEL[e.kind]}
                  </span>
                  {e.order_number && (
                    <Link
                      to={`/account/orders/${encodeURIComponent(e.order_number)}`}
                      className="truncate font-mono text-[11px] text-teal hover:text-teal-dark transition-colors"
                    >
                      {e.order_number}
                    </Link>
                  )}
                </div>
                {e.note && <p className="mt-1 truncate text-[12px] text-ink/60">{e.note}</p>}
                <p className="mt-0.5 text-[11px] text-ink/40">{formatDate(e.created_at)}</p>
              </div>
              <p className={`shrink-0 font-mono text-[15px] tabular-nums ${e.points >= 0 ? 'text-[color:var(--color-status-success)]' : 'text-[color:var(--color-status-error)]'}`}>
                {formatPoints(e.points)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function AccountRewards() {
  return (
    <AccountLayout>
      <AccountRewardsContent />
    </AccountLayout>
  );
}

export default AccountRewards;
