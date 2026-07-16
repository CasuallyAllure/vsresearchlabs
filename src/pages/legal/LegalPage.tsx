/**
 * LegalPage
 *
 * Shared layout for the legal/trust page cluster (Privacy, Terms, Shipping,
 * About). Matches the masthead/eyebrow/prose conventions used on Contact and
 * TrackOrder: mono uppercase eyebrow, serif (font-light) masthead, a prose
 * column capped at max-w-[64ch], section subheads, a "last updated" line,
 * and a closing pointer to the contact page for questions.
 *
 * Content is passed as children so each page owns its own copy; this
 * component only owns the chrome.
 */

import { Link } from 'react-router-dom';

interface LegalPageProps {
  eyebrow: string;
  title: React.ReactNode;
  intro?: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalPage({ eyebrow, title, intro, lastUpdated, children }: LegalPageProps) {
  return (
    <section className="py-[var(--space-10)] max-w-[64ch] mx-auto">
      <header className="mb-[var(--space-8)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          {eyebrow}
        </p>
        <h1 className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-4)] font-light">
          {title}
        </h1>
        {intro && (
          <p className="holo-text-body text-[13px] sm:text-[14px] leading-relaxed max-w-[58ch]">
            {intro}
          </p>
        )}
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40 mt-[var(--space-4)]">
          Last updated: {lastUpdated}
        </p>
      </header>

      <div className="space-y-[var(--space-6)] text-[13px] leading-relaxed text-ink/70">
        {children}
      </div>

      <div className="mt-[var(--space-12)] pt-[var(--space-6)] border-t border-ink/[0.08]">
        <p className="text-[12px] leading-relaxed text-ink/50">
          Questions about this policy: contact us via the{' '}
          <Link
            to="/contact"
            className="text-ink underline underline-offset-4 decoration-ink/20 hover:decoration-ink/60 transition-colors"
          >
            contact page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/** Section subhead, shared visual rhythm across all legal pages. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink mb-[var(--space-3)]">
        {title}
      </h2>
      <div className="space-y-[var(--space-3)]">{children}</div>
    </section>
  );
}
