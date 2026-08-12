/**
 * Product — Canonical Data Model
 *
 * Single source of truth for product shape. All consumers import from
 * this file (re-exported via `../types`).
 */

/**
 * ProductCategory — top-level catalog department.
 *
 * Compounds live under one of three `*-research-supplies` categories.
 * Equipment (instruments, consumables, handling tools) lives under
 * `laboratory-equipment` and is further refined by `EquipmentClassification`.
 *
 * Invariant: compound categories carry the `-research-supplies` suffix;
 * `laboratory-equipment` does not. This lets domain membership be derived
 * from the category string itself without a separate domain field.
 */
export type ProductCategory =
  | 'biopeptide-research-supplies'
  | 'nootropics-research-supplies'
  | 'skincare-research-supplies'
  | 'laboratory-equipment';

/**
 * EquipmentClassification — internal filter dimension on the lab equipment
 * catalog. Only meaningful when `category === 'laboratory-equipment'`;
 * undefined for compound products.
 */
export type EquipmentClassification =
  | 'general'
  | 'biopeptide-sciences'
  | 'nootropics-research'
  | 'skincare-research';

export type ProductType = 'peptide' | 'solvent' | 'consumable' | 'equipment';

export type ResearchClassification =
  | 'incretin-metabolic-agonists'
  | 'gh-secretagogue'
  | 'growth-factor-anabolic'
  | 'metabolic-cofactor'
  | 'regenerative'
  | 'nootropic-neuroactive'
  | 'bioregulator'
  | 'immunomodulatory'
  | 'reproductive-hormonal'
  | 'antioxidant-beauty'
  | 'experimental';

export interface ProductSpec {
  label: string;
  value: string;
}

/**
 * ProductVariant — single dose/spec tier within a product family.
 * Wave 7c — operational metadata for procurement workflows.
 *
 * Today this only carries the dose label. Future workflows (per-tier
 * SKU lookup, per-tier pricing, per-tier inquiry routing) will extend
 * this interface — additions only, never breaking changes.
 */
export interface ProductVariant {
  /** Display label for the tier (e.g. "5mg", "30 mL", "Box of 100"). */
  dose: string;
  /** Optional per-tier SKU. Reserved for future inquiry workflows. */
  sku?: string;
}

export interface Product {
  // ──────────────────────────────────────────────────────────────────────
  // Canonical fields
  // ──────────────────────────────────────────────────────────────────────

  /** Stable primary key. UUID or kebab-case slug. */
  id: string;
  /** URL-friendly display name. Used for SEO / fallback route key. */
  slug: string;
  /** Display title. */
  name: string;
  /** Enum category. No free strings. */
  category: ProductCategory;
  /**
   * Internal classification for laboratory-equipment items. Drives the
   * PillTabs filter on `/laboratory-equipment`. Undefined on compound
   * products — invariant enforced at the catalog page boundary.
   */
  equipmentClassification?: EquipmentClassification;
  /** Card subtitle / meta description. ≤ ~160 chars. */
  shortDescription: string;
  /** Product detail body. Plain text (no markdown in v1). */
  longDescription: string;
  /**
   * Plain-English, user-friendly summary shown prominently under the
   * compound name (before the technical modules). Written for a regular
   * reader, not a researcher. Supports a tiny highlight markup:
   *   **text** → key term (cyan)   ~text~ → positive outcome (mint)   *text* → strong (white)
   */
  laymanSummary?: string;
  /** First image is hero, rest populate gallery. */
  images: string[];
  /** Key/value spec table. Optional per product. */
  specs: ProductSpec[];
  /** Admin-facing identifier. Unique. */
  sku: string;
  /**
   * Short procurement-quick-reference identifier (e.g. "SEM", "TZP",
   * "BAL"). Conventionally the third segment of the SKU. Wave 7c.
   */
  abbreviation: string;
  /**
   * Canonical chemical / INN name, when the catalog `name` is a research
   * code rather than the substance name (e.g. name "RTT", chemicalName
   * "Retatrutide"). Kept for lab accuracy: it drives the Chemical Identity
   * analytical row and the PubChem structure lookup, which resolves by
   * substance name and cannot resolve a house code.
   */
  chemicalName?: string;
  /**
   * Optional research-community nickname displayed as a small label above
   * the product name on cards (e.g. "Wolverine" for the BPC-157 + TB-500
   * blend, after the X-Men healing trope). Pure marketing surface — no
   * scientific claim, no replacement of the canonical name below it.
   */
  nickname?: string;
  /**
   * Pharmacological / instrument class. Distinct from `category`:
   * `category` is the catalog department (one of three compound
   * categories or laboratory-equipment); `family` is the procurement-
   * meaningful grouping ("GLP-1 Agonist", "Solvent", "Sample Prep", etc.).
   * Wave 7c.
   */
  family: string;
  /**
   * Available dose / size tiers for this product. Empty array is
   * valid (e.g. equipment with a single configuration). Wave 7c.
   */
  variants: ProductVariant[];
  /** Nullable. null = "Inquire for pricing". */
  priceCents: number | null;
  /** Nullable. null = stock not tracked. 0 = out of stock. */
  stock: number | null;
  /** Filter / search tags (future). */
  tags: string[];
  /** Landing featured strip flag. */
  featured: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. Admin audit. */
  updatedAt: string;

  // ── Procurement metadata (R3) ───────────────────────────────────────────
  // All fields optional: populated per product, omit where not applicable.

  /** Lot traceability identifier (e.g. "LOT-2026-031-A"). */
  lotNumber?: string;
  /** Supply source — renders as "Supply source" (e.g. "Vetted international
   *  manufacturing partners"). Not a claim of in-house manufacture. */
  manufacturer?: string;
  /** Sourcing network — renders as "Sourcing network" (e.g. "International
   *  partner network"). Not a claim of a single jurisdiction. */
  countryOfOrigin?: string;
  /** Precise storage requirement string. Distinct from specs[].value. */
  storageCondition?: string;
  /** Shelf life in months from manufacture date. Null = not applicable. */
  shelfLifeMonths?: number | null;
  /** Ordering unit of measure (e.g. "vial", "box", "unit", "set"). */
  unitOfMeasure?: string;
  /** Typical procurement lead time in business days. */
  leadTimeDays?: number;
  /** Batch-level traceability reference (e.g. "SEM-BATCH-2026-031"). */
  batchReference?: string;
  /** Analytical testing standard(s) applied (e.g. "HPLC VSR-QC-001 · USP <62>"). */
  testingStandard?: string;
  /** Cold-chain or packaging requirement for transit. */
  shippingCondition?: string;
  /** CAS registry number. Applicable to chemical compounds only. */
  casNumber?: string;
  /** Molecular weight with unit (e.g. "4113.58 g/mol"). Peptides/chemicals. */
  molecularWeight?: string;
  /**
   * Hill-notation molecular formula (e.g. "C187H291N45O59"). Present only for
   * single, structurally defined substances corroborated against a verified
   * PubChem record — blends, heterogeneous biologic preparations, and
   * variable-length PEGylated derivatives have no single formula and carry
   * none.
   */
  molecularFormula?: string;

  // ── Research Intelligence (E3) ──────────────────────────────────────────
  // Compound-level intelligence fields. Populated for peptides; omitted for
  // equipment and consumables. Powers the CompoundIntelligenceOverlay.

  /** Broad product class. Drives two-tier catalog filtering. */
  productType?: ProductType;
  /** Pharmacological subclassification. Peptides only. */
  researchClassification?: ResearchClassification;
  /** 2–4 sentence mechanistic summary. Lay-research register. */
  mechanismSummary?: string;
  /** Receptor target profile and binding affinity context. */
  receptorActivity?: string;
  /** Downstream signaling pathway classification. */
  pathwaySummary?: string;
  /** Published research study references. Powers the Known Studies module. */
  knownStudies?: ProductStudy[];
  /**
   * Regulatory status string (e.g. "Approved — Ozempic / Wegovy",
   * "Investigational — Phase 3", "Research use only — not approved").
   */
  fdaStatus?: string;
  /** Whether at least one confirmed human clinical trial exists. */
  humanTrialsConfirmed?: boolean;
  /**
   * Verified regulatory / registry resources for this compound's active
   * ingredient. Present ONLY where the linked record was fetched and confirmed
   * to name the correct ingredient. A compound with no approved counterpart and
   * no registered trial carries none — that absence is informative, not a gap.
   */
  fdaResources?: FdaResource[];
  /**
   * Reference list for the dossier. Seeded from `knownStudies` entries that
   * already carry a resolved PMID or DOI. Every entry must carry at least one
   * resolvable identifier (`pmid`, `doi`, or `url`) — a citation with no
   * identifier is not admissible.
   */
  references?: CompoundReference[];

  // ── Chemical properties (dossier) ───────────────────────────────────────
  // Corroborated against PubChem or a manufacturer/technical source only.
  // Omitted entirely where no source could be confirmed — never estimated.

  /** Solubility / reconstitution guidance (e.g. "Soluble in water; …"). */
  solubility?: string;
  /** Stability and handling behaviour in solution and as lyophilate. */
  stability?: string;
  /** Physical appearance of the supplied material. */
  appearance?: string;

  // ── Research history (dossier) ──────────────────────────────────────────

  /** Discovery / origin narrative. Corroborated only. */
  discovery?: string;
  /** Development / sponsor codes (e.g. "LY3437943", "BI 456906"). */
  developmentCodes?: string[];
  /** Originating institution or sponsor. */
  originator?: string;
}

// ── Regulatory resources ────────────────────────────────────────────────────

/**
 * Kind of regulatory resource, which determines the expected host:
 *   drugs-at-fda   → accessdata.fda.gov (approval record)
 *   dailymed       → dailymed.nlm.nih.gov (current prescribing label)
 *   clinical-trial → clinicaltrials.gov (registered study)
 *   fda-guidance   → fda.gov (guidance / safety communication)
 */
export type FdaResourceKind =
  | 'drugs-at-fda'
  | 'dailymed'
  | 'clinical-trial'
  | 'fda-guidance';

export interface FdaResource {
  /** Human label, e.g. "Drugs@FDA — Ozempic (NDA 209637)". */
  label: string;
  /** Absolute URL. Must have been fetched and confirmed before being recorded. */
  url: string;
  kind: FdaResourceKind;
}

// ── Reference list ──────────────────────────────────────────────────────────

export interface CompoundReference {
  /** Rendered citation line (authors omitted where not verified). */
  citation: string;
  /** PubMed identifier — digits only. */
  pmid?: string;
  /** Bare DOI (`10.<registrant>/<suffix>`). */
  doi?: string;
  /** Fallback URL when neither a PMID nor a DOI exists. */
  url?: string;
}

/**
 * Canonical link for a reference, by permanence: PMID → DOI → explicit URL.
 * Returns `null` when the reference carries no resolvable identifier, which the
 * data model forbids — the guard exists so a malformed record renders as plain
 * text rather than a broken link.
 */
export function referenceHref(ref: CompoundReference): string | null {
  const pmid = ref.pmid?.trim();
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  const doi = ref.doi?.trim();
  if (doi) return `https://doi.org/${doi}`;
  return ref.url?.trim() || null;
}

/**
 * Extract a ClinicalTrials.gov identifier from free text (e.g. a study `source`
 * string reading "ClinicalTrials.gov NCT02039687"). Returns the bare
 * `NCT########` form, or `null` when the text carries none. Matches only the
 * exact registry shape — 'NCT' followed by exactly eight digits — so partial or
 * malformed identifiers are rejected rather than half-linked.
 */
export function extractNctId(text: string | undefined): string | null {
  if (!text) return null;
  const m = /\bNCT\s?(\d{8})\b/i.exec(text);
  return m ? `NCT${m[1]}` : null;
}

// ── Research Study Reference ─────────────────────────────────────────────────

export type StudyModel =
  | 'human'
  | 'rat'
  | 'mouse'
  | 'in-vitro'
  | 'in-vivo'
  | 'ex-vivo'
  | 'review';

export interface ProductStudy {
  /** Full study title. */
  title: string;
  /** Publication / database source (e.g. "NEJM", "PubMed", "Peptides"). */
  source: string;
  /** Publication year. */
  year: number;
  /** Research model / study type. */
  model: StudyModel;
  /** Clinical trial phase, if applicable (e.g. "Phase 3", "Phase 2b"). */
  phase?: string;
  /** External URL (PubMed, journal DOI, etc.). Optional. */
  url?: string;
  /**
   * PubMed identifier — digits only, no "PMID:" prefix. Present only when the
   * exact paper was resolved against PubMed (title, journal, and year all
   * corroborating). Never inferred, never approximated.
   */
  pmid?: string;
  /**
   * DOI in bare form (`10.<registrant>/<suffix>`), no `https://doi.org/`
   * prefix. Same evidentiary bar as `pmid`.
   */
  doi?: string;
  /**
   * ClinicalTrials.gov registry identifier in bare `NCT########` form. Present
   * only for trial *registrations* — a registered protocol with no publication
   * yet. Same evidentiary bar as `pmid`: the identifier must resolve.
   */
  nctId?: string;
  /** Observed findings / result bullets. Rendered under "Observed:" label. */
  notes?: string[];
}

// ───────────────────────────────────────────────────────────────────────
// Pure derivation helpers
//
// `deriveProductDose` extracts the dose / spec headline from a product
// name's split-suffix convention ("Substance — 5mg", "Vortex Mixer —
// Variable Speed"). Used by:
//   - InventoryList.deriveRowMeta (dose half)
//   - DoseTierStrip's active-tier highlighter on ProductCard / ProductPage
//
// Pure function. No I/O. Safe to call in render.
// ───────────────────────────────────────────────────────────────────────

const DOSE_SPLIT_TOKENS = [' — ', ' – ', ' - '];

export function deriveProductDose(product: Pick<Product, 'name'>): string {
  for (const sep of DOSE_SPLIT_TOKENS) {
    const idx = product.name.indexOf(sep);
    if (idx > -1) return product.name.slice(idx + sep.length).trim();
  }
  return '';
}
