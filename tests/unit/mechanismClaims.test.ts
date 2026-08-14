/**
 * Data-integrity pins for uncited scientific prose.
 *
 * The citation-verification pass established that the hand-authored
 * `products.json` had shipped six citations to papers that do not exist. A
 * follow-up pass over the *uncited* prose in the same file found the same
 * failure mode in the mechanism fields, where it is harder to spot because
 * there is no citation to check:
 *
 *   - `KPV` carried melanocortin Ki values (50 nM / 200 nM) that appear
 *     nowhere in the literature, for receptors the primary sources
 *     affirmatively conclude KPV does *not* act through;
 *   - `TB-500` carried a G-actin Kd of "0.8 nM" — the published thymosin
 *     beta-9 figure with the unit silently changed from micromolar;
 *   - `Retatrutide` and `Tirzepatide` both carried "GIP-R (EC50 ~0.04 nM)",
 *     a single wrong number propagated across two compounds, in sets whose
 *     rank order inverted what the characterising papers actually report.
 *
 * These tests encode the two rules that would have caught all of it.
 */
import { describe, expect, test } from 'vitest';

import generatedCompounds from '../../src/data/biopeptideCompounds.generated.json';
import productRecords from '../../src/data/products.json';
import type { ProductStudy } from '../../src/types/product';

interface ClaimBearing {
  slug: string;
  name?: string;
  receptorActivity?: string;
  fdaStatus?: string;
  knownStudies?: ProductStudy[];
}

function allRecords(): ClaimBearing[] {
  return [
    ...(generatedCompounds as unknown as ClaimBearing[]),
    ...(productRecords as unknown as ClaimBearing[]),
  ];
}

/**
 * A binding or potency constant stated with a number and a concentration
 * unit — `EC50 ~0.04 nM`, `Ki = 50 nM`, `IC50 ~1.2 µM`. Matches the constant
 * and its value across intervening words ("EC50 of 1.3 ± 0.4 nmol/L") so a
 * reworded sentence cannot smuggle an unsourced figure past the scan.
 */
const POTENCY_CONSTANT_PATTERN =
  /\b(EC50|IC50|ED50|Ki|Kd)\b[^.;]{0,60}?[\d.]+\s*(?:±\s*[\d.]+\s*)?(?:n|p|µ|u|m)?(?:M|mol\/[Ll])/i;

function hasResolvableIdentifier(study: ProductStudy): boolean {
  return Boolean(study.pmid || study.doi || study.nctId);
}

function isCited(record: ClaimBearing): boolean {
  return (record.knownStudies ?? []).some(hasResolvableIdentifier);
}

describe('receptor potency constants are traceable', () => {
  /**
   * The regression that matters most. A published EC50/Ki/IC50 is a specific
   * measurement from a specific assay in a specific paper. A compound that
   * states one but cites nothing is asserting a number no reader can check —
   * exactly the shape of every fabrication found so far. A shorter, vaguer,
   * true sentence is always preferable to a specific unsourced one.
   */
  test('no compound states a potency constant without a resolvable study citation', () => {
    // Arrange
    const withConstant = allRecords().filter((record) =>
      POTENCY_CONSTANT_PATTERN.test(record.receptorActivity ?? ''),
    );

    // Act
    const uncited = withConstant.filter((record) => !isCited(record));

    // Assert
    expect(uncited.map((record) => record.slug)).toEqual([]);
  });

  test('the scan actually matches the potency syntax it is meant to police', () => {
    // Arrange — the exact strings this pass removed, plus a survivor form.
    const removed = [
      'Agonist at MC1R (melanocortin 1 receptor, Ki ~50 nM) and MC3R (Ki ~200 nM).',
      'Acts via G-actin sequestration (Kd ~0.8 nM for G-actin).',
      'GIP-R (EC50 ~0.04 nM), GLP-1R (EC50 ~0.02 nM), GCGR (EC50 ~1.1 nM).',
      'DAC modification enables albumin binding (Kd ~2 μM for HSA Cys-34)',
      'Primary: GLP-1R (high affinity, Ki ~0.5 nM).',
      'an EC50 of 1.3 ± 0.4 nmol/L',
      'reported IC50 ~1.2 µM',
    ];

    // Act & Assert
    for (const claim of removed) {
      expect(POTENCY_CONSTANT_PATTERN.test(claim)).toBe(true);
    }
  });

  test('qualitative receptor prose is not flagged as a potency constant', () => {
    // Arrange — the replacement text must be able to pass the scan.
    const qualitative = [
      'Agonist at GIP-R, GLP-1R and GCGR. The characterising study describes balanced GCGR and GLP-1R activity with greater GIP-R activity.',
      'Selective GHS-R1a (growth hormone secretagogue receptor 1a) agonist.',
      'Acts via G-actin sequestration rather than classical receptor–ligand binding.',
      'No established melanocortin receptor activity.',
    ];

    // Act & Assert
    for (const claim of qualitative) {
      expect(POTENCY_CONSTANT_PATTERN.test(claim)).toBe(false);
    }
  });
});

/**
 * Brand products named in `fdaStatus`, each mapped to the active ingredient
 * FDA's own records list for it. Verified against Drugs@FDA and DailyMed. A
 * compound may name a brand only when it *is* that brand's active ingredient
 * (allowing for the INN-vs-research-code synonyms noted below).
 */
const BRAND_ACTIVE_INGREDIENT: Record<string, string[]> = {
  Ozempic: ['semaglutide-5mg'],
  Wegovy: ['semaglutide-5mg'],
  Rybelsus: ['semaglutide-5mg'],
  Mounjaro: ['tirzepatide-10mg'],
  Zepbound: ['tirzepatide-10mg'],
  // afamelanotide is the INN for melanotan-1
  Scenesse: ['melanotan-1'],
  // bremelanotide is the INN for the research code PT-141
  Vyleesi: ['pt-141'],
  // elamipretide is the INN for the research code SS-31
  Forzinity: ['ss-31'],
  Egrifta: ['tesamorelin'],
  Geref: ['sermorelin'],
  Pitocin: ['oxytocin-acetate'],
  Carnitor: ['l-carnitine'],
  Ovidrel: ['hcg'],
  Menopur: ['hmg'],
  Genotropin: ['hgh'],
  Norditropin: ['hgh'],
  Zadaxin: ['thymosin-alpha-1'],
  Factrel: ['gonadorelin'],
  Lutrepulse: ['gonadorelin'],
};

describe('fdaStatus brand attributions', () => {
  test('every brand named is one the compound is actually the active ingredient of', () => {
    // Arrange
    const records = allRecords().filter((record) => record.fdaStatus);

    // Act — a brand appearing in a status it does not belong to.
    const misattributed = records.flatMap((record) =>
      Object.entries(BRAND_ACTIVE_INGREDIENT)
        .filter(([brand]) => new RegExp(`\\b${brand}\\b`).test(record.fdaStatus ?? ''))
        .filter(([, slugs]) => !slugs.includes(record.slug))
        .map(([brand]) => `${record.slug}: names ${brand}`),
    );

    // Assert
    expect(misattributed).toEqual([]);
  });

  /**
   * Originating-company names were removed from the catalog. `originator`
   * states that a compound came out of a pharmaceutical development program
   * without naming the firm, and no prose field names one either. The row
   * stays — only the attribution is generic.
   */
  test('no field names an originating pharmaceutical company', () => {
    // Arrange
    const COMPANIES = [
      'Eli Lilly',
      'Lilly',
      'Novo Nordisk',
      'Boehringer Ingelheim',
      'Innovent',
      'Stealth BioTherapeutics',
      'Araim',
      'Pfizer',
      'Sanofi',
      'Amgen',
      'AstraZeneca',
      'Genentech',
    ];

    // Act — every string field on every record, not just the curated ones.
    const named = allRecords().flatMap((record) =>
      Object.entries(record as Record<string, unknown>).flatMap(([field, value]) =>
        typeof value === 'string'
          ? COMPANIES.filter((co) => new RegExp(`\\b${co}\\b`, 'i').test(value)).map(
              (co) => `${record.slug}.${field}: names ${co}`,
            )
          : [],
      ),
    );

    // Assert
    expect(named).toEqual([]);
  });

  /**
   * The catalog no longer names consumer drug brands anywhere in fdaStatus.
   * A retail medicine name invites a human-use read of a research listing, so
   * the regulatory status states what the SUBSTANCE is approved as, never the
   * brand it is sold under. BRAND_ACTIVE_INGREDIENT is now the banned list
   * rather than an attribution map; the test above still catches a brand that
   * comes back on the wrong compound, and this one catches it coming back at
   * all.
   */
  test('no fdaStatus names a consumer drug brand', () => {
    // Arrange
    const records = allRecords().filter((record) => record.fdaStatus);

    // Act
    const named = records.flatMap((record) =>
      Object.keys(BRAND_ACTIVE_INGREDIENT)
        .filter((brand) => new RegExp(`\\b${brand}\\b`).test(record.fdaStatus ?? ''))
        .map((brand) => `${record.slug}: names ${brand}`),
    );

    // Assert
    expect(named).toEqual([]);
  });

  /**
   * Geref's US approval was withdrawn in 2009 after the sponsor discontinued
   * the product in 2008 — not, as the site previously stated, in 2002. The
   * date is pinned because a regulatory date that drifts is the same class of
   * error as a drifting citation.
   */
  test('the sermorelin regulatory history states the corrected dates', () => {
    // Arrange
    const sermorelin = allRecords().find((record) => record.slug === 'sermorelin');

    // Act
    const status = sermorelin?.fdaStatus ?? '';

    // Assert
    expect(status).toContain('2008');
    expect(status).toContain('2009');
    expect(status).not.toContain('2002');
  });
});
