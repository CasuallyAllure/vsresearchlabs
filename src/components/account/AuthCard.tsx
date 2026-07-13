/**
 * AuthCard — the customer portal entry card.
 *
 * One card, two faces. "Create Account" flips the front (sign-in) to the back
 * (the full sign-up fill-out) on the Y axis — no page navigation. The card's
 * height animates to whichever face is showing, so the tall signup form and
 * the short signin form both sit cleanly framed.
 *
 * Motion is gated: under `prefers-reduced-motion` the flip is an instant swap.
 * The hidden face is `inert`, so it takes no focus and no pointer events.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Logo } from '../brand/Logo';
import { siteConfig } from '../../config';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import type { SignUpInput, SignUpResult } from '../../lib/customerAuth';

type Mode = 'signin' | 'signup';

interface AuthCardProps {
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  error: string | null;
  /** Which face to open on — lets callers deep-link straight to create/sign-in. */
  initialMode?: Mode;
}

export function AuthCard({ signIn, signUp, error, initialMode = 'signin' }: AuthCardProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  // Size the flip viewport to the active face. Re-measure on mode change and
  // whenever either face's content changes (errors, the confirm panel, etc.).
  useLayoutEffect(() => {
    const active = mode === 'signin' ? frontRef.current : backRef.current;
    if (active) setHeight(active.offsetHeight);
  }, [mode, error]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const active = mode === 'signin' ? frontRef.current : backRef.current;
      if (active) setHeight(active.offsetHeight);
    });
    if (frontRef.current) ro.observe(frontRef.current);
    if (backRef.current) ro.observe(backRef.current);
    return () => ro.disconnect();
  }, [mode]);

  const flipped = mode === 'signup';

  return (
    <div className="mx-auto w-full max-w-[27rem]">
      <div className="holo-surface rounded-[var(--radius-card)] px-[var(--space-6)] sm:px-[var(--space-8)] py-[var(--space-8)]">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-[var(--space-8)]">
          <Logo variant="stacked" markSize={56} wordSize={13} circled to={null} />
          <p className="mt-[var(--space-3)] text-[11px] uppercase tracking-[0.3em] text-ink/45">
            Customer Portal
          </p>
        </div>

        {/* Flip viewport */}
        <div style={{ perspective: '1600px' }}>
          <div
            className="relative transition-[transform,height] duration-[var(--duration-slow)] ease-[var(--easing-spring)] motion-reduce:transition-none"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              height,
            }}
          >
            {/* Front — Sign in */}
            <div
              ref={frontRef}
              inert={flipped}
              aria-hidden={flipped}
              className="w-full"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <SignInForm
                signIn={signIn}
                error={error}
                onSwitchToSignUp={() => setMode('signup')}
              />
            </div>

            {/* Back — Create account */}
            <div
              ref={backRef}
              inert={!flipped}
              aria-hidden={!flipped}
              className="absolute inset-x-0 top-0 w-full"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <SignUpForm signUp={signUp} onSwitchToSignIn={() => setMode('signin')} />
            </div>
          </div>
        </div>
      </div>

      {/* Anti-phishing note — same spirit as the inspiration, in our voice */}
      <div className="mt-[var(--space-5)] flex items-start gap-[var(--space-3)] px-[var(--space-2)]">
        <span className="mt-0.5 shrink-0 text-[var(--color-status-success)]" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" strokeLinejoin="round" />
            <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-[12px] leading-relaxed text-ink/55">
          Our only official website is{' '}
          <strong className="text-ink/80">{siteConfig.contact.officialHost}</strong>. Always
          check the address before entering your details — never sign in or send
          payment anywhere else.
        </p>
      </div>
    </div>
  );
}
