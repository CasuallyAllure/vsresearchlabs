/**
 * AdminOrderDetail
 *
 * Full-page host for a single order. The order itself — invoice layout,
 * Salesforce-style status bar, actions, notes timeline, printable invoice —
 * lives in the shared <OrderView>, which also powers the modal opened from
 * the Orders list. This page just frames it with the admin shell + a back
 * button to the left of the sub-tabs.
 */

import { useParams } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { OrderView } from './OrderView';

export function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <AdminLayout backTo="/admin/orders" backLabel="All orders">
      <div className="research-surface-solid">
        {id ? (
          <OrderView orderId={id} />
        ) : (
          <p className="p-[var(--space-6)] text-[12px] text-red-400">No order id.</p>
        )}
      </div>
    </AdminLayout>
  );
}
