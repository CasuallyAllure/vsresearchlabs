/**
 * Procurement spec-sheet honesty — sourcing rows.
 *
 * The catalog sources through a network of vetted international partners
 * rather than manufacturing in-house, so `manufacturer` and
 * `countryOfOrigin` carry network-level answers. Those answers are true;
 * what was wrong was the labels. A row labelled "Manufacturer" whose value
 * is a partner network implies a manufacturer identity we do not have, and
 * a row labelled "Country of Origin" whose value is a network is not a
 * country.
 *
 * These tests pin the contract the renderer now holds:
 *   • the sourcing rows render, under sourcing labels
 *   • no row is labelled "Manufacturer", "Origin", or "Country of Origin"
 *   • genuinely blank values are still suppressed
 *   • a real per-compound value supplied later renders with no code change
 */
import { describe, expect, test } from 'vitest';

import {
  isRealProcurementValue,
  selectProcurementRows,
} from '../../src/components/catalog/intelligence/ProcurementSheet';
import { makeProduct } from '../fixtures/product';

const SUPPLY_SOURCE = 'Vetted international manufacturing partners';
const SOURCING_NETWORK = 'International partner network';

function labelsFor(overrides: Parameters<typeof makeProduct>[0]): string[] {
  return selectProcurementRows(makeProduct(overrides)).map((row) => row.label);
}

describe('isRealProcurementValue', () => {
  test('accepts the catalog-wide sourcing values', () => {
    expect(isRealProcurementValue(SUPPLY_SOURCE)).toBe(true);
    expect(isRealProcurementValue(SOURCING_NETWORK)).toBe(true);
  });

  test('rejects an absent or blank value', () => {
    expect(isRealProcurementValue(undefined)).toBe(false);
    expect(isRealProcurementValue('')).toBe(false);
    expect(isRealProcurementValue('   ')).toBe(false);
  });

  test('accepts a real, specific value', () => {
    expect(isRealProcurementValue('Bachem AG')).toBe(true);
    expect(isRealProcurementValue('Switzerland')).toBe(true);
  });
});

describe('selectProcurementRows', () => {
  test('renders the sourcing values under sourcing labels', () => {
    // Arrange / Act
    const rows = selectProcurementRows(
      makeProduct({ manufacturer: SUPPLY_SOURCE, countryOfOrigin: SOURCING_NETWORK }),
    );

    // Assert
    expect(rows).toEqual([
      { label: 'Supply source', value: SUPPLY_SOURCE },
      { label: 'Sourcing network', value: SOURCING_NETWORK },
    ]);
  });

  test('never labels a sourcing row as a manufacturer or a country', () => {
    const labels = labelsFor({
      manufacturer: SUPPLY_SOURCE,
      countryOfOrigin: SOURCING_NETWORK,
    });

    expect(labels).not.toContain('Manufacturer');
    expect(labels).not.toContain('Origin');
    expect(labels).not.toContain('Country of Origin');
  });

  test('omits the sourcing rows when the values are blank', () => {
    const labels = labelsFor({
      manufacturer: '   ',
      countryOfOrigin: undefined,
      storageCondition: '-20°C',
    });

    expect(labels).toEqual(['Storage']);
  });

  test('renders a real per-compound value with no code change', () => {
    const rows = selectProcurementRows(
      makeProduct({ manufacturer: 'Bachem AG', countryOfOrigin: 'Switzerland' }),
    );

    expect(rows).toEqual([
      { label: 'Supply source', value: 'Bachem AG' },
      { label: 'Sourcing network', value: 'Switzerland' },
    ]);
  });

  test('leaves the remaining procurement rows intact', () => {
    const labels = labelsFor({
      manufacturer: SUPPLY_SOURCE,
      countryOfOrigin: SOURCING_NETWORK,
      storageCondition: '-20°C',
      shippingCondition: 'Ambient',
      lotNumber: 'LOT-001',
      batchReference: 'B-77',
      leadTimeDays: 3,
      shelfLifeMonths: 24,
      testingStandard: 'HPLC',
    });

    expect(labels).toEqual([
      'Supply source',
      'Sourcing network',
      'Storage',
      'Shipping',
      'Lot',
      'Batch',
      'Lead Time',
      'Shelf Life',
      'Testing Standard',
    ]);
  });

  test('returns no rows when a product carries no procurement data at all', () => {
    expect(selectProcurementRows(makeProduct({}))).toEqual([]);
  });
});
