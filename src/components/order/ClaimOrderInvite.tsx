/**
 * ClaimOrderInvite — the membership offer on a buyer's order link.
 *
 * WHERE IT APPEARS. On `/track?t=<token>`, above the invoice, for an order that
 * is still an open unpaid invoice. That link is what the owner texts to a buyer
 * who walked in with no email on file (085), so this is often the first page
 * that buyer ever sees from us — and the only moment before they pay when
 * joining still changes what they pay.
 *
 * IT DOES NOT PROMISE WHAT IT CANNOT DELIVER. Signed out, it states the offer
 * and sends them to create an account. Signed in, it does the thing:
 * `claim_order_with_account` (086) attaches this order to their account and
 * applies their real rate from effective_customer_discount — the same rate
 * checkout would give them. The result is reported literally, including the
 * case where the order attached but was NOT re-priced because it is already
 * paid or closed, because "you saved 15%" is the one thing this card must never
 * say falsely.
 *
 * THE PERCENT IS NOT HARD-CODED. It reads MEMBER_DISCOUNT_PERCENT, the same
 * constant the catalog's member chip advertises, so the offer here and the
 * offer on a product card can never drift apart.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { MEMBER_DISCOUNT_PERCENT } from '../../lib/memberPricing';

interface ClaimOrderInviteProps {
  token: string;
  /** Whether a customer session is active — decides offer vs. action. */
  signedIn: boolean;
  /** Re-fetch the invoice after a successful re-price so the totals shown
   *  are the ones the buyer will actually pay. */
  onClaimed: () => void;
}

type ClaimState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; repriced: boolean; percent: number | null }
  | { kind: 'failed'; message: string };

/** Reasons the RPC can return, in the buyer's language. */
function refusalCopy(reason: string): string {
  switch (reason) {
    case 'already_claimed':
      return 'This order is already attached to another account.';
    case 'not_signed_in':
      return 'Please sign in again, then try once more.';
    case 'not_found':
      return 'This order link is no longer valid.';
    default:
      return 'That did not go through. Please try again.';
  }
}

export function ClaimOrderInvite({ token, signedIn, onClaimed }: ClaimOrderInviteProps) {
  const [state, setState] = useState<ClaimState>({ kind: 'idle' });

  async function claim() {
    if (!supabase) {
      setState({ kind: 'failed', message: 'Accounts are temporarily unavailable.' });
      return;
    }
    setState({ kind: 'working' });
    const { data, error } = await supabase.rpc('claim_order_with_account', { p_token: token });
    if (error) {
      setState({ kind: 'failed', message: error.message });
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; reason?: string; repriced?: boolean; percent?: number | null };
    if (!res.ok) {
      setState({ kind: 'failed', message: refusalCopy(res.reason ?? '') });
      return;
    }
    setState({ kind: 'done', repriced: Boolean(res.repriced), percent: res.percent ?? null });
    onClaimed();
  }

  if (state.kind === 'done') {
    return (
      <div className="mb-[var(--space-4)] rounded-[var(--radius-procurement)] border border-holo/30 bg-holo/[0.07] p-[var(--space-4)]">
        <p className="text-[13px] font-light text-ink">
          {state.repriced && state.percent != null
            ? `Order added to your account — ${state.percent}% applied.`
            : 'Order added to your account.'}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink/65">
          {state.repriced
            ? 'The totals below are updated. It will also show up under your orders.'
            : 'This order was already settled, so its total is unchanged. Your rate applies to your next one.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-[var(--space-4)] rounded-[var(--radius-procurement)] border border-gold/30 bg-gold/[0.06] p-[var(--space-4)]">
      <p className="text-[10px] uppercase tracking-[0.24em] text-gold/80">Before you pay</p>
      <p className="mt-[var(--space-2)] text-[13px] font-light leading-relaxed text-ink">
        Create an account and this order re-prices at the member rate.
      </p>
      <ul className="mt-[var(--space-2)] space-y-1 text-[12px] leading-relaxed text-ink/70">
        <li>· {MEMBER_DISCOUNT_PERCENT}% off automatically, on this order and every one after</li>
        <li>· Free shipping on member orders</li>
        <li>· Points on everything you order, which convert into further discounts</li>
      </ul>

      {state.kind === 'failed' && (
        <p role="alert" className="mt-[var(--space-3)] text-[12px] text-[color:var(--color-status-error)]">
          {state.message}
        </p>
      )}

      <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)]">
        {signedIn ? (
          <button
            type="button"
            onClick={() => void claim()}
            disabled={state.kind === 'working'}
            className="rounded-full border border-gold/50 bg-gold/15 px-[var(--space-4)] py-[var(--space-2)] text-[11px] uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold/80 disabled:opacity-50"
          >
            {state.kind === 'working' ? 'Adding…' : 'Add to my account'}
          </button>
        ) : (
          <Link
            to={`/account?next=${encodeURIComponent(`/track?t=${token}`)}`}
            className="rounded-full border border-gold/50 bg-gold/15 px-[var(--space-4)] py-[var(--space-2)] text-[11px] uppercase tracking-[0.16em] text-gold transition-colors hover:border-gold/80"
          >
            Create an account
          </Link>
        )}
        <span className="text-[11px] text-ink/45">
          {signedIn ? 'Applies your account rate to this order.' : 'Takes a minute. Come back to this link after.'}
        </span>
      </div>
    </div>
  );
}
