/**
 * AccountOrders — /account/orders
 *
 * Full owned-order history via an RLS-scoped select on `orders` (RLS: "own
 * rows only", so no explicit filter is needed — see `src/lib/accountData.ts`).
 * Each row uses the shared OrderStatusChip and links to its detail page.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountLayout } from './AccountLayout';
import { listMyOrders, type MyOrderRow } from '../../lib/accountData';
import { OrderStatusChip, type AdminOrderStatus } from '../../components/ui/OrderStatusChip';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/system/EmptyState';
import { ErrorState } from '../../components/system/ErrorState';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; orders: MyOrderRow[] }
  | { kind: 'error'; message: string };

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
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await listMyOrders();
      if (cancelled) return;
      if (error) {
        setState({ kind: 'error', message: error });
        return;
      }
      setState({ kind: 'ok', orders: data });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <p className="py-[var(--space-8)] text-[13px] text-ink/50">Loading your orders…</p>;
  }

  if (state.kind === 'error') {
    return <ErrorState message={state.message} />;
  }

  if (state.orders.length === 0) {
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
    <ul className="space-y-[var(--space-3)]">
      {state.orders.map((o) => (
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
