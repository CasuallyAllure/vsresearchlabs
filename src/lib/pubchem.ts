/**
 * pubchem — resolve a compound's 2D structure image URL.
 *
 * PubChem PUG REST resolves most small molecules by name, but peptides and
 * code-named research compounds (Retatrutide, etc.) return 404 by name and
 * are only reachable by CID. This module prefers a curated CID when we have
 * one, and falls back to name resolution otherwise.
 *
 * To add a compound: look up its CID once
 *   https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pccompound&term=<name>
 * verify the title
 *   https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/<CID>/property/Title/JSON
 * then add a lowercased-name → CID entry below.
 */

/** Lowercased substance name → verified PubChem CID. Extend as needed.
 *  Every entry below was checked against the CID's PubChem Title so we never
 *  render the wrong molecule (the by-name search happily returns impurities
 *  and analogs — e.g. searching "Retatrutide" top-hits an impurity). Most of
 *  the catalog resolves by name and needs no entry here; these are the
 *  peptides/code-named compounds that 404 by name. */
export const PUBCHEM_CID_BY_NAME: Record<string, number> = {
  // Retatrutide (LY3437943) — "Triple G", GIP/GLP-1/glucagon triple agonist.
  retatrutide: 171390338,
  // CJC-1295 (with DAC) — Title "Cjc 1295", C165H269N47O46.
  'cjc-1295 dac': 91971820,
  // Thymosin α-1 — Title "Thymalfasin", C129H215N33O55.
  'thymosin α-1': 16130571,
  // 5-Amino-1MQ — Title "5-Amino-1-methylquinolinium".
  '5-amino-1mq': 950107,
};

/** 2D-structure PNG URL for a compound — CID when known, else by name. */
export function pubchemImageUrl(
  substance: string,
  opts?: { size?: 'large' | 'small' },
): string {
  const size = opts?.size ?? 'large';
  const cid = PUBCHEM_CID_BY_NAME[substance.trim().toLowerCase()];
  const base = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
  const selector = cid ? `cid/${cid}` : `name/${encodeURIComponent(substance)}`;
  return `${base}/${selector}/PNG?record_type=2d&image_size=${size}`;
}
