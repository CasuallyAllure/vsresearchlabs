// @vitest-environment happy-dom
/**
 * The Research Intelligence Library's biological-system filter.
 *
 * Property under test: selecting a research domain narrows the library to
 * the compounds whose classification derives to that system, and clearing
 * it restores the full record. The dossier overlay is stubbed — this is a
 * filtering test, not an overlay test.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Research } from '../../src/pages/Research';
import { useProductStore } from '../../src/stores/productStore';
import { RESEARCH_DOMAIN_LABELS } from '../../src/lib/researchDomain';
import type { Product } from '../../src/types/product';

vi.mock('../../src/components/catalog/CompoundIntelligenceOverlay', () => ({
  CompoundIntelligenceOverlay: () => <div data-testid="dossier-overlay" />,
}));

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 'x',
    name: 'Compound',
    slug: 'compound',
    abbreviation: 'CMP',
    sku: 'VSR-PEP-CMP',
    family: 'Test Family',
    productType: 'peptide',
    category: 'peptides',
    shortDescription: 'Supplied as a lyophilized powder for laboratory research applications.',
    images: [],
    variants: [],
    ...overrides,
  } as Product;
}

const PRODUCTS: Product[] = [
  makeProduct({ id: 'reta', name: 'Retatrutide', slug: 'reta', sku: 'S1', researchClassification: 'incretin-metabolic-agonists' }),
  makeProduct({ id: 'bpc', name: 'BPC-157', slug: 'bpc', sku: 'S2', researchClassification: 'regenerative' }),
  makeProduct({ id: 'semax', name: 'Semax', slug: 'semax', sku: 'S3', researchClassification: 'nootropic-neuroactive' }),
];

const seeded = useProductStore.getState().products;

beforeEach(() => {
  useProductStore.setState({ products: PRODUCTS });
});

afterEach(() => {
  cleanup();
  useProductStore.setState({ products: seeded });
});

describe('biological-system filter on the research library', () => {
  test('shows every compound on record before a system is chosen', () => {
    // Arrange / Act
    render(<Research />);

    // Assert
    expect(screen.getByText('Retatrutide')).toBeTruthy();
    expect(screen.getByText('BPC-157')).toBeTruthy();
    expect(screen.getByText('Semax')).toBeTruthy();
  });

  test('choosing a system narrows the library to that system', () => {
    // Arrange
    render(<Research />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: new RegExp(RESEARCH_DOMAIN_LABELS['neurological'], 'i') }));

    // Assert
    expect(screen.getByText('Semax')).toBeTruthy();
    expect(screen.queryByText('Retatrutide')).toBeNull();
    expect(screen.queryByText('BPC-157')).toBeNull();
  });

  test('returning to all systems restores the full record', () => {
    // Arrange
    render(<Research />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(RESEARCH_DOMAIN_LABELS['neurological'], 'i') }));

    // Act
    fireEvent.click(screen.getByRole('button', { name: /all systems/i }));

    // Assert
    expect(screen.getByText('Retatrutide')).toBeTruthy();
    expect(screen.getByText('BPC-157')).toBeTruthy();
    expect(screen.getByText('Semax')).toBeTruthy();
  });

  test('the filter is labelled as a research domain, not an outcome', () => {
    // Arrange / Act
    render(<Research />);

    // Assert
    expect(screen.getByText(/research domain — biological system studied/i)).toBeTruthy();
  });
});
