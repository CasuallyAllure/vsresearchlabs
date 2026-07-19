/**
 * Research domain — biological system studied
 *
 * The catalog's only taxonomy is `researchClassification`, which describes
 * a compound's MECHANISM (incretin agonist, GH secretagogue, bioregulator…).
 * A reader arriving at the Research Intelligence Library asks a different
 * question first: *which biological system is this compound studied in?*
 *
 * This module answers that by DERIVING a coarse system grouping from the
 * classification already on the record. Nothing new is asserted about any
 * compound — the derivation is a pure re-grouping of an existing field, so
 * no per-compound data has to be authored, reviewed, or kept in sync.
 *
 * COMPLIANCE REGISTER (important): a research domain names the *area of
 * study*, never an outcome in a person. Labels and descriptions stay in the
 * site's hedging voice ("studied in", "investigated for"), third person,
 * research-model framing. These are research materials; this taxonomy is a
 * map of the literature, not a claim about anybody's physiology.
 *
 * Pure module — no React, no I/O, safe in render.
 */

import { CLASSIFICATION_DEFINITIONS } from './compoundIntelligence';
import type { ResearchClassification } from '../types';

/** Coarse biological-system grouping derived from `researchClassification`. */
export type ResearchDomain =
  | 'metabolic-endocrine'
  | 'neurological'
  | 'musculoskeletal-tissue'
  | 'dermatological'
  | 'immune'
  | 'reproductive-hormonal'
  | 'multi-system'
  | 'exploratory';

/** Display order — most-populated systems first, exploratory last. */
export const RESEARCH_DOMAIN_ORDER: ResearchDomain[] = [
  'metabolic-endocrine',
  'musculoskeletal-tissue',
  'neurological',
  'reproductive-hormonal',
  'dermatological',
  'immune',
  'multi-system',
  'exploratory',
];

/** Short label for the system. Reads as a research area, never an outcome. */
export const RESEARCH_DOMAIN_LABELS: Record<ResearchDomain, string> = {
  'metabolic-endocrine': 'Metabolic & Endocrine',
  'musculoskeletal-tissue': 'Musculoskeletal & Tissue Repair',
  'neurological': 'Neurological / CNS',
  'reproductive-hormonal': 'Reproductive & Hormonal',
  'dermatological': 'Dermatological',
  'immune': 'Immune',
  'multi-system': 'Multi-system / Bioregulatory',
  'exploratory': 'Exploratory / Unclassified',
};

/** Compact label for dense rows and chips, where the full label would wrap. */
export const RESEARCH_DOMAIN_SHORT_LABELS: Record<ResearchDomain, string> = {
  'metabolic-endocrine': 'Metabolic',
  'musculoskeletal-tissue': 'Tissue repair',
  'neurological': 'Neurological',
  'reproductive-hormonal': 'Reproductive',
  'dermatological': 'Dermatological',
  'immune': 'Immune',
  'multi-system': 'Multi-system',
  'exploratory': 'Exploratory',
};

/**
 * One-line description of each system, in the same careful register as
 * CLASSIFICATION_DEFINITIONS: accurate enough for a specialist, readable
 * for a non-specialist, and framed entirely as research activity.
 */
export const RESEARCH_DOMAIN_DESCRIPTIONS: Record<ResearchDomain, string> = {
  'metabolic-endocrine':
    'Compounds studied in glucose regulation, energy metabolism, appetite signaling, and pituitary hormone release.',
  'musculoskeletal-tissue':
    'Compounds investigated in muscle, tendon, connective-tissue, and wound-repair research models.',
  'neurological':
    'Compounds studied in central-nervous-system models — synaptic signaling, neurotrophic factor expression, and cognition research.',
  'reproductive-hormonal':
    'Compounds investigated along the reproductive and neuroendocrine hormone axis.',
  'dermatological':
    'Compounds studied in dermal-tissue research — collagen synthesis, pigmentation, and oxidative-stress models.',
  'immune':
    'Compounds investigated in immune-signaling and inflammation research models.',
  'multi-system':
    'Short peptides studied for tissue-specific gene regulation across several organ systems.',
  'exploratory':
    'Compounds whose research area is not yet established; published characterization is limited.',
};

/**
 * The derivation. Every `ResearchClassification` maps to exactly one system.
 * Exhaustiveness is enforced by the `Record` type here and by a test — a new
 * classification cannot ship without a deliberate mapping decision.
 */
export const CLASSIFICATION_TO_DOMAIN: Record<ResearchClassification, ResearchDomain> = {
  'incretin-metabolic-agonists': 'metabolic-endocrine',
  'metabolic-cofactor': 'metabolic-endocrine',
  'gh-secretagogue': 'metabolic-endocrine',
  'growth-factor-anabolic': 'musculoskeletal-tissue',
  'regenerative': 'musculoskeletal-tissue',
  'nootropic-neuroactive': 'neurological',
  'reproductive-hormonal': 'reproductive-hormonal',
  'antioxidant-beauty': 'dermatological',
  'immunomodulatory': 'immune',
  'bioregulator': 'multi-system',
  'experimental': 'exploratory',
};

/**
 * Resolve the system a compound is studied in. Records with no
 * classification on file fall to 'exploratory' rather than being hidden —
 * an unclassified compound is still on record.
 */
export function researchDomainFor(
  classification: ResearchClassification | undefined | null,
): ResearchDomain {
  if (!classification) return 'exploratory';
  return CLASSIFICATION_TO_DOMAIN[classification] ?? 'exploratory';
}

/** Label for a compound's system, ready to render. */
export function researchDomainLabel(
  classification: ResearchClassification | undefined | null,
): string {
  return RESEARCH_DOMAIN_LABELS[researchDomainFor(classification)];
}

/**
 * The mechanism definitions that sit under a system — used to explain a
 * system in technical terms without duplicating the classification copy.
 */
export function domainClassifications(domain: ResearchDomain): ResearchClassification[] {
  return (Object.keys(CLASSIFICATION_TO_DOMAIN) as ResearchClassification[]).filter(
    (c) => CLASSIFICATION_TO_DOMAIN[c] === domain,
  );
}

/** Technical read-through for a system: the mechanism classes it contains. */
export function domainTechnicalDetail(domain: ResearchDomain): string {
  const classes = domainClassifications(domain);
  if (classes.length === 0) return RESEARCH_DOMAIN_DESCRIPTIONS[domain];
  return classes.map((c) => CLASSIFICATION_DEFINITIONS[c]).join(' ');
}
