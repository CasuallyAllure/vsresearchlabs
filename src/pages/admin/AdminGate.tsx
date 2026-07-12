/**
 * AdminGate
 *
 * Real auth gate for /admin/* routes. Wraps the admin tree and renders:
 *   - loading spinner while the initial session is resolved
 *   - sign-in form if no session or non-admin session
 *   - children only if signed in AND in admin_users.active=true
 *
 * The auth state is exposed to descendants via the `useAdminAuth` hook
 * (called again inside child pages — it's cheap; subscribes to the same
 * auth event stream).
 */

import { useState, type ReactNode } from 'react';
import { useAdminAuth } from '../../lib/adminAuth';
import { supabase } from '../../lib/supabase';
import { siteConfig } from '../../config';
import { FIELD_DEFAULT, FIELD_SURFACE } from '../../components/ui/Field';

export function AdminGate({ children }: { children: ReactNode }) {
  const { loading, user, isAdmin, error, signIn } = useAdminAuth();

  if (!supabase) {
    return (
      <section className="py-[var(--space-16)] max-w-[52ch]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Admin
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-4)]">
          <span className="font-light text-ink/85">Backend </span>
          <span className="font-medium text-ink">not configured.</span>
        </h1>
        <p className="holo-text-body text-[13px] leading-relaxed">
          Set <code className="font-mono text-holo-light">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-holo-light">VITE_SUPABASE_ANON_KEY</code> in
          your environment, then redeploy. Admin access requires the
          Supabase backend.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="py-[var(--space-16)] flex items-center justify-center">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em]">
          Verifying session…
        </p>
      </section>
    );
  }

  if (user && isAdmin) {
    return <>{children}</>;
  }

  return <AdminSignInForm signIn={signIn} error={error} />;
}

interface AdminSignInFormProps {
  signIn: (email: string, password: string) => Promise<boolean>;
  error: string | null;
}

function AdminSignInForm({ signIn, error }: AdminSignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await signIn(email.trim(), password);
    setSubmitting(false);
  }

  return (
    <section className="py-[var(--space-16)] max-w-[44ch]">
      <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
        Admin · Restricted
      </p>
      <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-3)]">
        <span className="font-light text-ink/85">Sign </span>
        <span className="font-medium text-ink">in.</span>
      </h1>
      <p className="holo-text-body text-[13px] leading-relaxed mb-[var(--space-8)]">
        This area is for internal operations. Accounts are provisioned
        by an existing admin via the Supabase dashboard.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <label
          htmlFor="admin-email"
          className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]"
        >
          Email
        </label>
        <input
          id="admin-email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${FIELD_SURFACE} ${FIELD_DEFAULT} mb-[var(--space-5)]`}
          placeholder={`you@${siteConfig.contact.officialHost}`}
        />

        <label
          htmlFor="admin-password"
          className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]"
        >
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${FIELD_SURFACE} ${FIELD_DEFAULT}`}
        />

        {error && (
          <p
            role="alert"
            className="mt-[var(--space-4)] text-[11px] uppercase tracking-[0.2em] text-red-400"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || email.length === 0 || password.length === 0}
          className="cta-mint group relative inline-flex items-center justify-center overflow-hidden rounded-full mt-[var(--space-8)] w-full px-[var(--space-10)] py-[var(--space-4)] text-xs uppercase tracking-[0.25em] font-medium text-ink disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <span className="relative">{submitting ? 'Signing in…' : 'Sign in'}</span>
        </button>
      </form>
    </section>
  );
}
