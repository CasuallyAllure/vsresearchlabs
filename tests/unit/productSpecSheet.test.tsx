// @vitest-environment happy-dom
/**
 * Unit tests for ProductPage as a laboratory specification sheet.
 *
 * The properties under test are the A/B split from the research content
 * separation blueprint:
 *
 *   - the analytical specification (purity/form/mass) is rendered on the
 *     product page, which it previously never was;
 *   - rows whose source field is absent are omitted, never printed empty;
 *   - all scientific discussion (mechanism, receptor, pathway, studies)
 *     has left the page and is reachable only through the shared research
 *     dossier overlay;
 *   - the long description renders exactly once.
 *
 * The shared CompoundIntelligenceOverlay is mocked with a stub so the
 * tests can assert *which* compound the dossier opens for without pulling
 * the whole overlay (and its 3D/specimen tree) into the test process.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProductPage } from '../../src/pages/ProductPage';
import { useProductStore } from '../../src/stores/productStore';
import type { Product } from '../../src/types/product';

vi.mock('../../src/components/catalog/CompoundIntelligenceOverlay', () => ({
  CompoundIntelligenceOverlay: ({ product }: { product: Product }) => (
    <div data-testid="dossier-overlay">{`dossier:${product.id}`}</div>
  ),
}));

vi.mock('../../src/components/catalog/specimen/CompoundVisualZone', () => ({
  CompoundVisualZone: () => <div data-testid="visual-zone" />,
}));

const LONG_DESCRIPTION = 'Supplied as a lyophilized powder for laboratory research applications.';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-compound',
    name: 'Testatide — 5mg',
    slug: 'testatide',
    abbreviation: 'TST',
    sku: 'VSR-PEP-TST',
    family: 'Triple Agonist',
    category: 'biopeptide-research-supplies',
    price: 110,
    priceCents: 11000,
    stock: 12,
    images: [],
    specs: [
      { label: 'Purity (HPLC)', value: '≥ 98%' },
      { label: 'Form', value: 'Lyophilized powder' },
      { label: 'Mass', value: '5 mg / vial' },
      { label: 'Storage', value: '−20°C, desiccated' },
    ],
    shortDescription: 'Short blurb.',
    longDescription: LONG_DESCRIPTION,
    laymanSummary: 'The plain-language version of what this compound does.',
    mechanismSummary: 'Binds the receptor and activates downstream signaling.',
    receptorActivity: 'GLP-1R (EC50 ~0.02 nM)',
    pathwaySummary: 'Signals through the cAMP-PKA axis.',
    knownStudies: [
      { source: 'Journal of Test Research', year: 2024, model: 'rodent', notes: ['A documented finding.'] },
    ],
    storageCondition: '−20°C, desiccated',
    shippingCondition: 'Ambient',
    leadTimeDays: 3,
    testingStandard: 'HPLC',
    variants: [{ dose: '5mg' }],
    ...overrides,
  } as unknown as Product;
}

function renderProductPage(product: Product) {
  useProductStore.setState({ products: [product] });
  return render(
    <MemoryRouter initialEntries={[`/product/${product.id}`]}>
      <Routes>
        <Route path="/product/:id" element={<ProductPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const seededProducts = useProductStore.getState().products;

beforeEach(() => {
  useProductStore.setState({ products: seededProducts });
});

afterEach(() => {
  cleanup();
  useProductStore.setState({ products: seededProducts });
});

describe('ProductPage analytical specifications', () => {
  test('renders the purity, form and mass specification rows', () => {
    // Arrange
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getByText('Purity (HPLC)')).toBeDefined();
    expect(screen.getByText('≥ 98%')).toBeDefined();
    expect(screen.getByText('Form')).toBeDefined();
    expect(screen.getByText('Lyophilized powder')).toBeDefined();
    expect(screen.getByText('Mass')).toBeDefined();
    expect(screen.getByText('5 mg / vial')).toBeDefined();
  });

  test('omits specification rows whose field is absent instead of rendering an empty row', () => {
    // Arrange — only purity is documented.
    const product = makeProduct({ specs: [{ label: 'Purity (HPLC)', value: '≥ 98%' }] });

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getByText('Purity (HPLC)')).toBeDefined();
    expect(screen.queryByText('Form')).toBeNull();
    expect(screen.queryByText('Mass')).toBeNull();
    expect(document.body.textContent).not.toContain('undefined');
  });

  test('omits the CAS and molecular weight identifiers when the compound has none', () => {
    // Arrange — 14 of the 50 generated compounds carry neither.
    const product = makeProduct({ casNumber: undefined, molecularWeight: undefined });

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.queryByText(/CAS/)).toBeNull();
    expect(screen.queryByText(/MW/)).toBeNull();
  });

  test('renders CAS and molecular weight when the compound documents them', () => {
    // Arrange
    const product = makeProduct({ casNumber: '2381089-83-2', molecularWeight: '4731 g/mol' });

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getByText('2381089-83-2')).toBeDefined();
    expect(screen.getByText('4731 g/mol')).toBeDefined();
  });
});

describe('ProductPage scientific content separation', () => {
  test('does not render mechanism, receptor, pathway or studies content', () => {
    // Arrange
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert — neither the module headings nor the prose itself.
    const body = document.body.textContent ?? '';
    expect(screen.queryByText('Mechanism of Action')).toBeNull();
    expect(screen.queryByText('Receptor / Target Activity')).toBeNull();
    expect(screen.queryByText('Signaling Pathway')).toBeNull();
    expect(screen.queryByText('Known Studies')).toBeNull();
    expect(body).not.toContain('Binds the receptor and activates downstream signaling.');
    expect(body).not.toContain('Signals through the cAMP-PKA axis.');
    expect(body).not.toContain('Journal of Test Research');
  });

  test('does not render the layman summary — that register is dossier-only', () => {
    // Arrange
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(document.body.textContent).not.toContain(
      'The plain-language version of what this compound does.',
    );
  });

  test('renders the long description exactly once', () => {
    // Arrange — both descriptions present; only the long one should render.
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getAllByText(LONG_DESCRIPTION)).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Short blurb.');
  });

  test('falls back to the short description when no long description exists', () => {
    // Arrange
    const product = makeProduct({ longDescription: undefined });

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getAllByText('Short blurb.')).toHaveLength(1);
  });
});

describe('ProductPage research dossier link', () => {
  test('renders a dossier control naming the compound', () => {
    // Arrange
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getByRole('button', { name: /research dossier for Testatide/i })).toBeDefined();
  });

  test('opens the shared dossier overlay for this compound when activated', () => {
    // Arrange
    const product = makeProduct();
    renderProductPage(product);
    expect(screen.queryByTestId('dossier-overlay')).toBeNull();

    // Act
    fireEvent.click(screen.getByRole('button', { name: /research dossier for Testatide/i }));

    // Assert — the shared overlay, targeting this product.
    expect(screen.getByTestId('dossier-overlay').textContent).toBe('dossier:test-compound');
  });
});

describe('ProductPage procurement block', () => {
  test('renders the full procurement row set, not a truncated head', () => {
    // Arrange — lead time and testing standard sit past the old 4-row cap.
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getByText('Lead Time')).toBeDefined();
    expect(screen.getByText('3 business days')).toBeDefined();
    expect(screen.getByText('Testing Standard')).toBeDefined();
  });

  test('renders each procurement label exactly once', () => {
    // Arrange — the sticky column previously duplicated the sheet.
    const product = makeProduct();

    // Act
    renderProductPage(product);

    // Assert
    expect(screen.getAllByText('Storage')).toHaveLength(1);
    expect(screen.getAllByText('Shipping')).toHaveLength(1);
  });
});
