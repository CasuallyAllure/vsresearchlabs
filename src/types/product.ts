/**
 * Product — Canonical Data Model
 *
 * Single source of truth for product shape. All consumers import from
 * this file (re-exported via `../types`).
 */

export type ProductCategory = 'research-supplies' | 'laboratory-equipment';

export type ProductType = 'peptide' | 'solvent' | 'consumable' | 'equipment';

export type ResearchClassification =
  | 'glp-1-agonist'
  | 'dual-agonist'
  | 'triple-agonist'
  | 'growth-hormone-secretagogue'
  | 'growth-factor'
  | 'metabolic-lipolytic'
  | 'nootropic-neuroactive'
  | 'regenerative-healing'
  | 'immunomodulatory'
  | 'bio-regulator'
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
  /** Card subtitle / meta description. ≤ ~160 chars. */
  shortDescription: string;
  /** Product detail body. Plain text (no markdown in v1). */
  longDescription: string;
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
   * Pharmacological / instrument class. Distinct from `category`:
   * `category` is the catalog department (research-supplies vs
   * laboratory-equipment); `family` is the procurement-meaningful
   * grouping ("GLP-1 Agonist", "Solvent", "Sample Prep", etc.).
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
  /** Manufacturer or synthesis origin (e.g. "VSR Synthesis · In-house"). */
  manufacturer?: string;
  /** Country or region of manufacture (e.g. "United States", "Germany"). */
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
