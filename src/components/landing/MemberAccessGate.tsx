/**
 * MemberAccessGate
 *
 * The first thing a guest sees on the landing page: a centered popup that
 * pitches the account perks and offers three ways forward —
 *   • Create your account   (→ /account)
 *   • Sign in               (→ /account)
 *   • Continue as guest      (dismiss; the "what are peptides" intro follows)
 *
 * Modal chrome mirrors IntroModal (portal to <body>, backdrop, ESC, ref-counted
 * scroll lock, reduced-motion-safe transitions). Surface + tokens follow
 * DESIGN_2026_BLUEPRINT: solid `.floating-module` (no backdrop-filter on
 * scrolling content), monochrome tokens, dark-mode via tokens.
 *
 * Signed-in visitors never see this — Landing skips straight to the intro.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button';
import { useScrollLock } from '../../lib/useScrollLock';

interface Perk {
  label: string;
  icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const PERKS: Perk[] = [
  {
    label: 'Free shipping',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17.5" cy="18" r="1.6" />
      </svg>
    ),
  },
  {
    label: '15% off · Q3',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 13 11 6a2 2 0 0 1 1.4-.6H18a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4L12 21a2 2 0 0 1-2.8 0L4 15.8a2 2 0 0 1 0-2.8z" />
        <circle cx="15.5" cy="8.5" r="1" />
      </svg>
    ),
  },
  {
    label: 'Order history & invoices',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    label: 'Reward points',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="m12 4 2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 15.9 7.4 18.3l.9-5.1L4.5 9.5l5.2-.8z" />
      </svg>
    ),
  },
];

interface MemberAccessGateProps {
  open: boolean;
  /** Dismiss without signing in — Landing then opens the intro video. */
  onGuest: () => void;
}

export function MemberAccessGate({ open: isOpen, onGuest }: MemberAccessGateProps) {
  const [render, setRender] = useState(isOpen);
  const [open, setOpen] = useState(false);

  // Mount on open + run the enter transition; unmount after the exit.
  useEffect(() => {
    if (isOpen) {
      setRender(true);
      const t = setTimeout(() => setOpen(true), 30);
      return () => clearTimeout(t);
    }
    setOpen(false);
    const t = setTimeout(() => setRender(false), 250);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Ref-counted scroll lock — cooperates with the intro modal that follows.
  useScrollLock(render);

  // ESC = continue as guest.
  useEffect(() => {
    if (!render) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onGuest();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [render, onGuest]);

  if (!render) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Member access"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onGuest}
        className={`absolute inset-0 bg-[color:var(--scrim)] backdrop-blur-[3px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <div
        className={`floating-module relative w-full max-w-[560px] max-h-[90dvh] overflow-y-auto rounded-[24px] p-[var(--space-7)] sm:p-[var(--space-9)] transition-[opacity,transform] duration-300 ease-out ${
          open ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[0.98]'
        }`}
      >
        {/* Layered sheen — glass read without backdrop-filter. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[24px] opacity-90"
          style={{
            background:
              'radial-gradient(120% 140% at 85% -10%, rgba(255,255,255,0.5), transparent 55%), linear-gradient(160deg, rgba(255,255,255,0.3) 0%, transparent 42%)',
          }}
        />

        {/* Continue-as-guest (close) */}
        <button
          type="button"
          onClick={onGuest}
          aria-label="Continue as guest"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-base-800/80 text-ink/60 hover:text-ink hover:border-ink/35 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative">
          <p className="text-[11px] uppercase tracking-[0.28em] text-ink/45 font-medium">
            Member access
          </p>
          <h2 className="mt-[var(--space-3)] font-serif text-[clamp(1.6rem,4.5vw,2.2rem)] leading-[1.1] tracking-[-0.01em] text-ink">
            <span className="font-light text-ink/85">Create an account. </span>
            <span className="font-medium text-ink">Ship free, save more.</span>
          </h2>
          <p className="mt-[var(--space-3)] max-w-[46ch] text-[13.5px] leading-[1.6] text-ink/60">
            Members unlock free shipping, member-only pricing like{' '}
            <span className="text-ink/80 font-medium">15% off for Q3</span>, and one place for
            every order, invoice, and tracking number. Guest checkout always stays open.
          </p>

          {/* Perk pills */}
          <ul className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-2)]">
            {PERKS.map((perk) => (
              <li
                key={perk.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink/[0.1] bg-ink/[0.035] px-3 py-1.5 text-[11px] font-medium text-ink/70"
              >
                <span className="text-ink/50">{perk.icon}</span>
                {perk.label}
              </li>
            ))}
          </ul>

          {/* Actions — primary create, secondary sign in, tertiary guest. */}
          <div className="mt-[var(--space-6)] flex flex-col gap-[var(--space-3)]">
            <div className="flex flex-col gap-[var(--space-3)] sm:flex-row">
              <Button to="/account" size="lg" className="sm:flex-1">
                Create your account
              </Button>
              <Button to="/account" variant="secondary" size="lg" className="sm:flex-1">
                Sign in
              </Button>
            </div>
            <button
              type="button"
              onClick={onGuest}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 self-center px-2 text-[12.5px] font-medium text-ink/55 underline-offset-4 transition-colors hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/30 rounded-[8px]"
            >
              Continue as guest →
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
