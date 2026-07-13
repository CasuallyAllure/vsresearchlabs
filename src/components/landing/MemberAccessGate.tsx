/**
 * MemberAccessGate
 *
 * The first thing a guest sees on the landing page: a centered popup that
 * pitches the account perks and offers three ways forward —
 *   • Create your account   (→ /account)
 *   • Sign in               (→ /account)
 *   • Continue as guest      (dismiss; the "what are peptides" intro follows)
 *
 * Each perk is a toggle chip; tapping one reveals its detail line just below
 * the grid (one open at a time, first open by default so the interaction is
 * discoverable). Clean solid surface — no bleeding sheen. Monochrome tokens,
 * dark-mode via tokens, ref-counted scroll lock, reduced-motion-safe.
 *
 * Signed-in members never see this — Landing skips straight to the intro.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button';
import { useScrollLock } from '../../lib/useScrollLock';

interface Perk {
  label: string;
  detail: string;
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
    detail: 'Shipping fees waived on every member order — applied automatically at checkout.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17.5" cy="18" r="1.6" />
      </svg>
    ),
  },
  {
    label: '15% off · Q3',
    detail: 'Members get an automatic 15% off the entire order for the remainder of Q3.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 13 11 6a2 2 0 0 1 1.4-.6H18a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4L12 21a2 2 0 0 1-2.8 0L4 15.8a2 2 0 0 1 0-2.8z" />
        <circle cx="15.5" cy="8.5" r="1" />
      </svg>
    ),
  },
  {
    label: 'Order history',
    detail: 'Every order, invoice, and tracking number saved in one secure place.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    label: 'Rewards',
    detail: 'Earn reward points on every order. At 300 points, take 40% off any compound.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
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
  const [active, setActive] = useState(0);

  // Mount on open + run the enter transition; unmount after the exit.
  useEffect(() => {
    if (isOpen) {
      setRender(true);
      setActive(0);
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
        className={`absolute inset-0 bg-[color:var(--scrim)] backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel — solid surface, one calm shadow, hairline top highlight. */}
      <div
        className={`relative w-full max-w-[460px] max-h-[90dvh] overflow-y-auto rounded-[20px] border border-ink/12 bg-base-800 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] p-[var(--space-6)] sm:p-[var(--space-7)] transition-[opacity,transform] duration-300 ease-out ${
          open ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[0.98]'
        }`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[20px] bg-gradient-to-r from-transparent via-ink/20 to-transparent"
        />

        {/* Continue-as-guest (close) */}
        <button
          type="button"
          onClick={onGuest}
          aria-label="Continue as guest"
          className="absolute right-3.5 top-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-ink/12 text-ink/50 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <p className="text-[10px] uppercase tracking-[0.3em] text-ink/40 font-medium">
          Member access
        </p>
        <h2 className="mt-[var(--space-2)] font-serif text-[clamp(1.45rem,5vw,1.9rem)] leading-[1.12] tracking-[-0.01em] text-ink">
          Create an account.{' '}
          <span className="text-ink/70">Ship free, save more.</span>
        </h2>
        <p className="mt-[var(--space-2)] max-w-[42ch] text-[13px] leading-[1.55] text-ink/55">
          Guest checkout always stays open — an account just adds the perks. Tap one to see how it works.
        </p>

        {/* Interactive perk chips — 2×2, one open at a time. */}
        <div className="mt-[var(--space-5)] grid grid-cols-2 gap-[var(--space-2)]">
          {PERKS.map((perk, i) => {
            const on = active === i;
            return (
              <button
                key={perk.label}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(i)}
                className={[
                  'group flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                  on
                    ? 'border-ink/25 bg-ink/[0.07] text-ink'
                    : 'border-ink/10 bg-ink/[0.02] text-ink/65 hover:border-ink/20 hover:text-ink/85',
                ].join(' ')}
              >
                <span className={`shrink-0 ${on ? 'text-ink/70' : 'text-ink/40 group-hover:text-ink/55'}`}>
                  {perk.icon}
                </span>
                <span className="min-w-0 flex-1 text-[12px] font-medium leading-tight">{perk.label}</span>
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${on ? 'bg-ink/60' : 'bg-ink/15'}`}
                />
              </button>
            );
          })}
        </div>

        {/* Detail line for the open chip — reserved height so layout is steady. */}
        <div className="mt-[var(--space-3)] min-h-[52px] rounded-[11px] border border-ink/[0.08] bg-ink/[0.02] px-[var(--space-3)] py-[var(--space-3)]">
          <p key={active} className="detail-fade flex items-start gap-2 text-[12.5px] leading-[1.5] text-ink/70">
            <span className="mt-[3px] h-3 w-[2px] shrink-0 rounded-full bg-ink/30" aria-hidden="true" />
            {PERKS[active].detail}
          </p>
        </div>

        {/* Actions — equal primary/secondary, calm sizing. */}
        <div className="mt-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)]">
          <Button to="/account" size="md" fullWidth>
            Create account
          </Button>
          <Button to="/account" variant="secondary" size="md" fullWidth>
            Sign in
          </Button>
        </div>
        <button
          type="button"
          onClick={onGuest}
          className="mt-[var(--space-3)] flex min-h-[40px] w-full items-center justify-center gap-1 text-[12px] font-medium text-ink/45 transition-colors hover:text-ink/75 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-[8px]"
        >
          Continue as guest
          <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <style>{`
        .detail-fade { animation: detailFade 220ms ease-out both; }
        @keyframes detailFade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .detail-fade { animation: none; } }
      `}</style>
    </div>,
    document.body,
  );
}
