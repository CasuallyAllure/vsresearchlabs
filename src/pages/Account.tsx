/**
 * Account — the customer portal route (/account).
 *
 * Logged out  → the AuthCard (sign-in ⇄ create-account flip).
 * Logged in   → the AccountDashboard (profile + orders).
 *
 * Guest checkout is unaffected: this page is an additive entry point, never a
 * gate in front of the store.
 */

import { useCustomerAuth } from '../lib/customerAuth';
import { supabase } from '../lib/supabase';
import { AuthCard } from '../components/account/AuthCard';
import { AccountDashboard } from '../components/account/AccountDashboard';

export function Account() {
  const { loading, user, profile, error, signIn, signUp, signOut } = useCustomerAuth();

  if (!supabase) {
    return (
      <section className="py-[var(--space-16)] max-w-[52ch] mx-auto">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Customer Portal
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-4)]">
          <span className="font-light text-ink/85">Accounts are </span>
          <span className="font-light text-ink">not available yet.</span>
        </h1>
        <p className="holo-text-body text-[13px] leading-relaxed">
          The accounts backend isn't configured in this environment. You can
          still browse the catalog and check out as a guest.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="py-[var(--space-24)] flex items-center justify-center">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] text-ink/45">
          Loading your account…
        </p>
      </section>
    );
  }

  if (user && profile) {
    return (
      <AccountDashboard
        profile={profile}
        email={user.email ?? ''}
        onSignOut={signOut}
      />
    );
  }

  // Signed-in auth user without a profile row (e.g. an admin-only account, or
  // a profile that hasn't materialized): treat as logged out for the portal.
  return (
    <section className="py-[var(--space-12)] px-[var(--space-2)]">
      <AuthCard signIn={signIn} signUp={signUp} error={error} />
    </section>
  );
}

export default Account;
