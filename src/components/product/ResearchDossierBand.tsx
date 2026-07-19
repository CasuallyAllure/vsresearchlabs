/**
 * ResearchDossierBand — the product page's single route into the dossier
 *
 * The product page is a laboratory specification sheet: it states what is
 * supplied, not what the compound is studied for. All scientific
 * discussion — mechanism of action, receptor/target activity, signaling
 * pathway, and the published study record — lives in exactly one place,
 * the shared CompoundIntelligenceOverlay. This band is the signpost to it.
 *
 * Presentational only: the host owns the overlay's open state so the same
 * shared overlay component is reused, never forked.
 */

import { Button } from '../ui/Button';

interface ResearchDossierBandProps {
  /** Substance name, used to name the target compound in the control. */
  substance: string;
  onOpen: () => void;
}

export function ResearchDossierBand({ substance, onOpen }: ResearchDossierBandProps) {
  return (
    <section
      className="floating-module px-[var(--space-5)] py-[var(--space-5)] mb-[var(--space-4)]"
      aria-labelledby="dossier-band-title"
    >
      <p
        id="dossier-band-title"
        className="text-ink/45 uppercase mb-[var(--space-2)]"
        style={{ fontSize: '11px', letterSpacing: '0.22em' }}
      >
        Scientific documentation
      </p>
      <p
        className="text-ink/65 leading-[1.65] mb-[var(--space-4)]"
        style={{ fontSize: '13px', maxWidth: '60ch' }}
      >
        Mechanism of action, receptor activity, signaling pathway, and published
        studies are documented in this compound&rsquo;s research dossier.
      </p>
      <Button
        variant="secondary"
        size="lg"
        type="button"
        onClick={onOpen}
        aria-label={`Open the research dossier for ${substance}`}
      >
        Open Research Dossier
      </Button>
    </section>
  );
}
