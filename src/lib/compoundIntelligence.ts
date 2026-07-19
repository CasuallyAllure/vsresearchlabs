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
  CompoundReference,
  FdaResource,
  Product,
  ProductStudy,
  ProductVariant,
  ResearchClassification,
} from '../types';
import { deriveProductDose, extractNctId } from '../types';

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
  'antioxidant-beauty': 'Antioxidant / Dermatological',
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
    'Peptides and small molecules studied in collagen synthesis, melanogenesis modulation, and oxidative-stress models. Includes glutathione, copper tripeptides (GHK-Cu in dermatological research), and antioxidant chelators.',
  'experimental':
    'Novel investigational compounds outside the established functional classes. Published evidence is limited, mechanism may be incompletely characterized, and the research context is exploratory rather than confirmatory.',
};

/** Plain-English ("layman") version of each classification — what it actually
 *  does, in language a non-specialist gets. Shown first; the technical
 *  CLASSIFICATION_DEFINITIONS sits one swipe to the right. */
export const CLASSIFICATION_LAYMAN: Record<ResearchClassification, string> = {
  'incretin-metabolic-agonists':
    'The appetite & metabolism family — the GLP-1 group (the same class as Ozempic and Mounjaro). Researched for appetite, blood sugar, and how energy is metabolized.',
  'gh-secretagogue':
    'The growth-hormone-signaling group — compounds researched for how they trigger the pituitary to release growth hormone, rather than supplying the hormone directly.',
  'growth-factor-anabolic':
    'The build-and-grow group — growth hormone and IGF-1-type compounds researched in muscle-growth and tissue-building studies.',
  'metabolic-cofactor':
    'The cellular-energy & fat-metabolism group — NAD+, mitochondrial peptides, and fat-handling cofactors researched separately from the appetite pathway.',
  'regenerative':
    'The repair group — peptides researched for healing and recovery of gut, tendon, muscle, and blood vessels (the BPC-157 / TB-500 family).',
  'nootropic-neuroactive':
    'The brain group — researched for focus, mood, and memory through brain-signaling and growth-factor studies.',
  'bioregulator':
    'Very short peptides researched in aging and tissue-health studies, examined for how they influence specific tissues.',
  'immunomodulatory':
    'The immune-balancing group — researched for how they influence immune response and inflammation.',
  'reproductive-hormonal':
    'The hormones & libido group — tied to reproductive-hormone and sexual-function signaling (for example, PT-141), studied in that research area.',
  'antioxidant-beauty':
    'The dermatological & antioxidant group — collagen, glutathione, and copper peptides studied in dermal-tissue and oxidative-stress research models.',
  'experimental':
    'The new & unproven group — investigational compounds where the research is still early: exploratory, not established.',
};

/** Short, plain-language one-liners for category section headers
 *  (CompoundSection). Layman's terms — the everyday "what is this group
 *  for" read, not the technical register. The full technical definition
 *  still lives in CLASSIFICATION_DEFINITIONS / the compound overlay. */
export const CLASSIFICATION_SECTION_BLURB: Record<ResearchClassification, string> = {
  'incretin-metabolic-agonists':
    'The GLP-1 group (the same class as Ozempic and Mounjaro) — researched for appetite, blood sugar, and weight.',
  'gh-secretagogue':
    'Compounds researched for how they signal the release of growth hormone — studied in recovery and body-composition research.',
  'growth-factor-anabolic':
    'Growth hormone and IGF-1-type compounds — researched in muscle and tissue-growth studies.',
  'metabolic-cofactor':
    'NAD+, mitochondrial, and fat-metabolism compounds — researched in cellular-energy studies, separate from the appetite pathway.',
  'regenerative':
    'Compounds researched for tissue repair and recovery of gut, tendon, muscle, and blood vessels (the BPC-157 / TB-500 family).',
  'nootropic-neuroactive':
    'Compounds researched for brain signaling — studied in focus, mood, and memory research.',
  'bioregulator':
    'Very short peptides researched in aging and tissue-health studies.',
  'immunomodulatory':
    'Compounds researched for how they influence immune response and inflammation.',
  'reproductive-hormonal':
    'Compounds tied to reproductive-hormone and sexual-function signaling (for example, PT-141) — studied in that research area.',
  'antioxidant-beauty':
    'Collagen, glutathione, and copper peptides — studied in dermal-tissue and oxidative-stress research models.',
  'experimental':
    'Investigational compounds where the research is still early — exploratory, not established.',
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

  /** Verified regulatory / registry links. Empty when none were corroborated. */
  fdaResources: FdaResource[];
  /** Reference list, newest first. Empty when nothing verifiable exists. */
  references: CompoundReference[];

  /** Chemical properties, as authored. Undefined where uncorroborated. */
  solubility?: string;
  stability?: string;
  appearance?: string;

  /** Research history, as authored. Undefined where uncorroborated. */
  discovery?: string;
  developmentCodes: string[];
  originator?: string;

  hasMolecularIntelligence: boolean;
  hasStudies: boolean;
  hasChemicalProperties: boolean;
  hasResearchHistory: boolean;
}

/**
 * Backfill a structured `nctId` from a study's free-text `source`.
 *
 * Several records predate the structured field and carry the identifier inside
 * prose such as "ClinicalTrials.gov NCT02039687". An explicit `nctId` always
 * wins; extraction only fills a genuine absence, so hand-corrected data is
 * never overwritten by a regex.
 */
function withExtractedNctId(study: ProductStudy): ProductStudy {
  if (study.nctId) return study;
  const nctId = extractNctId(study.source) ?? extractNctId(study.title);
  return nctId ? { ...study, nctId } : study;
}

/**
 * Derive the reference list from the study record.
 *
 * This is deliberately a derivation rather than a second hand-authored list.
 * A reference can only exist here if the underlying study already carries a
 * resolved `pmid` or `doi`, so the reference list cannot drift away from the
 * verified evidence, and no citation can be introduced that was not checked
 * against PubMed or a DOI registrar. Studies with no identifier contribute
 * nothing — they still render under Known Studies, they just cannot be cited.
 *
 * An explicit `product.references` array overrides the derivation, for the
 * case where a reference is not tied to a study record.
 */
export function deriveReferences(
  product: Product,
  studies: ProductStudy[],
): CompoundReference[] {
  if (product.references?.length) return product.references;
  return studies
    .filter((s) => s.pmid || s.doi)
    .map((s) => ({
      citation: `${s.title}. ${s.source}, ${s.year}.`,
      pmid: s.pmid,
      doi: s.doi,
    }));
}

/**
 * Rows for the Chemical Properties module. Only populated fields appear, so a
 * compound with a verified appearance but no verified solubility renders one
 * row rather than an empty placeholder next to a real value.
 */
export function chemicalPropertyRows(product: Product): AnalyticalRow[] {
  const rows: AnalyticalRow[] = [];
  if (product.appearance) rows.push({ label: 'Appearance', value: product.appearance });
  if (product.solubility) rows.push({ label: 'Solubility / Reconstitution', value: product.solubility });
  if (product.stability) rows.push({ label: 'Stability', value: product.stability });
  return rows;
}

/** Rows for the Research History module. Same all-or-nothing-per-row rule. */
export function researchHistoryRows(product: Product): AnalyticalRow[] {
  const rows: AnalyticalRow[] = [];
  if (product.discovery) rows.push({ label: 'Discovery / Origin', value: product.discovery });
  if (product.developmentCodes?.length)
    rows.push({ label: 'Development Codes', value: product.developmentCodes.join(' · ') });
  if (product.originator) rows.push({ label: 'Originator', value: product.originator });
  return rows;
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
  // `testingStandard` is procurement metadata, not an analytical parameter.
  // It is rendered once, by ProcurementSheet on the product spec sheet.
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
  const studies = [...(product.knownStudies ?? [])]
    .sort((a, b) => b.year - a.year)
    .map(withExtractedNctId);
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

    fdaResources: product.fdaResources ?? [],
    references: deriveReferences(product, studies),

    solubility: product.solubility,
    stability: product.stability,
    appearance: product.appearance,

    discovery: product.discovery,
    developmentCodes: product.developmentCodes ?? [],
    originator: product.originator,

    hasMolecularIntelligence,
    hasStudies: studies.length > 0,
    hasChemicalProperties: chemicalPropertyRows(product).length > 0,
    hasResearchHistory: researchHistoryRows(product).length > 0,
  };
}
