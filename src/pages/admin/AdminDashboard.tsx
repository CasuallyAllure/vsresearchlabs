/**
 * AdminDashboard
 *
 * Landing page. A single row of smart modules (open inquiries, orders
 * awaiting invoice, paid orders awaiting fulfillment, fulfilled this month,
 * SKUs in stock). Each shows its live count and expands into a panel with
 * the underlying records — see AdminStatModules.
 *
 * Catalog seeding used to live here; it now sits on the unified
 * Catalog · Inventory surface next to the rest of stock management.
 */

import { Link } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminStatModules } from './AdminStatModules';
import { PerformanceSummary } from './PerformanceSummary';

export function AdminDashboard() {
  return (
    <AdminLayout>
      <div className="mb-[var(--space-4)] flex justify-end">
        <Link
          to="/admin/orders/new"
          className="rounded-full border border-ink/20 bg-ink/[0.04] px-[var(--space-4)] py-[5px] text-[9.5px] uppercase tracking-[0.18em] text-ink/80 transition-colors hover:border-ink/35 hover:text-ink"
        >
          + New order
        </Link>
      </div>
      <PerformanceSummary />
      <AdminStatModules />
    </AdminLayout>
  );
}
