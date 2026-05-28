/**
 * Compound Intelligence — shared selector
 *
 * Single source of truth for the normalized compound-intelligence
 * view-model. It reads ONLY the canonical `Product` fields (the same
 * fields the CompoundIntelligenceOverlay consumes) and derives a
 * presentation-ready shape. Nothing here is invented: every value is
 * read from product data or parsed from documented prose. Outcomes are
 * aggregated from the published study record, never authored here.
 *
 * Consumers: the landing intelligence hero today; the overlay and
 * future compound pages can adopt this to stay on one architecture.
 * Pure module — no React, no I/O, safe in render.
 */

import type {
  Product,
  ProductStudy,
  ProductVariant,
  ResearchClassification,
} from '../types';
import { deriveProductDose } from '../types';

/** Canonical classification labels. The authoritative copy lives here;
 *  other surfaces should import this rather than re-declaring it. */
export const CLASSIFICATION_LABELS: Record<ResearchClassification, string> = {
  'glp-1-agonist': 'GLP-1 Agonist',
  'dual-agonist': 'Dual GIP/GLP-1 Agonist',
  'triple-agonist': 'Triple GIP/GLP-1/GCG Agonist',
  'growth-hormone-secretagogue': 'GH Secretagogue',
  'growth-factor': 'Growth Factor',
  'metabolic-lipolytic': 'Metabolic / Lipolytic',
  'nootropic-neuroactive': 'Nootropic / Neuroactive',
  'regenerative-healing': 'Regenerative / Healing',
  'immunomodulatory': 'Immunomodulatory',
  'bio-regulator': 'Bio-Regulator',
  'experimental': 'Experimental',
};

export interface ReceptorTargetView {
  receptor: string;
  ec50: string;
}

export interface AnalyticalRow {
  label: string;
  value: string;
}

export interface CompoundIntelligence {
  /** Substance name with the dose suffix stripped ("Retatrutide"). */
  substance: string;
  /** Active dose parsed from the product name ("5mg"). */
  activeDose: string;
  abbreviation: string;
  sku: string;
  family: string;
  classificationLabel: string;
  casNumber?: string;
  molecularWeight?: string;
  specimenImage?: string;

  /** Discrete receptor potency rows parsed from `receptorActivity`. */
  receptorTargets: ReceptorTargetView[];

  mechanismSummary?: string;
  receptorActivity?: string;
  pathwaySummary?: string;

  /** Distinct documented outcomes aggregated from the study record. */
  physiologicalOutcome: string[];

  analytical: AnalyticalRow[];
  tiers: ProductVariant[];

  fdaStatus?: string;
  humanTrials: boolean;
  /** Studies, newest first. */
  studies: ProductStudy[];

  hasMolecularIntelligence: boolean;
  hasStudies: boolean;
}

const DASH_SPLIT = [' — ', ' – ', ' - '];

export function substanceName(name: string): string {
  for (const sep of DASH_SPLIT) {
    const idx = name.indexOf(sep);
    if (idx > -1) return name.slice(0, idx).trim();
  }
  return name;
}

/**
 * Parse documented receptor potencies out of the free-text
 * `receptorActivity` summary. Matches the shape
 * "GIP-R (EC50 ~0.04 nM), GLP-1R (EC50 ~0.02 nM)". Returns [] when the
 * prose carries no parenthesised potencies, so the map degrades to
 * receptor symbols only rather than fabricating numbers.
 */
export function parseReceptorTargets(
  receptorActivity?: string,
): ReceptorTargetView[] {
  if (!receptorActivity) return [];
  const out: ReceptorTargetView[] = [];
  const re = /([A-Za-z0-9][A-Za-z0-9/\-]*R)\s*\(\s*EC50\s*([^)]+?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(receptorActivity)) !== null) {
    out.push({ receptor: m[1].trim(), ec50: m[2].trim() });
  }
  return out;
}

function buildAnalytical(product: Product): AnalyticalRow[] {
  const rows: AnalyticalRow[] = [];
  const keep = ['Purity (HPLC)', 'Form', 'Mass', 'Volume', 'Quantity'];
  product.specs
    .filter((s) => keep.includes(s.label))
    .forEach((s) => rows.push({ label: s.label, value: s.value }));
  if (product.casNumber)
    rows.push({ label: 'CAS Number', value: product.casNumber });
  if (product.molecularWeight)
    rows.push({ label: 'Molecular Weight', value: product.molecularWeight });
  if (product.testingStandard)
    rows.push({ label: 'Testing Standard', value: product.testingStandard });
  return rows;
}

/**
 * Aggregate distinct physiological outcomes from the published study
 * record. Human-trial findings lead (clinically observed effects);
 * preclinical findings backfill. Deduplicated on a normalized key,
 * capped so the dossier stays dense, not exhaustive.
 */
function derivePhysiologicalOutcome(studies: ProductStudy[]): string[] {
  const ordered = [...studies].sort((a, b) => {
    const ah = a.model === 'human' ? 0 : 1;
    const bh = b.model === 'human' ? 0 : 1;
    return ah - bh;
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of ordered) {
    for (const note of s.notes ?? []) {
      const key = note
        .toLowerCase()
        .replace(/headline reports indicated.*/i, '')
        .replace(/[^a-z]/g, '')
        .slice(0, 28);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(note.replace(/^\s*[•\-]\s*/, '').trim());
      if (out.length >= 5) return out;
    }
  }
  return out;
}

export function getCompoundIntelligence(
  product: Product,
): CompoundIntelligence {
  const studies = [...(product.knownStudies ?? [])].sort(
    (a, b) => b.year - a.year,
  );
  const classificationLabel = product.researchClassification
    ? CLASSIFICATION_LABELS[product.researchClassification] ?? product.family
    : product.family;

  const hasMolecularIntelligence = !!(
    product.mechanismSummary ||
    product.receptorActivity ||
    product.pathwaySummary
  );

  return {
    substance: substanceName(product.name),
    activeDose: deriveProductDose(product),
    abbreviation: product.abbreviation,
    sku: product.sku,
    family: product.family,
    classificationLabel,
    casNumber: product.casNumber,
    molecularWeight: product.molecularWeight,
    specimenImage: product.images?.[0],

    receptorTargets: parseReceptorTargets(product.receptorActivity),

    mechanismSummary: product.mechanismSummary,
    receptorActivity: product.receptorActivity,
    pathwaySummary: product.pathwaySummary,

    physiologicalOutcome: derivePhysiologicalOutcome(studies),

    analytical: buildAnalytical(product),
    tiers: product.variants ?? [],

    fdaStatus: product.fdaStatus,
    humanTrials:
      product.humanTrialsConfirmed ??
      studies.some((s) => s.model === 'human'),
    studies,

    hasMolecularIntelligence,
    hasStudies: studies.length > 0,
  };
}
