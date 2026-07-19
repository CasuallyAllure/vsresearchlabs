/**
 * RewardTracker — shared reward-progress + redeem module.
 *
 * Renders progress toward the reward threshold from `get_my_reward_summary()`
 * (migration 050: 300 credit units → 40% reduction on one item, auto-applied to the
 * customer's highest-priced item at their next checkout). Pure presentation
 * over a caller-supplied `RewardSummary` — the caller (AccountRewards,
 * AccountDashboard) owns fetching/loading/error states; this component only
 * owns the redeem interaction: confirm via `useConfirm` (native
 * window.confirm/prompt are forbidden — they silently no-op on iOS) →
 * `redeemReward()` → `onChanged()` so the caller refetches.
 *
 * `compact` renders a smaller variant for the Overview card.
 */

import { useState } from 'react';
import { Button } from '../ui/Button';
import { useConfirm } from '../admin/ConfirmModal';
import { redeemReward, type RewardSummary } from '../../lib/accountData';

interface RewardTrackerProps {
  summary: RewardSummary;
  /** Called after a successful redemption so the caller can refetch the summary. */
  onChanged: () => void;
  compact?: boolean;
}

export function RewardTracker({ summary, onChanged, compact }: RewardTrackerProps) {
  const { balance, threshold, percent, reward_ready, active_voucher } = summary;
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const { confirm, modal } = useConfirm();

  const pointsRemaining = Math.max(threshold - balance, 0);
  const progressPct = threshold > 0 ? Math.min((balance / threshold) * 100, 100) : 100;

  async function handleRedeem() {
    const ok = await confirm(
      `Apply ${threshold.toLocaleString()} credit units as a ${percent}% reduction on one item? This spends the units immediately and can't be undone.`,
      { confirmLabel: 'Apply', cancelLabel: 'Not yet' },
    );
    if (!ok) return;

    setRedeemError(null);
    setRedeeming(true);
    const { data, error } = await redeemReward();
    setRedeeming(false);

    if (error || !data) {
      setRedeemError(error ?? 'Could not redeem right now.');
      return;
    }
    if (!data.ok) {
      setRedeemError(data.reason ?? 'Could not redeem right now.');
      return;
    }
    onChanged();
  }

  return (
    <section
      aria-label="Order credit standing"
      className={`floating-module ${compact ? 'p-[var(--space-5)]' : 'p-[var(--space-6)]'}`}
    >
      {/* Statement header — quiet label, no badge, no accent wash. */}
      <div className="flex items-baseline justify-between gap-[var(--space-3)] border-b border-ink/[0.09] pb-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Order credit</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/30">Account standing</p>
      </div>

      {/* Balance line — the figure is the object, set in tabular mono. */}
      <dl className="divide-y divide-ink/[0.06]">
        <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-4)]">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">Balance</dt>
          <dd
            className={`font-mono font-light tabular-nums text-ink ${compact ? 'text-[1.35rem]' : 'text-[1.7rem]'}`}
          >
            {balance.toLocaleString()}
            <span className="ml-[0.4em] text-[11px] uppercase tracking-[0.16em] text-ink/40">units</span>
          </dd>
        </div>

        {active_voucher ? (
          <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-4)]">
            <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">Credit on file</dt>
            <dd className="font-mono tabular-nums text-[13px] text-ink/75">{active_voucher.percent}%</dd>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-4)]">
            <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
              {reward_ready ? 'Status' : 'To next credit'}
            </dt>
            <dd className="font-mono tabular-nums text-[13px] text-ink/75">
              {reward_ready ? 'Credit available' : `${pointsRemaining.toLocaleString()} units`}
            </dd>
          </div>
        )}
      </dl>

      {active_voucher ? (
        <p className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/55">
          A {active_voucher.percent}% reduction applies to the single highest-priced line on the next order,
          automatically. One-time use. Does not apply to volume orders.
        </p>
      ) : (
        <>
          {/* Accrual against the threshold — a hairline gauge, not a progress toy. */}
          <div
            className="h-px w-full bg-ink/[0.12]"
            role="img"
            aria-label={`${balance.toLocaleString()} of ${threshold.toLocaleString()} units accrued`}
          >
            <div
              className="h-px bg-ink/45 transition-[width] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {!compact && (
            <p className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/55">
              Accrues 1 unit per $1 ordered. At {threshold.toLocaleString()} units the credit applies a{' '}
              {percent}% reduction to one item. Credit does not apply to volume orders.
            </p>
          )}

          {reward_ready && (
            <div className="mt-[var(--space-4)]">
              <Button variant="secondary" size={compact ? 'sm' : 'md'} onClick={handleRedeem} disabled={redeeming}>
                {redeeming ? 'Applying…' : `Apply ${percent}% credit to an item`}
              </Button>
              {redeemError && (
                <p className="mt-[var(--space-2)] text-[12px] text-[color:var(--color-status-error)]">
                  {redeemError}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {modal}
    </section>
  );
}

export default RewardTracker;
