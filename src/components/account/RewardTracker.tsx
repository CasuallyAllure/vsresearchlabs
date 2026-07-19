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
    <div
      className={`floating-module relative overflow-hidden ${compact ? 'p-[var(--space-5)]' : 'p-[var(--space-6)]'}`}
      style={{ boxShadow: 'var(--surface-highlight-strong), var(--elev-2)' }}
    >
      {/* Gold-tinted gloss wash — separates the card off the page; tasteful foil, not neon/glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(120% 100% at 100% 0%, rgb(var(--c-gold) / 0.12) 0%, transparent 55%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent"
      />

      <div className="relative">
        <p className="mb-[var(--space-2)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Order credit balance</p>

        <p className={`font-light tabular-nums text-gold-dark ${compact ? 'text-[1.6rem]' : 'text-[2rem]'}`}>
          {balance.toLocaleString()} <span className="text-[12px] uppercase tracking-[0.16em] text-ink/45">points</span>
        </p>

        {active_voucher ? (
          <p className="mt-[var(--space-4)] text-[13px] leading-relaxed text-ink/80">
            Credit available — a {active_voucher.percent}% reduction on the single highest-priced line, applied
            automatically to the next order. One-time use. Does not apply to volume orders.
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
                ? 'Credit available'
                : `${pointsRemaining.toLocaleString()} to a ${percent}% credit`}
            </p>

            {!compact && (
              <p className="mt-[var(--space-3)] text-[12.5px] leading-relaxed text-ink/60">
                Accrues 1 unit per $1 ordered. At {threshold.toLocaleString()} units the credit applies a{' '}
                {percent}% reduction to one item. Credit does not apply to volume orders.
              </p>
            )}

            {reward_ready && (
              <div className="mt-[var(--space-4)]">
                <Button variant="primary" size={compact ? 'sm' : 'md'} onClick={handleRedeem} disabled={redeeming}>
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
      </div>

      {modal}
    </div>
  );
}

export default RewardTracker;
