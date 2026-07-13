/**
 * RewardTracker — shared reward-progress + redeem module.
 *
 * Renders progress toward the reward threshold from `get_my_reward_summary()`
 * (migration 050: 300 points → 40% off one item, auto-applied to the
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
      `Redeem ${threshold.toLocaleString()} points for ${percent}% off one item? This spends the points immediately and can't be undone.`,
      { confirmLabel: 'Redeem', cancelLabel: 'Not yet' },
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
    <div className={`floating-module ${compact ? 'p-[var(--space-5)]' : 'p-[var(--space-6)]'}`}>
      <p className="mb-[var(--space-2)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Reward balance</p>

      <p className={`font-light tabular-nums text-ink ${compact ? 'text-[1.6rem]' : 'text-[2rem]'}`}>
        {balance.toLocaleString()} <span className="text-[12px] uppercase tracking-[0.16em] text-ink/45">points</span>
      </p>

      {active_voucher ? (
        <p className="mt-[var(--space-4)] text-[13px] leading-relaxed text-ink/80">
          Reward ready to use — your {active_voucher.percent}% off applies to your highest-priced item at your next
          checkout.
        </p>
      ) : (
        <>
          <div className="mt-[var(--space-4)] h-[6px] rounded-full bg-ink/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-ink/70 transition-[width] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-[var(--space-2)] text-[11px] text-ink/50">
            {reward_ready
              ? 'Reward ready'
              : `${pointsRemaining.toLocaleString()} points to your ${percent}%-off reward`}
          </p>

          {!compact && (
            <p className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/60">
              Earn 1 point per $1. At {threshold.toLocaleString()} points, redeem {percent}% off any one item.
            </p>
          )}

          {reward_ready && (
            <div className="mt-[var(--space-4)]">
              <Button variant="primary" size={compact ? 'sm' : 'md'} onClick={handleRedeem} disabled={redeeming}>
                {redeeming ? 'Redeeming…' : `Redeem ${percent}% off an item`}
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
    </div>
  );
}

export default RewardTracker;
