/**
 * AccountRewards — /account/rewards
 *
 * Reward point balance + full ledger, via `get_my_reward_summary()`
 * (`src/lib/accountData.ts`). Append-only ledger — this view is read-only;
 * points are earned/reversed/adjusted entirely server-side.
 */

import { Link } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { getMyRewardSummary, type RewardEntryKind } from '../../lib/accountData';
import { useAccountSession } from '../../lib/accountSession';
import { rewardsCacheKey, useAccountQuery } from '../../lib/accountQueryCache';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';
import { StaleDataNotice } from '../../components/system/StaleDataNotice';
import { RewardTracker } from '../../components/account/RewardTracker';
import { ReferralCard } from '../../components/account/ReferralCard';

const KIND_LABEL: Record<RewardEntryKind, string> = {
  earn: 'Earned',
  reversal: 'Reversed',
  adjustment: 'Adjustment',
  redemption: 'Redeemed',
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
  const { user } = useAccountSession();
  const key = user ? rewardsCacheKey(user.id) : null;
  const { data, error, loading, refresh } = useAccountQuery(key, getMyRewardSummary);

  if (loading) {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your rewards…</p>;
  }
  // `data === null`: never successfully loaded — a full failure state.
  // `data` present alongside `error`: a background refresh (or a failed
  // `refresh()` after redeeming) failed AFTER a successful load — keep
  // showing the last-known balance/ledger (accountQueryCache.ts's
  // revalidation-failure contract).
  if (!data) {
    return <ErrorState message={error ?? 'Rewards are unavailable right now.'} />;
  }

  const { entries } = data;

  return (
    <>
      {error && <StaleDataNotice subject="your rewards" />}
      <div className="mb-[var(--space-6)]">
        <RewardTracker summary={data} onChanged={refresh} />
      </div>

      <div className="mb-[var(--space-6)]">
        <ReferralCard />
      </div>

      <h2 className="mb-[var(--space-3)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Statement</h2>

      {entries.length === 0 ? (
        <EmptyState label="No credit activity yet." meta="Units post automatically once a paid order is on file." />
      ) : (
        /* Ledger, not a feed: one module, hairline-ruled rows, quiet labels,
           and signed tabular figures. No status pills, no colour coding —
           the sign carries the direction. */
        <ul className="floating-module divide-y divide-ink/[0.06] px-[var(--space-4)]">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-4)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-ink/45">
                    {KIND_LABEL[e.kind]}
                  </span>
                  {e.order_number && (
                    <Link
                      to={`/account/orders/${encodeURIComponent(e.order_number)}`}
                      className="truncate font-mono text-[11px] tabular-nums text-ink/60 underline decoration-ink/20 underline-offset-2 transition-colors hover:text-ink"
                    >
                      {e.order_number}
                    </Link>
                  )}
                </div>
                {e.note && <p className="mt-1 truncate text-[12px] text-ink/55">{e.note}</p>}
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/35">
                  {formatDate(e.created_at)}
                </p>
              </div>
              <p
                className={`shrink-0 font-mono text-[14px] tabular-nums ${
                  e.points >= 0 ? 'text-ink/80' : 'text-ink/45'
                }`}
              >
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
