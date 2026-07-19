/**
 * SiteConfig — the white-label client contract.
 *
 * Every brand/business-specific DISPLAY value the frontend renders lives
 * behind this type. A new client site = a new profile in ./clients/ plus
 * the per-client surfaces that cannot read TypeScript (index.html head,
 * public/ assets, sitemap/robots/webmanifest, theme.css palette, catalog
 * data, legal prose, and env vars). See docs/WHITE_LABEL_GUIDE.md.
 *
 * Secrets NEVER belong here — they stay in env (.env / Supabase secrets).
 */

export interface SiteConfig {
  brand: {
    /** Full accessible brand name, e.g. "VS Research Labs". */
    name: string;
    /** Short brand code for tight UI (admin header on phones), e.g. "VSR". */
    shortCode: string;
    /** Visible wordmark text (the mark may carry part of the name). */
    wordmark: string;
    /** Category tagline rendered under the wordmark. */
    tagline: string;
    /** Entity named in the footer copyright line. */
    legalEntity: string;
    /** Operations/positioning line (Contact page "Operations" block). */
    operationsLine: string;
    /** Micro caption on the document stamp (region/grade cue). */
    stampCaption: string;
  };

  seo: {
    /** <title> for the home route; brand.name is the fallback elsewhere. */
    defaultTitle: string;
  };

  contact: {
    /** Public inquiry mailbox shown on Contact/Track pages (display only —
     *  the sending/receiving addresses are env vars on the edge functions). */
    inquiryEmail: string;
    /** Official site host shown in anti-phishing copy, e.g. "vsresearchlabs.com". */
    officialHost: string;
  };

  compliance: {
    /** Footer legal line. */
    footerLine: string;
    /** Two-line caption in the mobile nav drawer. */
    navLines: readonly [string, string];
    /** Micro disclaimer on the BrandStamp SVG. */
    stampLine: string;
    /** Line under the accept button on the entry DisclaimerGate. */
    gateLine: string;
    /** Sentence on printable/track documents (follows the inquiry email). */
    documentLine: string;
    /** Short header tag on the tracking document. */
    shortLine: string;
    /**
     * Full buyer-facing disclaimer. The canonical long form — use this on any
     * standalone compliance notice that has room for it (contact, catalog
     * modal, checkout, tracking).
     */
    fullLine: string;
    /**
     * Restatement of the entry-gate attestation, for surfaces that rely on an
     * acceptance the buyer already gave (checkout confirm, order summary).
     * MUST NOT claim more than DisclaimerGate actually collected: 21+,
     * research-use-only, not for human or veterinary use.
     */
    attestationLine: string;
    /**
     * Second-person restatement for surfaces that submit the stored
     * attestation without re-collecting a checkbox (CartPage submit).
     * Same substance as attestationLine — it must not add new claims.
     */
    attestationRestatement: string;
    /** Internal/admin chrome variant — no buyer-facing claim. */
    internalLine: string;
    /** Two stacked micro-lines etched on the specimen vial artwork. */
    specimenLines: readonly [string, string];
    /** B2B "research only" paragraph on the landing intro module. */
    researchOnlyParagraph: string;
  };

  order: {
    /** Intake channel code stamped on inquiry/order records. */
    intakeChannel: string;
    /** Processing node code stamped on inquiry/order records. */
    processingNode: string;
    /** Placeholder hinting the order-number format on /track. */
    trackingPlaceholder: string;
  };

  /**
   * localStorage keys. Changing a value for an EXISTING deployment wipes
   * that client's persisted carts/themes/catalog cache — set once per
   * client, then treat as frozen. themeKey must match the inline boot
   * script in index.html.
   */
  storage: {
    productsKey: string;
    cartKey: string;
    themeKey: string;
    disclaimerKey: string;
  };
}
