/**
 * MembershipHero
 *
 * Top-of-landing member-access module — the first thing a visitor sees.
 * Pitches the account perks (free shipping, member pricing, order history) and
 * drives signup. Glass-ADJACENT by design: per DESIGN_2026_BLUEPRINT §1.3/§5,
 * backdrop-blur is banned on scrolling content, so this uses the solid
 * `.floating-module` surface with a layered sheen + inset highlight for the
 * premium glass read — no backdrop-filter. Monochrome tokens only, dark-mode
 * via tokens, reduced-motion honored, single primary CTA.
 *
 * The "what are peptides" intro video is no longer an auto-popup; `onWatchIntro`
 * opens it on demand so this module greets visitors instead.
 */

import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

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

interface MembershipHeroProps {
  onWatchIntro: () => void;
}

export function MembershipHero({ onWatchIntro }: MembershipHeroProps) {
  return (
    <section
      aria-label="Member access"
      className="-mx-[var(--space-6)] border-b border-ink/[0.08] px-[var(--space-6)] pt-[var(--space-6)] pb-[var(--space-4)]"
    >
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="floating-module relative overflow-hidden rounded-[24px] p-[var(--space-7)] sm:p-[var(--space-10)]">
          {/* Layered sheen — the glass read without backdrop-blur (perf + §5). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-90"
            style={{
              background:
                'radial-gradient(120% 140% at 85% -10%, rgba(255,255,255,0.55), transparent 55%), linear-gradient(160deg, rgba(255,255,255,0.35) 0%, transparent 42%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-[280px] w-[280px] rounded-full opacity-[0.06]"
            style={{ background: 'radial-gradient(closest-side, var(--c-ink, #1A1714), transparent)' }}
          />

          <div className="relative grid grid-cols-1 gap-[var(--space-7)] md:grid-cols-12 md:items-center">
            {/* Copy + CTAs */}
            <div className="md:col-span-7">
              <p className="text-[11px] uppercase tracking-[0.28em] text-ink/45 font-medium">
                Member access
              </p>
              <h2 className="mt-[var(--space-3)] font-serif text-[clamp(1.7rem,4vw,2.6rem)] leading-[1.08] tracking-[-0.01em] text-ink">
                <span className="font-light text-ink/85">Create an account. </span>
                <span className="font-medium text-ink">Ship free, save more.</span>
              </h2>
              <p className="mt-[var(--space-3)] max-w-[54ch] text-[14px] leading-[1.6] text-ink/60">
                Members unlock free shipping, member-only pricing like{' '}
                <span className="text-ink/80 font-medium">15% off for Q3</span>, and one
                place for every order, invoice, and tracking number.
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

              {/* CTAs — single primary, subordinate secondary + tertiary. */}
              <div className="mt-[var(--space-6)] flex flex-col items-start gap-[var(--space-3)] sm:flex-row sm:items-center">
                <Button to="/account" size="lg">
                  Create your account
                </Button>
                <Button to="/account" variant="secondary" size="lg">
                  Sign in
                </Button>
                <button
                  type="button"
                  onClick={onWatchIntro}
                  className="inline-flex min-h-[44px] items-center gap-1.5 px-1 text-[12px] font-medium text-ink/55 underline-offset-4 transition-colors hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/30 rounded-[8px]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
                  </svg>
                  New to peptides? Watch the 90-sec intro
                </button>
              </div>
            </div>

            {/* Reassurance rail */}
            <div className="md:col-span-5 md:pl-[var(--space-6)]">
              <div className="rounded-[16px] border border-ink/[0.08] bg-base-800/40 p-[var(--space-5)]">
                <p className="text-[10px] uppercase tracking-[0.24em] text-ink/40 font-medium">
                  Why sign up
                </p>
                <ul className="mt-[var(--space-3)] space-y-[var(--space-3)]">
                  {[
                    'Guest checkout stays — an account just adds the perks.',
                    'Your orders, invoices & tracking in one secure place.',
                    'Member pricing and seasonal codes applied at checkout.',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-ink/65">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        {...stroke}
                        className="mt-0.5 shrink-0 text-ink/45"
                        aria-hidden="true"
                      >
                        <path d="m5 12.5 4 4 10-10" />
                      </svg>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
