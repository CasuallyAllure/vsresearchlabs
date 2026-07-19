/**
 * Document — Procurement Documentation Schema
 * Wave 9 — Documentation Library Foundation.
 *
 * Represents a single piece of procurement documentation associated
 * with a product family or batch (Certificate of Analysis, HPLC
 * purity report, sterility certificate, calibration certificate, etc).
 *
 * Wave 9 is foundation only:
 *   - No backend, no uploads, no auth, no admin CRUD
 *   - No PDF rendering or per-document detail page
 *   - The `href` is a placeholder; future waves wire actual viewing
 *
 * The shape is forward-compatible: new fields (issuer, expirationDate,
 * artifactUrl, etc.) are additive-only.
 */

/**
 * Document type taxonomy. Free string in the JSON for editorial
 * flexibility, but the seed dataset uses these canonical values.
 */
export type DocumentTypeLabel =
  | 'Certificate of Analysis'
  | 'HPLC Purity Report'
  | 'Mass Spectrometry Report'
  | 'Sterility Certificate'
  | 'Endotoxin Test Report'
  | 'Calibration Certificate';

export interface Document {
  /** Stable primary key. */
  id: string;
  /**
   * REQUIRED, and deliberately not optional.
   *
   * `true` marks the record as an illustrative placeholder — sample data
   * showing the shape of the archive, with no PDF behind it and with
   * invented issuer / analyst / standard / instrument metadata. Every
   * rendering surface seals placeholder records behind an "in preparation"
   * notice so they are never presented as issued quality records.
   *
   * A real, issued document must consciously set this to `false`. Keeping
   * the field required is the point: a future contributor cannot add a
   * record that silently reads as authentic.
   */
  isSamplePlaceholder: boolean;
  /**
   * Procurement abbreviation linking this document back to a product
   * family (e.g. "SEM", "TZP"). Mirrors `Product.abbreviation` from
   * Wave 7c so the documentation library can be reconciled against
   * the inventory by abbreviation.
   */
  productAbbreviation: string;
  /** Display name of the product family the document covers. */
  productName: string;
  /** Document classification (see `DocumentTypeLabel`). */
  documentType: string;
  /** Batch / lot identifier (e.g. "SEM-2026-031"). Tabular-nums display. */
  batchId: string;
  /** ISO 8601 calendar date the document was issued (YYYY-MM-DD). */
  issuedDate: string;
  /** Thumbnail URL — small document-page preview. Quiet imagery. */
  thumbnailUrl: string;

  // ── Archival metadata (R3) ──────────────────────────────────────────────
  // All fields optional. Populated per document where operationally known.

  /** Organization or division that issued the document. */
  issuer?: string;
  /** Name and role of the authorizing analyst or director. */
  issuedBy?: string;
  /** Total page count of the source document. */
  pageCount?: number;
  /** Approximate file size in kilobytes. */
  fileSizeKb?: number;
  /** ISO 8601 date on which the document expires or must be renewed. */
  expiresAt?: string;
  /** Document revision or version string (e.g. "Rev. A", "v2.1"). */
  documentVersion?: string;
  /** Regulatory or analytical standard the document was produced under. */
  standardReference?: string;
  /** ISO 8601 date the document was last reviewed by QC. */
  reviewedAt?: string;
  /** Instrument identifier for calibration certificates. */
  instrumentId?: string;
  /** Document control classification (e.g. "CONTROLLED", "SUPERSEDED"). */
  documentControlStatus?: string;
  /** Reference identifier of the document this revision supersedes, if any. */
  supersedes?: string;
}
