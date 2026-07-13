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
  'incretin-metabolic-agonists': 'Incretin & Metabolic Receptor Agonists',
  'gh-secretagogue': 'GH Secretagogues',
  'growth-factor-anabolic': 'Growth Factors / Anabolic',
  'metabolic-cofactor': 'Metabolic Cofactors',
  'regenerative': 'Regenerative',
  'nootropic-neuroactive': 'Nootropic / Neuroactive',
  'bioregulator': 'Bioregulators',
  'immunomodulatory': 'Immunomodulatory',
  'reproductive-hormonal': 'Reproductive / Hormonal',
  'antioxidant-beauty': 'Antioxidant / Beauty',
  'experimental': 'Experimental',
};

/** Scientific definitions surfaced as tooltips wherever a classification
 *  appears in the UI. Lay-research register: technical enough to be
 *  accurate, accessible enough that a non-specialist can orient. */
export const CLASSIFICATION_DEFINITIONS: Record<ResearchClassification, string> = {
  'incretin-metabolic-agonists':
    'Peptide receptor agonists targeting the incretin axis (GLP-1, GIP, glucagon receptors) and related metabolic hormones such as amylin. Covers single-, dual-, and triple-agonist classes. Research applications: glucose regulation, satiety signaling, energy expenditure.',
  'gh-secretagogue':
    'Compounds that stimulate endogenous growth hormone release from the anterior pituitary. Two mechanism families: GHRH analogues (CJC-1295, Sermorelin, Tesamorelin) acting on GHRHR, and ghrelin-mimetic GHS-R1a agonists (Ipamorelin, Hexarelin, GHRP-2/6). Effects mediated through the somatotroph cAMP axis.',
  'growth-factor-anabolic':
    'Direct anabolic peptides — growth hormone itself, IGF-1 variants, and HGH fragments. Drives nitrogen retention, ribosomal protein synthesis, and tissue growth signaling via the GHR / IGF-1R / PI3K-Akt pathway.',
  'metabolic-cofactor':
    'Compounds supporting metabolic regulation outside the incretin axis. Includes NAD+ precursors, mitochondria-targeted peptides (SS-31 / elamipretide), AMPK activators (AICAR), NNMT inhibitors (5- and 10-Amino-1MQ), MOTS-C, and lipolytic cofactors (L-Carnitine, Lipo-C, AOD-9604). Unifying theme: non-incretin metabolic intervention.',
  'regenerative':
    'Tissue-repair and angiogenic peptides. Mechanisms include VEGFR-2 sensitization, FAK-paxillin–driven cell migration, eNOS upregulation, and ECM remodeling. Includes BPC-157, TB-500, and copper-peptide derivatives.',
  'nootropic-neuroactive':
    'Neuropeptides and neuromodulators acting at cortical synapses or upstream of neurotrophic factor expression. Mechanisms span BDNF/NGF upregulation (Semax), prolyl-oligopeptidase inhibition, GABAergic modulation (Selank), and ACTH-derived fragment activity.',
  'bioregulator':
    'Short peptides — typically 2 to 4 residues — originally isolated from tissue extracts (pineal, thymus, vascular). Proposed mechanisms involve intranuclear chromatin modulation and tissue-specific gene-expression regulation. Studied in longevity, circadian, and neuroendocrine-aging models.',
  'immunomodulatory':
    'Peptides that modulate immune-signaling pathways — NF-κB, STAT3, melanocortin receptor cascades. Includes α-MSH C-terminal fragments (KPV), thymosin α-1 (TLR signaling), and small-molecule cytokine modulators.',
  'reproductive-hormonal':
    'Hormones, gonadotropins, and CNS neuroendocrine signaling compounds related to the reproductive axis. Includes HPG-axis hormones (GnRH agonists such as Gonadorelin, gonadotropins HCG and HMG), Kisspeptin-class neuropeptides, oxytocinergic compounds, and CNS melanocortin agonists targeting sexual function (PT-141 / Bremelanotide acting on MC4R).',
  'antioxidant-beauty':
    'Peptides and small molecules supporting collagen synthesis, melanogenesis modulation, and oxidative-stress reduction. Includes glutathione, copper tripeptides (GHK-Cu for skincare research), and antioxidant chelators.',
  'experimental':
    'Novel investigational compounds outside the established functional classes. Published evidence is limited, mechanism may be incompletely characterized, and the research context is exploratory rather than confirmatory.',
};

/** Plain-English ("layman") version of each classification — what it actually
 *  does, in language a non-specialist gets. Shown first; the technical
 *  CLASSIFICATION_DEFINITIONS sits one swipe to the right. */
export const CLASSIFICATION_LAYMAN: Record<ResearchClassification, string> = {
  'incretin-metabolic-agonists':
    'The appetite & metabolism family — this is the GLP-1 group (the "Ozempic / Mounjaro" class). Studied for curbing appetite, steadying blood sugar, and how the body burns energy.',
  'gh-secretagogue':
    'The "make your own growth hormone" group — rather than taking growth hormone directly, these nudge your body’s own pituitary to release more of it.',
  'growth-factor-anabolic':
    'The build-and-grow group — growth hormone and IGF-1-type compounds studied for muscle growth and tissue building.',
  'metabolic-cofactor':
    'The cellular-energy & fat-metabolism group — NAD+, mitochondria helpers, and fat-handling cofactors that work outside the appetite pathway.',
  'regenerative':
    'The repair crew — peptides studied for healing and recovery of gut, tendon, muscle, and blood vessels (the BPC-157 / TB-500 family).',
  'nootropic-neuroactive':
    'The brain group — studied for focus, mood, and memory by supporting brain signaling and growth factors.',
  'bioregulator':
    'Tiny "tune-up" peptides — very short chains studied in aging and tissue health, thought to gently nudge specific tissues back toward normal function.',
  'immunomodulatory':
    'The immune-balancing group — studied for calming or rebalancing the immune response and inflammation.',
  'reproductive-hormonal':
    'The hormones & libido group — tied to reproductive hormones and sexual-function signaling (for example, PT-141).',
  'antioxidant-beauty':
    'The skin & antioxidant group — collagen, glutathione, and copper peptides studied for skin quality, glow, and oxidative stress.',
  'experimental':
    'The new & unproven group — investigational compounds where the science is still early: exploratory, not established.',
};

/** Short, plain-language one-liners for category section headers
 *  (CompoundSection). Layman's terms — the everyday "what is this group
 *  for" read, not the technical register. The full technical definition
 *  still lives in CLASSIFICATION_DEFINITIONS / the compound overlay. */
export const CLASSIFICATION_SECTION_BLURB: Record<ResearchClassification, string> = {
  'incretin-metabolic-agonists':
    'The GLP-1 group (the "Ozempic / Mounjaro" class) — studied for appetite, blood sugar, and weight loss.',
  'gh-secretagogue':
    'Nudge your body to make its own growth hormone — studied for recovery, sleep, and body composition.',
  'growth-factor-anabolic':
    'The build-and-grow group — growth hormone and IGF-1 types studied for muscle and tissue growth.',
  'metabolic-cofactor':
    'Cellular energy and fat-burning helpers — NAD+ and mitochondria support, outside the appetite pathway.',
  'regenerative':
    'The repair crew — studied for healing gut, tendon, muscle, and blood vessels (the BPC-157 / TB-500 family).',
  'nootropic-neuroactive':
    'The brain group — studied for focus, mood, and memory.',
  'bioregulator':
    'Tiny "tune-up" peptides — studied in aging and keeping specific tissues working normally.',
  'immunomodulatory':
    'The immune-balancing group — studied for calming or rebalancing immune response and inflammation.',
  'reproductive-hormonal':
    'The hormones and libido group — tied to reproductive hormones and sexual function (for example, PT-141).',
  'antioxidant-beauty':
    'The skin and antioxidant group — collagen, glutathione, and copper peptides studied for skin and glow.',
  'experimental':
    'The new and unproven group — investigational compounds where the science is still early.',
};

/** Canonical display order for the categories above. Used by filter
 *  surfaces so tabs/sections appear in a consistent, intentional order
 *  rather than data-insertion order. */
export const CLASSIFICATION_ORDER: ResearchClassification[] = [
  'incretin-metabolic-agonists',
  'gh-secretagogue',
  'growth-factor-anabolic',
  'metabolic-cofactor',
  'regenerative',
  'nootropic-neuroactive',
  'bioregulator',
  'immunomodulatory',
  'reproductive-hormonal',
  'antioxidant-beauty',
  'experimental',
];

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

  /** Plain-English summary (with highlight markup) for general readers. */
  summary?: string;

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

/**
 * Fallback plain-English summary for products without a curated
 * `laymanSummary`. Uses the first paragraph of the long description
 * (the substantive explanation, before the research-use disclaimer),
 * falling back to the short description. Ensures EVERY product shows a
 * Summary block above the technical modules.
 */
function descriptionSummary(product: Product): string | undefined {
  const lead = product.longDescription?.split(/\n\s*\n/)[0]?.trim();
  if (lead) return lead;
  const short = product.shortDescription?.trim();
  return short || undefined;
}

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
  const re = /([A-Za-z0-9][A-Za-z0-9/-]*R)\s*\(\s*EC50\s*([^)]+?)\s*\)/g;
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
      out.push(note.replace(/^\s*[•-]\s*/, '').trim());
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

    summary: product.laymanSummary ?? descriptionSummary(product),

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
