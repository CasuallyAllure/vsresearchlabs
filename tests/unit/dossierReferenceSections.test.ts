/**
 * The reference half of the Research Dossier.
 *
 * Four sections were added to a dossier that previously cited nothing:
 * References, FDA Resources, Chemical Properties, and Research History. Each
 * one is a claim about the outside world, so each one is fenced by the same
 * two rules the rest of this codebase already follows:
 *
 *   1. A section renders only when its data exists. A compound without the
 *      data shows nothing rather than an empty shell implying a gap in the
 *      page instead of a gap in the evidence.
 *   2. Nothing is synthesized to fill an absence. Every reference must carry a
 *      resolvable identifier; every FDA resource must live on a real
 *      FDA/NIH/ClinicalTrials host. A compound with no approved counterpart
 *      gets no links — that absence is the accurate statement about it.
 *
 * These tests pin both rules against the shipped catalog, not just synthetic
 * fixtures, so a future data edit that smuggles in an unidentified citation or
 * a hand-constructed FDA URL fails here.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  chemicalPropertyRows,
  deriveReferences,
  getCompoundIntelligence,
  researchHistoryRows,
} from '../../src/lib/compoundIntelligence';
import { extractNctId, referenceHref } from '../../src/types/product';
import type { Product, ProductStudy } from '../../src/types/product';

/**
 * The shipped catalog, read from disk rather than `import`ed.
 *
 * Both data files are large enough that letting TypeScript infer a literal
 * type for them inside the test project makes `tsc -b` pathologically slow —
 * the app narrows them once behind `as unknown as Product[]` for exactly this
 * reason. Reading and parsing at runtime keeps the assertions against the real
 * shipped data while costing the type-checker nothing.
 */
function loadCatalog(): Product[] {
  const read = (file: string): Product[] =>
    JSON.parse(
      readFileSync(new URL(`../../src/data/${file}`, import.meta.url), 'utf8'),
    ) as Product[];
  return [...read('biopeptideCompounds.generated.json'), ...read('products.json')];
}

const CATALOG = loadCatalog();

/**
 * Hosts a regulatory resource is permitted to point at. Deliberately an
 * allowlist of exact hosts rather than a suffix match: `fda.gov.evil.test`
 * ends with the right string and must not pass.
 */
const ALLOWED_RESOURCE_HOSTS = new Set([
  'www.accessdata.fda.gov',
  'dailymed.nlm.nih.gov',
  'clinicaltrials.gov',
  'www.fda.gov',
]);

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-compound',
    slug: 'testatide',
    name: 'Testatide — 5mg',
    specs: [],
    variants: [],
    images: [],
    ...overrides,
  } as unknown as Product;
}

function makeStudy(overrides: Partial<ProductStudy> = {}): ProductStudy {
  return {
    title: 'A Study of Testatide',
    source: 'Journal of Testing',
    year: 2024,
    model: 'human',
    ...overrides,
  } as ProductStudy;
}

// ─── References ────────────────────────────────────────────────────────────

describe('references', () => {
  test('derives one reference per study carrying a resolved identifier', () => {
    // Arrange
    const product = makeProduct({
      knownStudies: [makeStudy({ pmid: '37366315', title: 'Retatrutide for Obesity', source: 'NEJM', year: 2023 })],
    });

    // Act
    const references = deriveReferences(product, product.knownStudies!);

    // Assert
    expect(references).toEqual([
      { citation: 'Retatrutide for Obesity. NEJM, 2023.', pmid: '37366315', doi: undefined },
    ]);
  });

  test('omits studies with no identifier rather than citing them unverifiably', () => {
    // Arrange — a real study record, but nobody resolved it
    const product = makeProduct({ knownStudies: [makeStudy()] });

    // Act
    const references = deriveReferences(product, product.knownStudies!);

    // Assert
    expect(references).toEqual([]);
  });

  test('an explicitly authored reference list overrides the derivation', () => {
    // Arrange
    const authored = [{ citation: 'A monograph.', url: 'https://example.test/monograph' }];
    const product = makeProduct({
      references: authored,
      knownStudies: [makeStudy({ pmid: '37366315' })],
    });

    // Act
    const references = deriveReferences(product, product.knownStudies!);

    // Assert
    expect(references).toEqual(authored);
  });

  test('a compound with no studies exposes no references at all', () => {
    // Arrange / Act
    const ci = getCompoundIntelligence(makeProduct());

    // Assert
    expect(ci.references).toEqual([]);
  });

  test('every reference across the shipped catalog resolves to a real link', () => {
    // Arrange
    const references = CATALOG.flatMap((p) => getCompoundIntelligence(p).references);

    // Act
    const unresolvable = references.filter((r) => referenceHref(r) === null);

    // Assert — this is the whole point of the section; a citation nobody can
    // follow is the failure mode the audit found.
    expect(references.length).toBeGreaterThan(0);
    expect(unresolvable).toEqual([]);
  });

  test('reference links resolve by permanence: PMID, then DOI, then URL', () => {
    expect(referenceHref({ citation: 'x', pmid: '123', doi: '10.1/a', url: 'https://example.test' }))
      .toBe('https://pubmed.ncbi.nlm.nih.gov/123/');
    expect(referenceHref({ citation: 'x', doi: '10.1/a', url: 'https://example.test' }))
      .toBe('https://doi.org/10.1/a');
    expect(referenceHref({ citation: 'x', url: 'https://example.test' }))
      .toBe('https://example.test');
    expect(referenceHref({ citation: 'x' })).toBeNull();
  });
});

// ─── FDA resources ─────────────────────────────────────────────────────────

describe('fdaResources', () => {
  test('every catalog resource points at an allowlisted FDA / NIH / registry host', () => {
    // Arrange
    const resources = CATALOG.flatMap((p) => p.fdaResources ?? []);

    // Act
    const offHost = resources.filter((r) => !ALLOWED_RESOURCE_HOSTS.has(new URL(r.url).host));

    // Assert
    expect(resources.length).toBeGreaterThan(0);
    expect(offHost).toEqual([]);
  });

  test('every resource uses https and carries a label', () => {
    for (const resource of CATALOG.flatMap((p) => p.fdaResources ?? [])) {
      expect(new URL(resource.url).protocol).toBe('https:');
      expect(resource.label.trim().length).toBeGreaterThan(0);
    }
  });

  test('a resource host matches its declared kind', () => {
    // A DailyMed label filed under `drugs-at-fda` would misattribute the
    // source register to the reader, which is the point of showing it.
    const HOST_FOR_KIND: Record<string, string> = {
      'drugs-at-fda': 'www.accessdata.fda.gov',
      'dailymed': 'dailymed.nlm.nih.gov',
      'clinical-trial': 'clinicaltrials.gov',
      'fda-guidance': 'www.fda.gov',
    };
    for (const resource of CATALOG.flatMap((p) => p.fdaResources ?? [])) {
      expect(new URL(resource.url).host).toBe(HOST_FOR_KIND[resource.kind]);
    }
  });

  test('every clinical-trial resource links a well-formed NCT record', () => {
    const trials = CATALOG
      .flatMap((p) => p.fdaResources ?? [])
      .filter((r) => r.kind === 'clinical-trial');

    expect(trials.length).toBeGreaterThan(0);
    for (const trial of trials) {
      expect(trial.url).toMatch(/^https:\/\/clinicaltrials\.gov\/study\/NCT\d{8}$/);
    }
  });

  test('a compound with no approved counterpart carries no resources', () => {
    // Arrange / Act
    const ci = getCompoundIntelligence(makeProduct({ fdaStatus: 'Not approved — research use only' }));

    // Assert — the absence is the accurate statement, not a gap to fill
    expect(ci.fdaResources).toEqual([]);
  });

  test('resources reach the dossier view-model when present', () => {
    // Arrange
    const resource = {
      kind: 'dailymed' as const,
      label: 'DailyMed — Testatide',
      url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=abc',
    };

    // Act
    const ci = getCompoundIntelligence(makeProduct({ fdaResources: [resource] }));

    // Assert
    expect(ci.fdaResources).toEqual([resource]);
  });
});

// ─── Chemical properties ───────────────────────────────────────────────────

describe('chemical properties', () => {
  test('renders no rows when nothing was corroborated', () => {
    expect(chemicalPropertyRows(makeProduct())).toEqual([]);
    expect(getCompoundIntelligence(makeProduct()).hasChemicalProperties).toBe(false);
  });

  test('renders only the properties that were corroborated', () => {
    // Arrange — an appearance was sourced; a solubility figure was not
    const product = makeProduct({ appearance: 'White lyophilized powder.' });

    // Act
    const rows = chemicalPropertyRows(product);

    // Assert
    expect(rows).toEqual([{ label: 'Appearance', value: 'White lyophilized powder.' }]);
    expect(getCompoundIntelligence(product).hasChemicalProperties).toBe(true);
  });

  test('orders the rows appearance, solubility, stability', () => {
    const rows = chemicalPropertyRows(makeProduct({
      appearance: 'A',
      solubility: 'S',
      stability: 'T',
    }));
    expect(rows.map((r) => r.label)).toEqual(['Appearance', 'Solubility / Reconstitution', 'Stability']);
  });
});

// ─── Research history ──────────────────────────────────────────────────────

describe('research history', () => {
  test('renders no rows when nothing was corroborated', () => {
    expect(researchHistoryRows(makeProduct())).toEqual([]);
    expect(getCompoundIntelligence(makeProduct()).hasResearchHistory).toBe(false);
  });

  test('joins multiple development codes into one row', () => {
    // Arrange
    const product = makeProduct({ developmentCodes: ['LY3437943', 'GGG'] });

    // Act
    const rows = researchHistoryRows(product);

    // Assert
    expect(rows).toEqual([{ label: 'Development Codes', value: 'LY3437943 · GGG' }]);
  });

  test('an empty development-code array produces no row', () => {
    expect(researchHistoryRows(makeProduct({ developmentCodes: [] }))).toEqual([]);
  });

  test('surfaces discovery and originator when present', () => {
    const rows = researchHistoryRows(makeProduct({
      discovery: 'Isolated in 1985.',
      originator: 'Example Institute',
    }));
    expect(rows).toEqual([
      { label: 'Discovery / Origin', value: 'Isolated in 1985.' },
      { label: 'Originator', value: 'Example Institute' },
    ]);
  });
});

// ─── NCT extraction ────────────────────────────────────────────────────────

describe('NCT identifier extraction', () => {
  test('extracts an identifier embedded in free-text source prose', () => {
    expect(extractNctId('ClinicalTrials.gov trial registration NCT02039687')).toBe('NCT02039687');
  });

  test('tolerates a space after the NCT prefix and is case-insensitive', () => {
    expect(extractNctId('registered as nct 02225366')).toBe('NCT02225366');
  });

  test('rejects malformed identifiers rather than half-linking them', () => {
    expect(extractNctId('NCT1234567')).toBeNull();   // seven digits
    expect(extractNctId('NCT123456789')).toBeNull(); // nine digits
    expect(extractNctId('no identifier here')).toBeNull();
    expect(extractNctId(undefined)).toBeNull();
  });

  test('backfills a structured nctId onto studies whose source carries one', () => {
    // Arrange
    const product = makeProduct({
      knownStudies: [makeStudy({ source: 'ClinicalTrials.gov trial registration NCT02039687' })],
    });

    // Act
    const ci = getCompoundIntelligence(product);

    // Assert
    expect(ci.studies[0].nctId).toBe('NCT02039687');
  });

  test('never overwrites an explicit nctId with an extracted one', () => {
    // Arrange — hand-corrected data must win over the regex
    const product = makeProduct({
      knownStudies: [makeStudy({ nctId: 'NCT00000001', source: 'see NCT02039687' })],
    });

    // Act
    const ci = getCompoundIntelligence(product);

    // Assert
    expect(ci.studies[0].nctId).toBe('NCT00000001');
  });

  test('leaves studies with no identifier untouched', () => {
    const ci = getCompoundIntelligence(makeProduct({ knownStudies: [makeStudy()] }));
    expect(ci.studies[0].nctId).toBeUndefined();
  });
});
