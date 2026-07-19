/**
 * SampleArchiveNotice — the plain-language disclosure that pairs with
 * `ArchivePreparationVeil`.
 *
 * The document dataset (`src/data/documents.json`) is illustrative sample
 * data: no PDFs exist behind it, and its issuer / analyst / standard /
 * instrument fields are invented. The veil blurs those records; this line
 * says, in words, what the blur implies — they are not issued quality
 * records. The blur carries the message, so this stays a quiet caption
 * rather than the bordered panel it used to be, but it is never dropped:
 * a blurred fake record with no label is worse than a labelled one.
 *
 * Rendered whenever any visible record carries `isSamplePlaceholder`.
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
      className="mb-[var(--space-6)] border-l border-ink/15 pl-[var(--space-4)]"
    >
      <p className="max-w-[70ch] text-[12.5px] leading-relaxed text-ink/55">
        The records below are illustrative placeholders showing how the archive
        is structured. They are not issued quality records. Live certificates
        and batch records will be published here as they are issued.
      </p>
      <p className="mt-[var(--space-2)] text-[11px] leading-relaxed text-ink/40">
        {siteConfig.compliance.documentLine}
      </p>
    </aside>
  );
}
