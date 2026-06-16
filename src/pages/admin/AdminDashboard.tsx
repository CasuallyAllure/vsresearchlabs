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

import { AdminLayout } from './AdminLayout';
import { AdminStatModules } from './AdminStatModules';

export function AdminDashboard() {
  return (
    <AdminLayout>
      <AdminStatModules />
    </AdminLayout>
  );
}
