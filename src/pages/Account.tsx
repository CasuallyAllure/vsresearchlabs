/**
 * Account — the customer portal route (/account).
 *
 * All auth-gating and chrome (brand bar, section tabs, sign-out) lives in
 * `AccountLayout`; this route renders the Overview content inside it. Guest
 * checkout is unaffected: this page is an additive entry point, never a gate
 * in front of the store.
 */

import { AccountLayout } from './account/AccountLayout';
import { AccountDashboard } from '../components/account/AccountDashboard';

export function Account() {
  return (
    <AccountLayout>
      <AccountDashboard />
    </AccountLayout>
  );
}

export default Account;
