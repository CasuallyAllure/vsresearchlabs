/**
 * AccountOrders — /account/orders
 *
 * Full owned-order history via an RLS-scoped select on `orders` (RLS: "own
 * rows only", so no explicit filter is needed — see `src/lib/accountData.ts`).
 * Each row uses the shared OrderStatusChip and links to its detail page.
 */

import { Link } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { listMyOrders } from '../../lib/accountData';
import { useAccountSession } from '../../lib/accountSession';
import { ordersCacheKey, useAccountQuery } from '../../lib/accountQueryCache';
import { OrderStatusChip, type AdminOrderStatus } from '../../components/ui/OrderStatusChip';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';
import { StaleDataNotice } from '../../components/system/StaleDataNotice';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatAmount(cents: number | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function AccountOrdersContent() {
  const { user } = useAccountSession();
  const key = user ? ordersCacheKey(user.id) : null;
  const { data, error, loading } = useAccountQuery(key, listMyOrders);

  if (loading) {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your orders…</p>;
  }

  // `data === null` means the read has never succeeded (no last-good value
  // to fall back on) — a full failure state is the honest result. A
  // non-null `data` alongside an `error` means a background refresh failed
  // AFTER a successful load; that keeps rendering the last-known list
  // (accountQueryCache.ts's revalidation-failure contract).
  if (!data) {
    return <ErrorState message={error ?? 'Something went wrong loading your orders.'} />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        label="You haven't placed an order yet."
        action={
          <Button variant="secondary" size="md" to="/catalog">
            Browse catalog
          </Button>
        }
      />
    );
  }

  return (
    <>
      {error && <StaleDataNotice subject="your orders" />}
      <ul className="space-y-[var(--space-3)]">
        {data.map((o) => (
          <li key={o.order_number}>
            <Link
              to={`/account/orders/${encodeURIComponent(o.order_number)}`}
              className="research-surface-solid is-interactive flex items-center justify-between gap-[var(--space-4)] p-[var(--space-4)]"
            >
              <div className="min-w-0">
                <p className="font-mono text-[13px] text-ink truncate">{o.order_number}</p>
                <p className="mt-0.5 text-[11px] text-ink/45">{formatDate(o.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-[var(--space-3)]">
                <p className="text-[13px] tabular-nums text-ink">{formatAmount(o.invoice_amount_cents)}</p>
                <OrderStatusChip status={o.status as AdminOrderStatus} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AccountOrders() {
  return (
    <AccountLayout>
      <h2 className="mb-[var(--space-5)] text-[11px] uppercase tracking-[0.22em] text-ink/45">Order history</h2>
      <AccountOrdersContent />
    </AccountLayout>
  );
}

export default AccountOrders;
