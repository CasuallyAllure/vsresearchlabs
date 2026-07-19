/**
 * Source scan — the research-use (RUO) disclaimer has ONE source per runtime.
 *
 * Audit finding (docs/RESEARCH_CONTENT_SEPARATION_BLUEPRINT.md §2.3): the RUO
 * disclaimer was hardcoded across 20+ sites in 7 different wordings while
 * siteConfig.compliance — the canonical block — was read by almost nothing.
 * Edge-function email templates had drifted the same way, some dropping
 * "Not for Human Use", others dropping "or Veterinary".
 *
 * These tests are the ratchet against re-drift. They scan source rather than
 * behaviour because the property under test IS a source property: "the
 * literal exists in exactly one place". Precedent for a non-component test of
 * this shape: tests/unit/viteEnvGuard.test.ts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Disclaimer-shaped phrasings. Deliberately narrow: it must catch a
 * disclaimer someone re-typed, without catching per-product regulatory data
 * ("Not approved — research use only") or the code that classifies it.
 */
const DISCLAIMER_PHRASE =
  /(for research (use|purposes) only|not for human|human or veterinary|veterinary (use|consumption)|human consumption)/i;

/**
 * Files allowed to contain a literal RUO phrasing, each for a stated reason.
 * Adding an entry here is a deliberate act — the default is to read the
 * wording from siteConfig.compliance.
 */
const SRC_ALLOWLIST: Record<string, string> = {
  'src/config/clients/vsresearchlabs.ts':
    'THE source — every other frontend surface reads its wording from here.',
  'src/pages/legal/Terms.tsx':
    'Full multi-paragraph legal prose, deliberately verbatim.',
  'src/components/landing/LegalDisclaimer.tsx':
    'Full multi-paragraph legal prose, deliberately verbatim.',
  'src/components/brand/DisclaimerGate.tsx':
    'The attestation text itself, versioned by DISCLAIMER_VERSION and carrying ' +
    'inline emphasis markup. Editing it is a version bump, not a copy change.',
};

/** Strips block and line comments so doc-comment examples do not trip the scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(\/\/|\*).*$/gm, '');
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative path with forward slashes, so allowlist keys are portable. */
function rel(full: string): string {
  return relative(REPO_ROOT, full).split(sep).join('/');
}

describe('frontend RUO wordings are single-sourced from siteConfig.compliance', () => {
  test('no hardcoded disclaimer literal survives in src/ outside the allowlist', () => {
    // Arrange
    const files = walk(join(REPO_ROOT, 'src'), ['.ts', '.tsx']);

    // Act
    const offenders = files
      .map((full) => ({ path: rel(full), body: stripComments(readFileSync(full, 'utf8')) }))
      .filter(({ path, body }) => !(path in SRC_ALLOWLIST) && DISCLAIMER_PHRASE.test(body))
      .map(({ path }) => path);

    // Assert
    expect(offenders).toEqual([]);
  });

  test('every allowlisted file still exists — a stale exemption is a silent hole', () => {
    for (const path of Object.keys(SRC_ALLOWLIST)) {
      expect(() => statSync(join(REPO_ROOT, path))).not.toThrow();
    }
  });

  test('the surfaces that had no disclaimer now read one from the config', () => {
    // Arrange — the three §3.6 coverage gaps plus the understated drawer line.
    const expected: Record<string, string> = {
      'src/pages/CartPage.tsx': 'siteConfig.compliance.fullLine',
      'src/pages/TrackOrder.tsx': 'siteConfig.compliance.fullLine',
      'src/layout/CartDrawer.tsx': 'siteConfig.compliance.attestationLine',
    };

    // Act / Assert
    for (const [path, reference] of Object.entries(expected)) {
      const body = readFileSync(join(REPO_ROOT, path), 'utf8');
      expect(body, `${path} must render ${reference}`).toContain(reference);
    }
  });
});

describe('edge-function email disclaimers are single-sourced from emailBrand', () => {
  const FUNCTIONS_DIR = join(REPO_ROOT, 'supabase', 'functions');

  /**
   * Templates whose buyer-facing footer previously carried a re-typed
   * literal — some short-form, some already canonical.
   */
  const BUYER_EMAIL_TEMPLATES = [
    'supabase/functions/_shared/invoiceEmail.ts',
    'supabase/functions/send-contact/handler.ts',
    'supabase/functions/send-delivered-notification/handler.ts',
    'supabase/functions/send-inquiry/handler.ts',
    'supabase/functions/send-invite/handler.ts',
    'supabase/functions/send-processing-notification/handler.ts',
    'supabase/functions/send-receipt/handler.ts',
    'supabase/functions/send-shipment-notification/handler.ts',
  ];

  /**
   * Literal phrasings that remain, each deliberate and NOT a footer
   * disclaimer: the brand-stamp micro-line (its own typographic register,
   * pinned by placeOrderHandler.emails.test.ts) and the invoice terms prose.
   */
  const EMAIL_ALLOWLIST = new Set([
    'supabase/functions/place-order/handler.ts',
    'supabase/functions/_shared/emailBrand.ts',
    'supabase/functions/_shared/invoiceEmail.ts',
  ]);

  test('the canonical constant states research-use, human, and veterinary', async () => {
    const { RESEARCH_USE_DISCLAIMER } = await import(
      '../../supabase/functions/_shared/emailBrand.ts'
    );

    expect(RESEARCH_USE_DISCLAIMER).toBe(
      'For Research Purposes Only — Not for Human or Veterinary Use',
    );
  });

  test('every buyer email template imports and renders the shared constant', () => {
    for (const path of BUYER_EMAIL_TEMPLATES) {
      // Arrange
      const body = readFileSync(join(REPO_ROOT, path), 'utf8');

      // Assert
      expect(body, `${path} must import the shared disclaimer`).toMatch(
        /import \{[^}]*RESEARCH_USE_DISCLAIMER[^}]*\} from ".*emailBrand\.ts";/,
      );
      expect(body, `${path} must render the shared disclaimer`).toContain(
        '${RESEARCH_USE_DISCLAIMER}',
      );
    }
  });

  test('no short-form disclaimer literal survives in supabase/functions', () => {
    // Arrange
    const files = walk(FUNCTIONS_DIR, ['.ts']);

    // Act
    const offenders = files
      .map((full) => ({ path: rel(full), body: readFileSync(full, 'utf8') }))
      .filter(({ path, body }) => !EMAIL_ALLOWLIST.has(path) && DISCLAIMER_PHRASE.test(body))
      .map(({ path }) => path);

    // Assert
    expect(offenders).toEqual([]);
  });
});
