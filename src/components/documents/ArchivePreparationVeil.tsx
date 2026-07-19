/**
 * ArchivePreparationVeil — the shared "archive in preparation" treatment.
 *
 * The document dataset (`src/data/documents.json`) is illustrative: no PDF
 * exists behind any record, and the issuer / analyst / standard / instrument
 * fields are invented. Landing has always presented that structure blurred
 * behind a calm seal rather than legibly; this component is that exact
 * treatment, extracted so `/documentation`, `/documentation/:id`, the
 * product-page document slots, and Landing itself all read identically.
 *
 * What the veil does NOT do is carry the disclosure on its own. The blurred
 * region is the presentation; the honest label rides on top of it, the
 * `isSamplePlaceholder` flag stays required on the data, and the routes stay
 * noindexed. A blurred fake document with no label is worse than a labelled
 * one.
 *
 * By default the veiled region is inert — `aria-hidden` + `pointer-events-none`
 * — so assistive tech reads the seal rather than invented provenance, and the
 * records cannot be opened as if they were filed. `interactive` opts out where
 * the underlying content must stay reachable (the `/documentation` gallery,
 * which routes to per-record pages that carry the same veil).
 *
 * Monochrome tokens only. No motion, so nothing to gate on reduced-motion.
 */

import type { ReactNode } from 'react';

interface ArchivePreparationVeilProps {
  children: ReactNode;
  /**
   * Whether the veil applies. `false` renders the children untouched, so a
   * surface can stay written the same way once real records land.
   */
  active?: boolean;
  /** Short, calm second line. The blur carries most of the message. */
  note?: string;
  /** Keeps the veiled content reachable and announced. Default: inert. */
  interactive?: boolean;
  /** Tighter seal for small regions (product-page document slots). */
  compact?: boolean;
  className?: string;
}

const DEFAULT_NOTE = 'Not issued records — live certificates to be published as issued.';

export function ArchivePreparationVeil({
  children,
  active = true,
  note = DEFAULT_NOTE,
  interactive = false,
  compact = false,
  className = '',
}: ArchivePreparationVeilProps) {
  if (!active) return <>{children}</>;

  return (
    <div className={`relative ${className}`}>
      <div
        aria-hidden={interactive ? undefined : 'true'}
        className={`select-none saturate-[0.6] ${compact ? 'blur-[5px] opacity-50' : 'blur-[7px] opacity-45'} ${
          interactive ? '' : 'pointer-events-none'
        }`}
      >
        {children}
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-[var(--space-4)]">
        <div
          role="note"
          aria-label="Archive in preparation"
          className={`rounded-full border border-ink/15 bg-base-800/85 text-center backdrop-blur-sm ${
            compact
              ? 'px-[var(--space-4)] py-[var(--space-2)]'
              : 'px-[var(--space-6)] py-[var(--space-3)]'
          }`}
        >
          <span className="block font-mono text-[10px] uppercase tracking-[0.28em] text-ink/60">
            Archive in preparation
          </span>
          {note && (
            <span className="mt-1 block max-w-[42ch] text-[11px] leading-snug text-ink/45">{note}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default ArchivePreparationVeil;
