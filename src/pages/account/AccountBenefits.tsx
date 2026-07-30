/**
 * AccountBenefits — /account/benefits
 *
 * The customer's active lifetime/business discount rules (RLS select on
 * `customer_discounts`, own rows only) plus a plain-English explainer of how
 * discounts stack at checkout (mirrors the server's compounding model:
 * free items + fixed codes first, then account discount, then coupon
 * percents — shipping never discounted).
 */

import { useEffect, useState } from 'react';
import { AccountLayout } from './AccountLayout';
import { useAccountSession } from '../../lib/accountSession';
import { listMyDiscounts, type CustomerDiscountRow } from '../../lib/accountData';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';
import { MemberOfferCard } from '../../components/account/MemberOfferCard';
import { MEMBER_OFFERS } from '../../config/memberOffers';
import { TIER_BENEFITS } from '../../config/tierBenefits';
import type { CustomerTier } from '../../lib/customerProfile';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; discounts: CustomerDiscountRow[] };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const SCOPE_LABEL: Record<CustomerDiscountRow['scope'], string> = {
  lifetime: 'Lifetime discount',
  business: 'Business discount',
};

function DiscountCard({ discount: d }: { discount: CustomerDiscountRow }) {
  const expires = formatDate(d.expires_at);
  const starts = formatDate(d.starts_at);
  return (
    <article className="research-surface-solid p-[var(--space-5)]">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45">{SCOPE_LABEL[d.scope]}</p>
          <p className="mt-1 text-[15px] text-ink">{d.label}</p>
          {(starts || expires) && (
            <p className="mt-1 font-mono text-[11px] tabular-nums text-ink/40">
              {starts ? `From ${starts}` : ''}
              {starts && expires ? ' · ' : ''}
              {expires ? `Expires ${expires}` : ''}
            </p>
          )}
        </div>
        <p className="shrink-0 font-mono text-[1.4rem] font-light tabular-nums text-ink">{d.percent}%</p>
      </div>
    </article>
  );
}

function HowDiscountsApply() {
  return (
    <article className="research-surface-solid p-[var(--space-5)]">
      <p className="mb-[var(--space-3)] text-[11px] uppercase tracking-[0.22em] text-ink/45">How discounts apply</p>
      <ol className="list-decimal space-y-[var(--space-2)] pl-[var(--space-5)] text-[13px] leading-relaxed text-ink/75">
        <li>
          <strong className="text-ink">Free items and fixed-amount codes first.</strong> A free-item
          code zeroes its matching item; dollar-off codes reduce the merchandise subtotal.
        </li>
        <li>
          <strong className="text-ink">Your account discount next.</strong> The better of your
          lifetime or business discount (they don't stack with each other) applies to what remains.
        </li>
        <li>
          <strong className="text-ink">Coupon-code percentages last.</strong> Percent codes apply to
          that same remainder.
        </li>
      </ol>
      <p className="mt-[var(--space-3)] text-[12px] text-ink/55">
        Shipping is never discounted. Every discount is itemized on your invoice.
      </p>
    </article>
  );
}

/** Standing terms of the customer's tier — driven by src/config/tierBenefits.ts. */
function TierBenefitsCard({ tier }: { tier: CustomerTier }) {
  const { label, benefits } = TIER_BENEFITS[tier];
  return (
    <article className="research-surface-solid p-[var(--space-5)]">
      <div className="mb-[var(--space-3)] flex items-baseline justify-between gap-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Membership</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/30">{label}</p>
      </div>
      <ul className="space-y-[var(--space-2)]">
        {benefits.map((benefit) => (
          <li key={benefit} className="text-[13px] leading-relaxed text-ink/75">
            {benefit}
          </li>
        ))}
      </ul>
    </article>
  );
}

function MemberPerksNote() {
  // Every signed-in member ships free (src/lib/shipping.ts — membership alone
  // is the gate; the 049 free_shipping column is an admin belt-and-braces
  // extra, NOT the condition). This page only renders for members, so the
  // line is unconditional — keying it on the 049 flag hid the perk from
  // nearly every member (release-audit bug).
  return (
    <article className="research-surface-solid p-[var(--space-5)]">
      <p className="mb-[var(--space-2)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Member perks</p>
      <p className="text-[13px] leading-relaxed text-ink/75">
        Free shipping is active on your account — it applies automatically at
        checkout. Some promo codes are also member-only and require you to be
        signed in to redeem.
      </p>
    </article>
  );
}

function AccountBenefitsContent() {
  const { profile } = useAccountSession();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await listMyDiscounts();
      if (cancelled) return;
      if (error) {
        setState({ kind: 'error', message: error });
        return;
      }
      setState({ kind: 'ok', discounts: data.filter((d) => d.active) });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your benefits…</p>;
  }
  if (state.kind === 'error') {
    return <ErrorState message={state.message} />;
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <TierBenefitsCard tier={profile?.tier ?? 'member'} />
      {/* The standing 15% offer card is the base-member term — a Pro's tier
          card already states their 20% rate, so showing both contradicted
          itself on one screen (release audit). */}
      {profile?.tier !== 'pro' && MEMBER_OFFERS.map((offer) => (
        <MemberOfferCard key={offer.code} offer={offer} />
      ))}
      {state.discounts.length === 0 ? (
        MEMBER_OFFERS.length === 0 && (
          <EmptyState
            label="No account discounts on file."
            meta="Lifetime and business discounts are set up by our team — they apply automatically at checkout once active."
            className="py-[var(--space-8)]"
          />
        )
      ) : (
        state.discounts.map((d) => <DiscountCard key={d.id} discount={d} />)
      )}
      <MemberPerksNote />
      <HowDiscountsApply />
    </div>
  );
}

export function AccountBenefits() {
  return (
    <AccountLayout>
      <AccountBenefitsContent />
    </AccountLayout>
  );
}

export default AccountBenefits;
