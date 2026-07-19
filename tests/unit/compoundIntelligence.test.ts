/**
 * Unit tests for src/lib/compoundIntelligence.ts.
 *
 * This is the single selector that normalizes a canonical `Product` into the
 * compound-intelligence view-model the landing hero + overlay render. It is a
 * pure module (no React, no I/O), so it tests directly. The invariant that
 * matters: nothing is invented — every field is read from product data or
 * parsed from documented prose. These tests pin the parsing (receptor
 * potencies, substance/dose split), the study-derived aggregations (outcomes,
 * human-trial inference, newest-first sort), and the empty-data degradations.
 */
import { describe, expect, test } from 'vitest';
import {
  getCompoundIntelligence,
  substanceName,
  parseReceptorTargets,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_DEFINITIONS,
  CLASSIFICATION_LAYMAN,
  CLASSIFICATION_SECTION_BLURB,
  CLASSIFICATION_ORDER,
} from '../../src/lib/compoundIntelligence';
import type { Product, ProductStudy, ResearchClassification } from '../../src/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'retatrutide',
    name: 'Retatrutide — 5mg',
    category: 'biopeptide-research-supplies',
    shortDescription: 'Short blurb.',
    longDescription: 'First paragraph explanation.\n\nResearch use only.',
    images: ['/img/reta.webp'],
    specs: [
      { label: 'Purity (HPLC)', value: '≥99%' },
      { label: 'Form', value: 'Lyophilized' },
      { label: 'Irrelevant', value: 'skip me' },
    ],
    sku: 'VSR-PEP-RETA',
    abbreviation: 'RETA',
    family: 'Triple Agonist',
    variants: [{ dose: '5mg' }, { dose: '10mg' }],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('substanceName', () => {
  test('strips an em-dash dose suffix', () => {
    expect(substanceName('Retatrutide — 5mg')).toBe('Retatrutide');
  });

  test('strips an en-dash dose suffix', () => {
    expect(substanceName('BPC-157 – 10mg')).toBe('BPC-157');
  });

  test('strips a hyphen-with-spaces suffix but keeps internal hyphens', () => {
    expect(substanceName('CJC-1295 - 2mg')).toBe('CJC-1295');
  });

  test('returns the name unchanged when there is no separator', () => {
    expect(substanceName('Vortex Mixer')).toBe('Vortex Mixer');
  });
});

describe('parseReceptorTargets', () => {
  test('returns [] for undefined prose', () => {
    expect(parseReceptorTargets(undefined)).toEqual([]);
  });

  test('returns [] when the prose carries no parenthesised potencies', () => {
    expect(parseReceptorTargets('Acts broadly on the incretin axis.')).toEqual([]);
  });

  test('parses multiple receptor/EC50 pairs', () => {
    const out = parseReceptorTargets('GIP-R (EC50 ~0.04 nM), GLP-1R (EC50 ~0.02 nM)');
    expect(out).toEqual([
      { receptor: 'GIP-R', ec50: '~0.04 nM' },
      { receptor: 'GLP-1R', ec50: '~0.02 nM' },
    ]);
  });
});

describe('getCompoundIntelligence', () => {
  test('splits substance and active dose from the product name', () => {
    const vm = getCompoundIntelligence(makeProduct());
    expect(vm.substance).toBe('Retatrutide');
    expect(vm.activeDose).toBe('5mg');
  });

  test('maps a known classification to its canonical label', () => {
    const vm = getCompoundIntelligence(
      makeProduct({ researchClassification: 'incretin-metabolic-agonists' }),
    );
    expect(vm.classificationLabel).toBe('Incretin & Metabolic Receptor Agonists');
  });

  test('falls back to family when no classification is set', () => {
    const vm = getCompoundIntelligence(makeProduct({ researchClassification: undefined }));
    expect(vm.classificationLabel).toBe('Triple Agonist');
  });

  test('keeps only the whitelisted analytical spec rows, then appends CAS/MW', () => {
    const vm = getCompoundIntelligence(
      makeProduct({
        casNumber: '2381089-83-2',
        molecularWeight: '4731 g/mol',
        testingStandard: 'HPLC VSR-QC-001',
      }),
    );
    expect(vm.analytical).toEqual([
      { label: 'Purity (HPLC)', value: '≥99%' },
      { label: 'Form', value: 'Lyophilized' },
      { label: 'CAS Number', value: '2381089-83-2' },
      { label: 'Molecular Weight', value: '4731 g/mol' },
    ]);
  });

  test('omits testingStandard from the analytical rows — it is procurement metadata', () => {
    const vm = getCompoundIntelligence(makeProduct({ testingStandard: 'HPLC VSR-QC-001' }));
    expect(vm.analytical.map((r) => r.label)).not.toContain('Testing Standard');
  });

  test('prefers laymanSummary over the description fallback', () => {
    const vm = getCompoundIntelligence(makeProduct({ laymanSummary: 'The easy version.' }));
    expect(vm.summary).toBe('The easy version.');
  });

  test('falls back to the first long-description paragraph for the summary', () => {
    const vm = getCompoundIntelligence(makeProduct({ laymanSummary: undefined }));
    expect(vm.summary).toBe('First paragraph explanation.');
  });

  test('falls back to the short description when there is no long description', () => {
    const vm = getCompoundIntelligence(
      makeProduct({ laymanSummary: undefined, longDescription: '' }),
    );
    expect(vm.summary).toBe('Short blurb.');
  });

  test('summary is undefined when no prose exists at all', () => {
    const vm = getCompoundIntelligence(
      makeProduct({ laymanSummary: undefined, longDescription: '', shortDescription: '' }),
    );
    expect(vm.summary).toBeUndefined();
  });

  test('flags molecular intelligence when any mechanistic field is present', () => {
    expect(getCompoundIntelligence(makeProduct({ mechanismSummary: 'x' })).hasMolecularIntelligence).toBe(true);
    expect(getCompoundIntelligence(makeProduct({ receptorActivity: 'x' })).hasMolecularIntelligence).toBe(true);
    expect(getCompoundIntelligence(makeProduct({ pathwaySummary: 'x' })).hasMolecularIntelligence).toBe(true);
    expect(getCompoundIntelligence(makeProduct()).hasMolecularIntelligence).toBe(false);
  });

  test('sorts studies newest-first and reflects hasStudies', () => {
    const studies: ProductStudy[] = [
      { title: 'Old', source: 'X', year: 2019, model: 'rat' },
      { title: 'New', source: 'Y', year: 2024, model: 'human' },
    ];
    const vm = getCompoundIntelligence(makeProduct({ knownStudies: studies }));
    expect(vm.studies.map((s) => s.year)).toEqual([2024, 2019]);
    expect(vm.hasStudies).toBe(true);
  });

  test('hasStudies is false and studies empty when none are recorded', () => {
    const vm = getCompoundIntelligence(makeProduct({ knownStudies: undefined }));
    expect(vm.studies).toEqual([]);
    expect(vm.hasStudies).toBe(false);
  });

  test('infers human trials from a human-model study when the flag is unset', () => {
    const vm = getCompoundIntelligence(
      makeProduct({
        humanTrialsConfirmed: undefined,
        knownStudies: [{ title: 'T', source: 'S', year: 2024, model: 'human' }],
      }),
    );
    expect(vm.humanTrials).toBe(true);
  });

  test('honors an explicit humanTrialsConfirmed flag over study inference', () => {
    const vm = getCompoundIntelligence(
      makeProduct({
        humanTrialsConfirmed: true,
        knownStudies: [{ title: 'T', source: 'S', year: 2020, model: 'rat' }],
      }),
    );
    expect(vm.humanTrials).toBe(true);
  });

  test('humanTrials is false with no flag and only preclinical studies', () => {
    const vm = getCompoundIntelligence(
      makeProduct({
        humanTrialsConfirmed: undefined,
        knownStudies: [{ title: 'T', source: 'S', year: 2020, model: 'rat' }],
      }),
    );
    expect(vm.humanTrials).toBe(false);
  });

  test('leads physiological outcomes with human-trial findings, then dedupes', () => {
    const studies: ProductStudy[] = [
      { title: 'Rat', source: 'S', year: 2022, model: 'rat', notes: ['• Reduced body weight'] },
      { title: 'Human', source: 'S', year: 2021, model: 'human', notes: ['Reduced body weight', 'Improved glycemic control'] },
    ];
    const vm = getCompoundIntelligence(makeProduct({ knownStudies: studies }));
    // Human findings sort first; the rat's duplicate "Reduced body weight" dedupes out.
    expect(vm.physiologicalOutcome).toEqual(['Reduced body weight', 'Improved glycemic control']);
  });

  test('strips leading bullet markers from outcome notes', () => {
    const studies: ProductStudy[] = [
      { title: 'H', source: 'S', year: 2021, model: 'human', notes: ['- Increased lean mass'] },
    ];
    const vm = getCompoundIntelligence(makeProduct({ knownStudies: studies }));
    expect(vm.physiologicalOutcome).toEqual(['Increased lean mass']);
  });

  test('caps physiological outcomes at five entries', () => {
    // Dedupe key strips non-letters, so the notes must differ in LETTERS.
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    const notes = words.map((w) => `Improved ${w} response`);
    const studies: ProductStudy[] = [{ title: 'H', source: 'S', year: 2021, model: 'human', notes }];
    const vm = getCompoundIntelligence(makeProduct({ knownStudies: studies }));
    expect(vm.physiologicalOutcome).toHaveLength(5);
  });

  test('parses receptor targets from the product receptorActivity prose', () => {
    const vm = getCompoundIntelligence(
      makeProduct({ receptorActivity: 'GLP-1R (EC50 ~0.02 nM)' }),
    );
    expect(vm.receptorTargets).toEqual([{ receptor: 'GLP-1R', ec50: '~0.02 nM' }]);
  });

  test('surfaces the first image as the specimen image and variants as tiers', () => {
    const vm = getCompoundIntelligence(makeProduct());
    expect(vm.specimenImage).toBe('/img/reta.webp');
    expect(vm.tiers).toEqual([{ dose: '5mg' }, { dose: '10mg' }]);
  });

  test('tiers degrade to [] when variants is absent', () => {
    // variants is required on Product; force the absent path the selector guards.
    const vm = getCompoundIntelligence(
      makeProduct({ variants: undefined as unknown as Product['variants'] }),
    );
    expect(vm.tiers).toEqual([]);
  });
});

describe('classification tables', () => {
  test('every ResearchClassification has a label, definition, layman, blurb, and order slot', () => {
    for (const key of CLASSIFICATION_ORDER) {
      const k = key as ResearchClassification;
      expect(CLASSIFICATION_LABELS[k]).toBeTypeOf('string');
      expect(CLASSIFICATION_DEFINITIONS[k]).toBeTypeOf('string');
      expect(CLASSIFICATION_LAYMAN[k]).toBeTypeOf('string');
      expect(CLASSIFICATION_SECTION_BLURB[k]).toBeTypeOf('string');
    }
  });

  test('the display order lists every classification exactly once', () => {
    const labelKeys = Object.keys(CLASSIFICATION_LABELS).sort();
    expect([...CLASSIFICATION_ORDER].sort()).toEqual(labelKeys);
    expect(new Set(CLASSIFICATION_ORDER).size).toBe(CLASSIFICATION_ORDER.length);
  });
});
