/**
 * AccountLayout — shell for all /account/* pages.
 *
 * Owns the customer-portal auth guard AND the chrome (mirrors AdminLayout's
 * thin command bar + sub-nav, customer-flavored): a slim bar with the brand,
 * the signed-in email, and sign-out, plus a PillTabs strip for the five
 * portal sections. `/account`'s URL and logged-out behavior are unchanged —
 * a signed-out visitor still sees the existing AuthCard in place.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCustomerAuth } from '../../lib/customerAuth';
import { supabase } from '../../lib/supabase';
import { AuthCard } from '../../components/account/AuthCard';
import { PillTabs, type PillTab } from '../../components/ui/PillTabs';
import { siteConfig } from '../../config';

const TABS: PillTab[] = [
  { id: '/account', label: 'Overview' },
  { id: '/account/orders', label: 'Orders' },
  { id: '/account/rewards', label: 'Rewards' },
  { id: '/account/benefits', label: 'Benefits' },
  { id: '/account/profile', label: 'Profile' },
];

/** Longest-prefix match, with `/account` only matching the exact index route
 *  (otherwise every sub-route would also match it). */
function activeTabId(pathname: string): string {
  if (pathname === '/account' || pathname === '/account/') return '/account';
  const match = TABS.find((t) => t.id !== '/account' && pathname.startsWith(t.id));
  return match?.id ?? '/account';
}

export function AccountLayout({ children }: { children: ReactNode }) {
  const { loading, user, profile, error, signIn, signUp, signOut } = useCustomerAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  if (!(user && profile)) {
    // Signed-out, or a signed-in auth user without a profile row (e.g. an
    // admin-only account) — treat as logged out for the portal.
    return (
      <section className="py-[var(--space-12)] px-[var(--space-2)]">
        <AuthCard
          signIn={signIn}
          signUp={signUp}
          error={error}
          initialMode={new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin'}
        />
      </section>
    );
  }

  return (
    <section className="py-[var(--space-6)] max-w-[64ch] mx-auto px-[var(--space-2)]">
      <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-2)] border-b border-ink/[0.06] pb-[var(--space-2)]">
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] sm:tracking-[0.2em]">
          <span className="text-ink/70">
            <span className="sm:hidden">{siteConfig.brand.shortCode}</span>
            <span className="hidden sm:inline">{siteConfig.brand.name}</span>
          </span>
          <span aria-hidden="true" className="text-ink/25">/</span>
          <span className="text-ink/40">Account</span>
        </span>

        <span className="ml-auto hidden min-w-0 shrink truncate whitespace-nowrap font-mono text-[10px] tabular-nums text-ink/40 lg:inline">
          {user.email}
        </span>
        <button
          type="button"
          onClick={() => signOut()}
          className="relative shrink-0 whitespace-nowrap rounded-full border border-ink/15 px-2.5 py-[3px] text-[10px] uppercase tracking-[0.16em] text-ink/60 transition-colors hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 sm:tracking-[0.2em] max-lg:ml-auto before:absolute before:inset-x-0 before:-inset-y-[10px] before:content-['']"
        >
          Sign out
        </button>
      </header>

      <nav aria-label="Account sections" className="mb-[var(--space-6)] flex justify-center">
        <PillTabs
          tabs={TABS}
          activeId={activeTabId(location.pathname)}
          onChange={(id) => navigate(id)}
          ariaLabel="Account sections"
        />
      </nav>

      <div>{children}</div>
    </section>
  );
}
