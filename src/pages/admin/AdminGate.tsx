/**
 * AdminGate
 * Phase 3.6 — minimal local gate for /admin routes.
 *
 * This is NOT real auth. It's a deliberately small speed bump so the
 * admin scaffold isn't world-readable while we iterate. A real auth
 * system replaces this in a later phase.
 *
 * Behavior
 * --------
 * - If `VITE_ADMIN_PASSPHRASE` is unset (e.g. local dev with empty .env),
 *   the gate is transparent — children render directly.
 * - Otherwise, the user must enter the passphrase once. The unlock token
 *   is stored in `sessionStorage`, so it survives in-tab navigation but
 *   not full browser restart.
 */

import { useState, type ReactNode } from 'react';

const SESSION_KEY = 'vsresearchlabs.admin.unlocked';
const REQUIRED = (import.meta.env.VITE_ADMIN_PASSPHRASE as string | undefined) ?? '';

function isUnlocked(): boolean {
  if (REQUIRED.length === 0) return true;
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function AdminGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(isUnlocked);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (unlocked) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value === REQUIRED) {
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* sessionStorage unavailable — gate stays for this render */
      }
      setUnlocked(true);
      setError(null);
    } else {
      setError('Incorrect passphrase.');
    }
  }

  return (
    <section className="py-[var(--space-16)] max-w-[40ch]">
      <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
        Admin
      </p>
      <h1 className="text-3xl font-light text-white tracking-tight mb-[var(--space-3)]">
        Restricted area
      </h1>
      <p className="text-sm text-white/55 leading-relaxed mb-[var(--space-8)]">
        This area is for internal catalog management. Enter the admin
        passphrase to continue.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <label
          htmlFor="admin-passphrase"
          className="block text-xs uppercase tracking-widest text-white/50 mb-[var(--space-2)]"
        >
          Passphrase
        </label>
        <input
          id="admin-passphrase"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={!!error || undefined}
          className={[
            'w-full px-[var(--space-4)] py-[var(--space-3)] bg-black/40 border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none transition-colors',
            error
              ? 'border-red-500/60 focus:border-red-400'
              : 'border-white/10 focus:border-gold/50',
          ].join(' ')}
        />
        {error && (
          <p
            role="alert"
            className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          className="mt-[var(--space-6)] px-[var(--space-8)] py-[var(--space-3)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium hover:bg-gold-light transition-colors"
        >
          Unlock
        </button>
      </form>
    </section>
  );
}
