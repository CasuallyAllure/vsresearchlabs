/**
 * AccountDashboard — the /account Overview content.
 *
 * Greets the customer, shows their membership tier (+ account-type badge for
 * business accounts), a reward-balance summary, active account discounts,
 * the shipping address on file, and their 3 most recent orders (guest orders
 * placed before signup are claimed by email on login, so they appear here
 * too) with a link through to the full history.
 *
 * Rendered inside `AccountLayout`, which already gates on `user && profile`
 * and owns the chrome (brand bar, tabs, sign-out) — this component owns only
 * the Overview content, so it reads auth state for itself (cheap; same
 * pattern as the admin pages re-calling `useAdminAuth`).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCustomerAuth } from '../../lib/customerAuth';
import type { CustomerProfile } from '../../lib/customerProfile';
import {
  getMyRewardSummary,
  listMyDiscounts,
  type CustomerDiscountRow,
  type RewardSummary,
} from '../../lib/accountData';
import { OrderStatusChip, type AdminOrderStatus } from '../ui/OrderStatusChip';
import { Button } from '../ui/Button';
import { RewardTracker } from './RewardTracker';
import { MemberOfferCard } from './MemberOfferCard';
import { MEMBER_OFFERS } from '../../config/memberOffers';
import { TIER_BENEFITS } from '../../config/tierBenefits';
import { supabase } from '../../lib/supabase';

/** `customer_profiles.account_type`/`business_name` (migration 043) aren't on
 *  `CustomerProfile` yet — this workstream can't add them (owned elsewhere).
 *  Read them defensively so the badge lights up the moment the column lands,
 *  and degrades to "individual" (no badge) until then. */
interface ProfileWithAccountType extends CustomerProfile {
  account_type?: 'individual' | 'business';
  business_name?: string | null;
}

interface OrderRow {
  order_number: string;
  status: AdminOrderStatus;
  created_at: string;
  invoice_amount_cents: number | null;
}

const RECENT_ORDER_LIMIT = 3;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatAmount(cents: number | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function AccountDashboard() {
  const { user, profile: rawProfile } = useCustomerAuth();
  const profile = rawProfile as ProfileWithAccountType | null;

  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [rewards, setRewards] = useState<RewardSummary | null>(null);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [discounts, setDiscounts] = useState<CustomerDiscountRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setOrders([]);
        return;
      }
      const { data, error } = await supabase
        .from('orders')
        .select('order_number, status, created_at, invoice_amount_cents')
        .order('created_at', { ascending: false })
        .limit(RECENT_ORDER_LIMIT);
      if (cancelled) return;
      if (error) {
        setOrdersError(error.message);
        setOrders([]);
        return;
      }
      setOrders((data as OrderRow[]) ?? []);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadRewards() {
    const { data, error } = await getMyRewardSummary();
    if (error) setRewardsError(error);
    setRewards(data);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await getMyRewardSummary();
      if (cancelled) return;
      if (error) setRewardsError(error);
      setRewards(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await listMyDiscounts();
      if (cancelled) return;
      setDiscounts(data.filter((d) => d.active));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) return null;

  const firstName = profile.full_name.trim().split(/\s+/)[0] || 'there';
  const hasAddress = !!profile.address_line1;
  const isBusiness = profile.account_type === 'business';

  return (
    <section>
      {/* Header */}
      <header className="mb-[var(--space-6)] flex items-start justify-between gap-[var(--space-4)]">
        <div>
          <h1 className="font-serif text-[clamp(1.4rem,2.6vw,1.9rem)] leading-[1.1] tracking-[-0.02em] text-ink">
            <span className="font-light text-ink/85">Welcome back, </span>
            <span className="font-medium text-ink">{firstName}.</span>
          </h1>
          <p className="mt-[var(--space-2)] text-[13px] text-ink/55">{user?.email}</p>
        </div>
        {/* Account standing — stated on hairline rules, not worn as badges. */}
        <div className="flex shrink-0 flex-col items-end gap-[var(--space-1)] border-l border-ink/[0.09] pl-[var(--space-4)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/55">
            {profile.tier === 'pro' ? 'Pro member' : 'Member'}
          </span>
          {isBusiness && (
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
              {profile.business_name?.trim() || 'Business account'}
            </span>
          )}
        </div>
      </header>

      {profile.status === 'waitlisted' && (
        <div className="mb-[var(--space-6)] research-surface-solid p-[var(--space-5)]">
          <p className="text-[12px] uppercase tracking-[0.2em] text-ink/45 mb-[var(--space-1)]">Waitlisted</p>
          <p className="text-[13px] leading-relaxed text-ink/75">
            Your account is on the waitlist. We'll email you the moment access opens up.
          </p>
        </div>
      )}

      {/* Membership — tier, member-since, standing terms (src/config/tierBenefits.ts) */}
      <div className="research-surface-solid p-[var(--space-5)] mb-[var(--space-6)]">
        <div className="mb-[var(--space-3)] flex items-baseline justify-between gap-[var(--space-3)] border-b border-ink/[0.09] pb-[var(--space-3)]">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">
            {TIER_BENEFITS[profile.tier].label}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/30">
            Member since {formatDate(profile.created_at)}
          </p>
        </div>
        <ul className="space-y-1">
          {TIER_BENEFITS[profile.tier].benefits.map((benefit) => (
            <li key={benefit} className="text-[12.5px] leading-relaxed text-ink/75">
              {benefit}
            </li>
          ))}
        </ul>
      </div>

      {/* Reward balance + active discounts */}
      <div className="mb-[var(--space-6)] grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
        <div>
          {rewards ? (
            <>
              <RewardTracker summary={rewards} onChanged={reloadRewards} compact />
              <Link to="/account/rewards" className="mt-[var(--space-2)] inline-block text-[11px] uppercase tracking-[0.18em] text-teal hover:text-teal-dark transition-colors">
                View history →
              </Link>
            </>
          ) : rewardsError ? (
            <div className="research-surface-solid p-[var(--space-5)]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Order credit</p>
              <p className="text-[12.5px] text-ink/50">Rewards aren't available right now.</p>
            </div>
          ) : (
            <div className="research-surface-solid p-[var(--space-5)]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Order credit</p>
              <p className="text-[12.5px] text-ink/50">Loading…</p>
            </div>
          )}
        </div>

        <div>
          {discounts !== null && discounts.length === 0 && MEMBER_OFFERS.length > 0 ? (
            <MemberOfferCard offer={MEMBER_OFFERS[0]} compact />
          ) : (
            <div className="research-surface-solid p-[var(--space-5)]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Active discounts</p>
              {discounts === null ? (
                <p className="text-[12.5px] text-ink/50">Loading…</p>
              ) : discounts.length === 0 ? (
                <p className="text-[12.5px] text-ink/50">No account discounts on file.</p>
              ) : (
                <ul className="space-y-1">
                  {discounts.map((d) => (
                    <li key={d.id} className="text-[13px] text-ink/85">
                      {d.label} <span className="text-ink/45">· {d.percent}% off</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Link to="/account/benefits" className="mt-[var(--space-2)] inline-block text-[11px] uppercase tracking-[0.18em] text-teal hover:text-teal-dark transition-colors">
            View benefits →
          </Link>
        </div>
      </div>

      {/* Shipping address */}
      <div className="research-surface-solid p-[var(--space-6)] mb-[var(--space-6)]">
        <div className="flex items-center justify-between mb-[var(--space-3)]">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Shipping address</p>
        </div>
        {hasAddress ? (
          <address className="not-italic text-[13.5px] leading-relaxed text-ink/85">
            {profile.full_name}<br />
            {profile.address_line1}{profile.address_line2 ? <>, {profile.address_line2}</> : null}<br />
            {[profile.city, profile.state, profile.postal_code].filter(Boolean).join(', ')}<br />
            {profile.country}
            {profile.phone ? <><br />{profile.phone}</> : null}
          </address>
        ) : (
          <p className="text-[13px] text-ink/55">No shipping address on file yet.</p>
        )}
      </div>

      {/* Orders */}
      <div>
        <div className="mb-[var(--space-3)] flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Recent orders</p>
          <Link to="/account/orders" className="text-[11px] uppercase tracking-[0.18em] text-teal hover:text-teal-dark transition-colors">
            View all →
          </Link>
        </div>

        {orders === null && (
          <p className="text-[13px] text-ink/50">Loading your orders…</p>
        )}

        {orders !== null && orders.length === 0 && (
          <div className="research-surface-solid p-[var(--space-6)] text-center">
            <p className="text-[13.5px] text-ink/70 mb-[var(--space-4)]">
              {ordersError ? 'Could not load orders right now.' : "You haven't placed an order yet."}
            </p>
            <Button variant="secondary" size="md" to="/catalog">
              Browse catalog
            </Button>
          </div>
        )}

        {orders !== null && orders.length > 0 && (
          <ul className="space-y-[var(--space-3)]">
            {orders.map((o) => (
              <li key={o.order_number}>
                <Link
                  to={`/account/orders/${encodeURIComponent(o.order_number)}`}
                  className="research-surface-solid is-interactive flex items-center justify-between gap-[var(--space-4)] p-[var(--space-4)]"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] text-ink truncate">{o.order_number}</p>
                    <p className="text-[11px] text-ink/45 mt-0.5">{formatDate(o.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-[var(--space-3)]">
                    <p className="text-[13px] text-ink tabular-nums">{formatAmount(o.invoice_amount_cents)}</p>
                    <OrderStatusChip status={o.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
