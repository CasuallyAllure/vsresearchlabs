/**
 * CustomerAccountPanels
 *
 * The "Linked account" section for AdminCustomerDetail. The three management
 * panels (profile flags / rewards / discounts) and their audited RPCs were
 * extracted into src/components/admin/accountPanels so the /admin/members rows
 * can reuse the identical controls and write paths. This is now a thin adapter
 * that mounts the shared root keyed by the CRM customer id — the customer
 * detail page's props and behaviour are unchanged.
 */

import { LinkedAccountPanels } from '../../components/admin/accountPanels';

interface CustomerAccountPanelsProps {
  /** CRM customers.id — matched against customer_profiles.customer_id. */
  customerId: string;
  /** CRM contact (email) — shown as identity context next to the profile. */
  customerContact: string;
}

export function CustomerAccountPanels({ customerId, customerContact }: CustomerAccountPanelsProps) {
  return <LinkedAccountPanels lookup={{ by: 'customer_id', value: customerId }} contact={customerContact} />;
}
