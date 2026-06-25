/**
 * AccountDashboard — the signed-in customer view.
 *
 * Greets the customer, shows their membership tier, surfaces the shipping
 * address on file, and lists their orders (guest orders placed before signup
 * are claimed by email on login, so they appear here too).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { CustomerProfile } from '../../lib/customerProfile';

interface AccountDashboardProps {
  profile: CustomerProfile;
  email: string;
  onSignOut: () => void;
}

interface OrderRow {
  order_number: string;
  status: string;
  created_at: string;
  invoice_amount_cents: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_invoice: 'Awaiting invoice',
  pending_review: 'In review',
  invoice_sent: 'Invoice sent',
  payment_claimed: 'Payment received — verifying',
  paid: 'Paid',
  processing: 'Processing',
  fulfilled: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

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

export function AccountDashboard({ profile, email, onSignOut }: AccountDashboardProps) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);

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
        .order('created_at', { ascending: false });
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

  const firstName = profile.full_name.trim().split(/\s+/)[0] || 'there';
  const hasAddress = !!profile.address_line1;

  return (
    <section className="py-[var(--space-10)] max-w-[64ch] mx-auto">
      {/* Header */}
      <header className="mb-[var(--space-8)] flex items-start justify-between gap-[var(--space-4)]">
        <div>
          <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
            Customer Portal
          </p>
          <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
            <span className="font-light text-ink/85">Welcome back, </span>
            <span className="font-medium text-ink">{firstName}.</span>
          </h1>
          <p className="mt-[var(--space-2)] text-[13px] text-ink/55">{email}</p>
        </div>
        <span className="shrink-0 mt-[var(--space-1)] inline-flex items-center rounded-full border border-gold/40 bg-gold/[0.08] px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.2em] text-gold-dark">
          {profile.tier === 'pro' ? 'Pro member' : 'Member'}
        </span>
      </header>

      {profile.status === 'waitlisted' && (
        <div className="mb-[var(--space-6)] research-surface-solid p-[var(--space-5)]">
          <p className="text-[12px] uppercase tracking-[0.2em] text-ink/45 mb-[var(--space-1)]">Waitlisted</p>
          <p className="text-[13px] leading-relaxed text-ink/75">
            Your account is on the waitlist. We'll email you the moment access opens up.
          </p>
        </div>
      )}

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
      <div className="mb-[var(--space-8)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-3)]">Your orders</p>

        {orders === null && (
          <p className="text-[13px] text-ink/50">Loading your orders…</p>
        )}

        {orders !== null && orders.length === 0 && (
          <div className="research-surface-solid p-[var(--space-6)] text-center">
            <p className="text-[13.5px] text-ink/70 mb-[var(--space-4)]">
              {ordersError ? 'Could not load orders right now.' : "You haven't placed an order yet."}
            </p>
            <Link
              to="/catalog"
              className="inline-flex items-center rounded-full bg-ink/[0.12] border border-ink/35 px-[var(--space-6)] py-[var(--space-3)] text-[11px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.18] hover:border-ink/50 transition-colors"
            >
              Browse catalog
            </Link>
          </div>
        )}

        {orders !== null && orders.length > 0 && (
          <ul className="space-y-[var(--space-3)]">
            {orders.map((o) => (
              <li
                key={o.order_number}
                className="research-surface-solid p-[var(--space-4)] flex items-center justify-between gap-[var(--space-4)]"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[13px] text-ink truncate">{o.order_number}</p>
                  <p className="text-[11px] text-ink/45 mt-0.5">{formatDate(o.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] text-ink tabular-nums">{formatAmount(o.invoice_amount_cents)}</p>
                  <p className="text-[10.5px] uppercase tracking-[0.16em] text-teal mt-0.5">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sign out */}
      <div className="pt-[var(--space-6)] border-t border-ink/[0.08]">
        <button
          type="button"
          onClick={onSignOut}
          className="text-[12px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink/80 transition-colors"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
