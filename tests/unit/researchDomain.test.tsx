// @vitest-environment happy-dom
/**
 * Research-domain grouping + the Research Intelligence Library's density
 * picker.
 *
 * Three properties are pinned here:
 *
 *  1. the derivation is TOTAL — every `ResearchClassification` resolves to
 *     exactly one biological system, so a new classification cannot ship
 *     without a deliberate mapping decision;
 *  2. the library's layout picker actually changes the tile variant, and
 *     the education-tile contract (no commerce controls) survives every
 *     density;
 *  3. the domain copy stays in the site's research register — third
 *     person, hedged, no outcome language.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { ResearchCompoundGrid } from '../../src/components/catalog/ResearchCompoundGrid';
import {
  CLASSIFICATION_TO_DOMAIN,
  RESEARCH_DOMAIN_DESCRIPTIONS,
  RESEARCH_DOMAIN_LABELS,
  RESEARCH_DOMAIN_ORDER,
  RESEARCH_DOMAIN_SHORT_LABELS,
  researchDomainFor,
  domainClassifications,
  type ResearchDomain,
} from '../../src/lib/researchDomain';
import type { Product, ResearchClassification } from '../../src/types/product';

/** The full classification union, restated so the test fails loudly when a
 *  new member is added to the type but not to the mapping. */
const ALL_CLASSIFICATIONS: ResearchClassification[] = [
  'incretin-metabolic-agonists',
  'gh-secretagogue',
  'growth-factor-anabolic',
  'metabolic-cofactor',
  'regenerative',
  'nootropic-neuroactive',
  'bioregulator',
  'immunomodulatory',
  'reproductive-hormonal',
  'antioxidant-beauty',
  'experimental',
];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'compound-a',
    name: 'Testatide',
    slug: 'testatide',
    abbreviation: 'TST',
    sku: 'VSR-PEP-TST',
    family: 'Test Family',
    productType: 'peptide',
    category: 'peptides',
    shortDescription: 'Supplied as a lyophilized powder for laboratory research applications.',
    images: [],
    variants: [],
    ...overrides,
  } as Product;
}

afterEach(cleanup);

describe('classification → biological system derivation', () => {
  test('every research classification maps to exactly one system', () => {
    // Arrange
    const mapped = Object.keys(CLASSIFICATION_TO_DOMAIN).sort();

    // Act
    const expected = [...ALL_CLASSIFICATIONS].sort();

    // Assert
    expect(mapped).toEqual(expected);
    for (const classification of ALL_CLASSIFICATIONS) {
      const domain = CLASSIFICATION_TO_DOMAIN[classification];
      expect(RESEARCH_DOMAIN_ORDER).toContain(domain);
    }
  });

  test('each mapped system appears in exactly one bucket per classification', () => {
    // Arrange
    const buckets = RESEARCH_DOMAIN_ORDER.flatMap((d) => domainClassifications(d));

    // Act
    const unique = new Set(buckets);

    // Assert — no classification is counted under two systems, none is lost
    expect(buckets).toHaveLength(ALL_CLASSIFICATIONS.length);
    expect(unique.size).toBe(ALL_CLASSIFICATIONS.length);
  });

  test('a record with no classification resolves to the exploratory system', () => {
    // Arrange / Act
    const domain = researchDomainFor(undefined);

    // Assert
    expect(domain).toBe('exploratory');
  });

  test('a known classification resolves to its documented system', () => {
    // Arrange / Act / Assert
    expect(researchDomainFor('incretin-metabolic-agonists')).toBe('metabolic-endocrine');
    expect(researchDomainFor('nootropic-neuroactive')).toBe('neurological');
    expect(researchDomainFor('regenerative')).toBe('musculoskeletal-tissue');
  });

  test('every system carries a label, a short label and a description', () => {
    // Arrange / Act / Assert
    for (const domain of RESEARCH_DOMAIN_ORDER) {
      expect(RESEARCH_DOMAIN_LABELS[domain].length).toBeGreaterThan(0);
      expect(RESEARCH_DOMAIN_SHORT_LABELS[domain].length).toBeGreaterThan(0);
      expect(RESEARCH_DOMAIN_DESCRIPTIONS[domain].length).toBeGreaterThan(0);
    }
  });
});

describe('research-domain copy register', () => {
  const COPY: string[] = [
    ...RESEARCH_DOMAIN_ORDER.map((d: ResearchDomain) => RESEARCH_DOMAIN_LABELS[d]),
    ...RESEARCH_DOMAIN_ORDER.map((d: ResearchDomain) => RESEARCH_DOMAIN_SHORT_LABELS[d]),
    ...RESEARCH_DOMAIN_ORDER.map((d: ResearchDomain) => RESEARCH_DOMAIN_DESCRIPTIONS[d]),
  ];

  const BANNED: { label: string; pattern: RegExp }[] = [
    { label: 'second person', pattern: /\b(you|your|yours|yourself)\b/i },
    { label: 'outcome/effect language', pattern: /\b(effects?|benefits?|results?|boosts?|burns?|improves?|enhances?|increases? your)\b/i },
    { label: 'treatment claim', pattern: /\b(treats?|cures?|heals? you|prevents?|therapy for)\b/i },
    { label: 'human-use framing', pattern: /\b(dose yourself|take (it|this)|your body|in humans)\b/i },
  ];

  test('no system label or description uses second-person or outcome language', () => {
    // Arrange
    const offences: string[] = [];

    // Act
    for (const line of COPY) {
      for (const { label, pattern } of BANNED) {
        if (pattern.test(line)) offences.push(`${label}: "${line}"`);
      }
    }

    // Assert
    expect(offences).toEqual([]);
  });

  test('every system description uses the hedged research register', () => {
    // Arrange / Act / Assert
    for (const domain of RESEARCH_DOMAIN_ORDER) {
      expect(RESEARCH_DOMAIN_DESCRIPTIONS[domain]).toMatch(/studied|investigated|research/i);
    }
  });
});

describe('research library density', () => {
  const products = [
    makeProduct({ id: 'a', name: 'Alphatide', researchClassification: 'regenerative' }),
    makeProduct({ id: 'b', name: 'Betatide', researchClassification: 'nootropic-neuroactive' }),
  ];

  function renderGrid(density: 'detail' | 'standard' | 'compact') {
    return render(
      <ResearchCompoundGrid products={products} loading={false} error={null} density={density} />,
    );
  }

  test('detail density renders the full detail tile', () => {
    // Arrange / Act
    renderGrid('detail');

    // Assert
    expect(screen.getAllByTestId('research-tile-detail')).toHaveLength(2);
    expect(screen.queryByTestId('research-tile-compact')).toBeNull();
  });

  test('grid density renders the tightened card variant', () => {
    // Arrange / Act
    renderGrid('standard');

    // Assert
    expect(screen.getAllByTestId('research-tile-standard')).toHaveLength(2);
    expect(screen.queryByTestId('research-tile-detail')).toBeNull();
  });

  test('dense density renders compact index rows', () => {
    // Arrange / Act
    renderGrid('compact');

    // Assert
    expect(screen.getAllByTestId('research-tile-compact')).toHaveLength(2);
    expect(screen.queryByTestId('research-tile-detail')).toBeNull();
  });

  test('the biological system is shown on the tile at every density', () => {
    // Arrange / Act / Assert
    for (const density of ['detail', 'standard', 'compact'] as const) {
      cleanup();
      renderGrid(density);
      const chips = screen.getAllByTestId('research-domain-chip');
      expect(chips).toHaveLength(2);
      expect(chips[0].textContent).toBe(RESEARCH_DOMAIN_SHORT_LABELS['musculoskeletal-tissue']);
    }
  });

  test('no commerce control renders on the research tile at any density', () => {
    // Arrange
    const COMMERCE = /add to inquiry|add to cart|\badd\b|quantity|in stock|out of stock|buy/i;

    // Act / Assert
    for (const density of ['detail', 'standard', 'compact'] as const) {
      cleanup();
      const { container } = renderGrid(density);
      const buttons = Array.from(container.querySelectorAll('button'));
      // The tile itself is the only button — it opens the dossier.
      expect(buttons).toHaveLength(2);
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).toMatch(/intelligence dossier/i);
      }
      expect(container.querySelector('select')).toBeNull();
      expect(container.querySelector('input')).toBeNull();
      expect(COMMERCE.test(container.textContent ?? '')).toBe(false);
    }
  });
});
