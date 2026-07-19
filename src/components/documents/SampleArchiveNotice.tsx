/**
 * SampleArchiveNotice — the honesty seal for placeholder documentation.
 *
 * The document dataset (`src/data/documents.json`) is illustrative sample
 * data: no PDFs exist behind it, and its issuer / analyst / standard /
 * instrument fields are invented. Landing already blurs its own preview
 * behind an "Archive in preparation" seal. This component is the same
 * commitment for the routes that render the records legibly —
 * `/documentation` and `/documentation/:id` — where the fabricated
 * provenance metadata is fully visible and therefore most misleading.
 *
 * Rendered whenever any visible record carries `isSamplePlaceholder`.
 * Deliberately a bordered panel rather than a quiet caption: the claim it
 * withdraws is a quality-credential claim, so it has to be unmissable.
 *
 * Monochrome tokens only, no motion, no new hues. The research-use-only
 * line is sourced from siteConfig so its wording stays consistent
 * site-wide and is never re-authored here.
 */

import { siteConfig } from '../../config';

export function SampleArchiveNotice() {
  return (
    <aside
      role="note"
      aria-label="Sample archive notice"
      className="research-surface-solid mb-[var(--space-8)] border border-ink/20 p-[var(--space-5)]"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink/70">
        Sample archive — in preparation
      </p>
      <p className="mt-[var(--space-3)] max-w-[70ch] text-[13px] leading-relaxed text-ink/60">
        The records below are illustrative placeholders showing the structure
        of our documentation system. They are not issued quality records and
        do not represent completed analyses. Live certificates and batch
        records will be published here as they are issued.
      </p>
      <p className="mt-[var(--space-3)] text-[11px] leading-relaxed text-ink/40">
        {siteConfig.compliance.documentLine}
      </p>
    </aside>
  );
}
