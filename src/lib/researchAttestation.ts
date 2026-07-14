/**
 * researchAttestation — single source of truth for the research-use
 * disclaimer acceptance record.
 *
 * The DisclaimerGate writes a structured acceptance (timestamp + declared
 * industry) to localStorage; both checkout surfaces (CartDrawer + CartPage)
 * read it back and attach it to the place-order payload so every order
 * carries proof the buyer attested "21+, research use only" before
 * purchasing. The edge function re-sanitizes and stamps it server-side.
 *
 * The storage key is versioned (siteConfig.storage.disclaimerKey). Bumping
 * the key re-prompts every visitor once — done for v2 so the industry
 * declaration gets on record for existing visitors too.
 */

import { siteConfig } from '../config';

/** Bump when the gate's legal copy or required fields change. */
export const DISCLAIMER_VERSION = 2;

export interface IndustryOption {
  value: string;
  label: string;
}

/** Declared purchaser industry — whitelist shared with place-order. */
export const INDUSTRY_OPTIONS: IndustryOption[] = [
  { value: 'research_lab', label: 'Research laboratory' },
  { value: 'biotech_pharma', label: 'Biotech / pharmaceutical company' },
  { value: 'academic', label: 'Academic / university' },
  { value: 'b2b_distributor', label: 'B2B distributor / retailer' },
  { value: 'independent', label: 'Independent researcher / private business' },
  { value: 'other', label: 'Other professional use' },
];

export interface DisclaimerAcceptance {
  version: number;
  acceptedAt: string;
  industry: string;
  age21Confirmed: true;
  researchUseConfirmed: true;
}

const KEY = siteConfig.storage.disclaimerKey;

/** Persist the gate acceptance. Storage failures (private mode) are
 *  swallowed — the session still proceeds, there's just nothing to attach. */
export function writeDisclaimerAcceptance(industry: string): void {
  const record: DisclaimerAcceptance = {
    version: DISCLAIMER_VERSION,
    acceptedAt: new Date().toISOString(),
    industry,
    age21Confirmed: true,
    researchUseConfirmed: true,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* storage blocked — session-only acceptance */
  }
}

/** Read the stored acceptance, tolerating the legacy v1 value (a bare ISO
 *  timestamp string) and malformed data. */
export function readDisclaimerAcceptance(): DisclaimerAcceptance | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as DisclaimerAcceptance).acceptedAt === 'string' &&
      typeof (parsed as DisclaimerAcceptance).industry === 'string'
    ) {
      return parsed as DisclaimerAcceptance;
    }
    return null;
  } catch {
    return null;
  }
}

/** Attestation block for the place-order payload, or undefined when nothing
 *  is on record (server stores NULL — the trail stays honest). */
export function orderAttestationPayload():
  | {
      accepted_at: string;
      disclaimer_version: number;
      industry: string;
      age_21_confirmed: boolean;
      research_use_confirmed: boolean;
    }
  | undefined {
  const rec = readDisclaimerAcceptance();
  if (!rec) return undefined;
  return {
    accepted_at: rec.acceptedAt,
    disclaimer_version: rec.version,
    industry: rec.industry,
    age_21_confirmed: rec.age21Confirmed,
    research_use_confirmed: rec.researchUseConfirmed,
  };
}
