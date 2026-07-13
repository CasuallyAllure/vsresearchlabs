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
import { useCustomerAuth } from '../../lib/customerAuth';
import { listMyDiscounts, type CustomerDiscountRow } from '../../lib/accountData';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';

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
            <p className="mt-1 text-[11px] text-ink/45">
              {starts ? `From ${starts}` : ''}
              {starts && expires ? ' · ' : ''}
              {expires ? `Expires ${expires}` : ''}
            </p>
          )}
        </div>
        <p className="shrink-0 font-mono text-[1.4rem] font-light tabular-nums text-gold-dark">{d.percent}%</p>
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

function MemberPerksNote({ freeShipping }: { freeShipping: boolean }) {
  return (
    <article className="research-surface-solid p-[var(--space-5)]">
      <p className="mb-[var(--space-2)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Member perks</p>
      <p className="text-[13px] leading-relaxed text-ink/75">
        {freeShipping
          ? 'Free shipping is active on your account — it applies automatically at checkout.'
          : 'Some promo codes are member-only and require you to be signed in to redeem.'}
      </p>
    </article>
  );
}

function AccountBenefitsContent() {
  const { profile } = useCustomerAuth();
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
      {state.discounts.length === 0 ? (
        <EmptyState
          label="No account discounts on file."
          meta="Lifetime and business discounts are set up by our team — they apply automatically at checkout once active."
          className="py-[var(--space-8)]"
        />
      ) : (
        state.discounts.map((d) => <DiscountCard key={d.id} discount={d} />)
      )}
      <MemberPerksNote freeShipping={profile?.free_shipping ?? false} />
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
