/**
 * MemberAccessGate
 *
 * The first thing a guest sees on the landing page: a centered popup that
 * states the standing account terms and offers three ways forward —
 *   • Create your account   (→ /account)
 *   • Sign in               (→ /account)
 *   • Continue as guest      (dismiss; the "what are peptides" intro follows)
 *
 * Each term is a toggle chip; tapping one reveals its detail line just below
 * the grid (one open at a time, first open by default so the interaction is
 * discoverable). Clean solid surface — no bleeding sheen, no accent foil, no
 * urgency stamps: the terms are facts about the account, so they read as
 * facts. Monochrome tokens only, dark-mode via tokens, ref-counted scroll
 * lock, reduced-motion-safe.
 *
 * Signed-in members never see this — Landing skips straight to the intro.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Button';
import { Logo } from '../brand/Logo';
import { useScrollLock } from '../../lib/useScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Perk {
  label: string;
  /** Serif display line in the detail panel — the hook. */
  headline: ReactNode;
  /** Supporting sentence under the headline. */
  body: string;
  /** Optional rich chip label; `label` stays the plain-string key + fallback. */
  labelNode?: ReactNode;
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
    headline: 'Every member order ships free',
    body: 'Shipping fees waived automatically at checkout — no minimums, no codes.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17.5" cy="18" r="1.6" />
      </svg>
    ),
  },
  {
    label: 'Account discount',
    headline: '15% account-holder discount on the order',
    body: 'Applied automatically to account-holder orders. This is a current pricing term and may be revised. Does not apply to volume orders.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 13 11 6a2 2 0 0 1 1.4-.6H18a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4L12 21a2 2 0 0 1-2.8 0L4 15.8a2 2 0 0 1 0-2.8z" />
        <circle cx="15.5" cy="8.5" r="1" />
      </svg>
    ),
  },
  {
    label: 'Wholesale pricing',
    labelNode: (
      <>
        Volume pricing
      </>
    ),
    headline: (
      <>
        Volume pricing — available to every industry
      </>
    ),
    body: 'We supplied laboratories business-to-business for years; that pricing schedule is now available to all industries. A $60 vial is $36 per unit in a case of 10; half kits of 5 price at $43.80 per unit. Account holders only. Volume pricing is final — other discounts and credits do not apply.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    ),
  },
  {
    label: 'Order credit',
    headline: (
      <>
        40% order credit, any compound
      </>
    ),
    body: 'Accrues on every order. At 300 units the credit applies a 40% reduction to one item. Credit does not apply to volume orders.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} fill="currentColor" fillOpacity={0.22} aria-hidden="true">
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

  // Modality enforcement — the gate declares aria-modal, so Tab must stay
  // inside it rather than reaching the landing page behind the scrim.
  const panelRef = useFocusTrap<HTMLDivElement>(render);

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
      ref={panelRef}
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
        className={`relative w-full max-w-[460px] max-h-[90dvh] overflow-y-auto rounded-[20px] border border-ink/15 bg-base-800 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.65),0_0_90px_-10px_rgba(255,255,255,0.10)] p-[var(--space-6)] sm:p-[var(--space-7)] transition-[opacity,transform] duration-300 ease-out ${
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

        {/* Brand header */}
        <div className="flex flex-col items-center">
          <Logo variant="stacked" to={null} markSize={40} wordSize={11} circled ariaLabel="VS Research Labs" />
          <p className="mt-[var(--space-3)] text-[9.5px] uppercase tracking-[0.32em] text-ink/40 font-medium">
            Member access
          </p>
        </div>
        <div
          aria-hidden="true"
          className="my-[var(--space-4)] h-px w-full bg-gradient-to-r from-transparent via-ink/12 to-transparent"
        />

        <h2 className="text-center font-serif text-[clamp(1.35rem,4.2vw,1.6rem)] leading-[1.18] tracking-[-0.01em] text-ink">
          Create an account.
          <span className="block text-ink/60">Account terms apply automatically.</span>
        </h2>
        <p className="mx-auto mt-[var(--space-3)] max-w-[38ch] text-center text-[12.5px] leading-[1.55] text-ink/55">
          Guest checkout always stays open. An account carries standing terms on shipping, pricing, and
          order credit. Tap one for the detail.
        </p>

        {/* Interactive perk chips — 2×2 raised tiles, one open at a time. */}
        <div className="mt-[var(--space-5)] grid grid-cols-2 gap-x-[var(--space-2)] gap-y-[var(--space-3)]">
          {PERKS.map((perk, i) => {
            const on = active === i;
            return (
              <button
                key={perk.label}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(i)}
                style={{ animationDelay: `${140 + i * 60}ms` }}
                className={[
                  'perk-chip group relative flex items-center justify-center gap-1.5 rounded-full border px-3 py-3 sm:py-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                  on
                    ? 'is-on border-ink/30 bg-ink/[0.08] text-ink'
                    : 'border-ink/10 bg-ink/[0.03] text-ink/60 hover:border-ink/20 hover:text-ink/85',
                ].join(' ')}
              >
                <span
                  className={`perk-icon shrink-0 ${
                    on ? 'text-ink/80' : 'text-ink/40 group-hover:text-ink/55'
                  }`}
                >
                  {perk.icon}
                </span>
                <span className="text-[11.5px] font-medium leading-tight">{perk.labelNode ?? perk.label}</span>
              </button>
            );
          })}
        </div>

        {/* Detail well for the open chip — recessed against the raised chips;
            reserved height so layout is steady. */}
        <div className="mt-[var(--space-3)] flex min-h-[88px] items-center justify-center rounded-[14px] border border-ink/[0.08] bg-ink/[0.035] px-[var(--space-4)] py-[var(--space-3)]">
          <div key={active} className="detail-fade text-center">
            <p className="font-serif text-[17px] leading-[1.25] tracking-[-0.005em] text-ink/90">
              {PERKS[active].headline}
            </p>
            <p className="mt-1 text-[12px] leading-[1.5] text-ink/55">{PERKS[active].body}</p>
          </div>
        </div>

        {/* Actions — equal primary/secondary, calm sizing. */}
        <div className="mt-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)]">
          <Button to="/account?mode=signup" size="md" fullWidth>
            Create account
          </Button>
          <Button to="/account?mode=signin" variant="secondary" size="md" fullWidth>
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

        /* Raised-tile depth: lit top edge + layered elevation (theme-aware tokens).
           Hover lifts, press flattens, the open chip stays lifted. */
        .perk-chip {
          box-shadow: var(--surface-highlight), var(--elev-1);
          transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1),
            border-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
            background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
            color 150ms cubic-bezier(0.4, 0, 0.2, 1);
          animation: perkRise 420ms cubic-bezier(0.23, 1, 0.32, 1) backwards;
        }
        @media (hover: hover) {
          .perk-chip:hover {
            transform: translateY(-1px);
            box-shadow: var(--surface-highlight-strong), var(--elev-2);
          }
        }
        .perk-chip.is-on {
          transform: translateY(-1px);
          box-shadow: var(--surface-highlight-strong), var(--elev-2);
        }
        .perk-chip:active {
          transform: translateY(0) scale(0.97);
          box-shadow: var(--surface-highlight), 0 1px 2px rgba(26, 23, 20, 0.05);
          transition-duration: 80ms;
        }
        .perk-icon { transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }
        .perk-chip.is-on .perk-icon { transform: scale(1.12); }
        @keyframes perkRise { from { opacity: 0; transform: translateY(7px); } }

        @media (prefers-reduced-motion: reduce) {
          .detail-fade, .perk-chip { animation: none; }
          .perk-chip, .perk-chip.is-on, .perk-chip:active, .perk-icon, .perk-chip.is-on .perk-icon {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
