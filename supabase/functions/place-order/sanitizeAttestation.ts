// supabase/functions/place-order/sanitizeAttestation.ts
// Sanitizes the client-supplied research-use disclaimer acceptance into the
// snapshot stored on the orders row.
//
// Deliberately free of Deno globals and remote imports (like rewardVoucher.ts)
// so vitest can drive tests/unit/sanitizeAttestation.test.ts and tsc can
// typecheck it.

/** Shape of OrderPayload["research_attestation"] in index.ts — duplicated
 *  here (structurally identical) so this module has no dependency on
 *  index.ts and stays Deno-free / independently testable. */
export interface ResearchAttestationInput {
  accepted_at?: string;
  disclaimer_version?: number;
  industry?: string;
  age_21_confirmed?: boolean;
  research_use_confirmed?: boolean;
}

/** Declared-industry whitelist — must match INDUSTRY_OPTIONS in
 *  src/lib/researchAttestation.ts. Unknown values are stored as "other". */
const ATTESTATION_INDUSTRIES = new Set([
  "research_lab", "biotech_pharma", "academic", "b2b_distributor", "independent", "other",
]);

/** Sanitized attestation snapshot for the orders row, or null when the
 *  client sent nothing usable (older bundle / cleared storage) — NULL keeps
 *  the audit trail honest instead of fabricating an acceptance. */
function sanitizeAttestation(raw: ResearchAttestationInput | undefined): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const acceptedAtMs = Date.parse(typeof raw.accepted_at === "string" ? raw.accepted_at : "");
  if (Number.isNaN(acceptedAtMs)) return null;
  if (raw.age_21_confirmed !== true || raw.research_use_confirmed !== true) return null;
  const industryRaw = typeof raw.industry === "string" ? raw.industry.trim().slice(0, 40) : "";
  const version = typeof raw.disclaimer_version === "number" && Number.isFinite(raw.disclaimer_version)
    ? Math.max(1, Math.min(999, Math.round(raw.disclaimer_version)))
    : 1;
  return {
    accepted_at: new Date(acceptedAtMs).toISOString(),
    recorded_at: new Date().toISOString(),
    disclaimer_version: version,
    age_21_confirmed: true,
    research_use_confirmed: true,
    industry: ATTESTATION_INDUSTRIES.has(industryRaw) ? industryRaw : "other",
  };
}

export { ATTESTATION_INDUSTRIES, sanitizeAttestation };
