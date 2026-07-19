/**
 * Molecular formula on the laboratory specification sheet.
 *
 * `molecularFormula` is populated only for single, structurally defined
 * substances corroborated against a verified PubChem record. Blends and
 * heterogeneous biologic preparations have no single formula and must render
 * no row rather than a blank or synthesized one — the same omit-when-absent
 * contract every other specification row follows.
 */
import { describe, expect, test } from 'vitest';

import { selectSpecificationRows } from '../../src/components/product/SpecificationSheet';
import type { Product } from '../../src/types/product';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-compound',
    name: 'Testatide — 5mg',
    slug: 'testatide',
    specs: [
      { label: 'Purity (HPLC)', value: '≥ 98%' },
      { label: 'Form', value: 'Lyophilized powder' },
    ],
    ...overrides,
  } as unknown as Product;
}

const formulaRowsOf = (product: Product) =>
  selectSpecificationRows(product).filter((r) => r.label === 'Molecular Formula');

describe('molecular formula specification row', () => {
  test('renders the formula row when the compound documents one', () => {
    // Arrange
    const product = makeProduct({ molecularFormula: 'C187H291N45O59' });

    // Act
    const rows = formulaRowsOf(product);

    // Assert
    expect(rows).toEqual([{ label: 'Molecular Formula', value: 'C187H291N45O59' }]);
  });

  test('omits the formula row entirely when the field is absent', () => {
    // Arrange — blends and biologic preparations carry no formula.
    const product = makeProduct({ molecularFormula: undefined });

    // Act
    const rows = formulaRowsOf(product);

    // Assert
    expect(rows).toEqual([]);
  });

  test('omits the formula row when the field is present but blank', () => {
    // Arrange
    const product = makeProduct({ molecularFormula: '   ' });

    // Act
    const rows = formulaRowsOf(product);

    // Assert
    expect(rows).toEqual([]);
  });

  test('leaves the existing analytical rows untouched', () => {
    // Arrange
    const product = makeProduct({ molecularFormula: 'C187H291N45O59' });

    // Act
    const labels = selectSpecificationRows(product).map((r) => r.label);

    // Assert
    expect(labels).toEqual(['Molecular Formula', 'Purity (HPLC)', 'Form']);
  });
});
