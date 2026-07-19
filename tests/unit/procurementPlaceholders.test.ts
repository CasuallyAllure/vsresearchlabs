/**
 * Procurement spec-sheet honesty.
 *
 * Audit finding (docs/RESEARCH_CONTENT_SEPARATION_BLUEPRINT.md §5): all 50
 * generated compounds carry `manufacturer: "Vetted global production
 * partners"` and `countryOfOrigin: "Global partner network"`. Neither names a
 * manufacturer nor a country, and a procurement-grade specification sheet
 * cannot carry them as-is.
 *
 * The JSON keys stay in place so real per-compound values can be filled in
 * later — the renderer, not the data, is what suppresses them. These tests
 * pin both halves of that contract: the placeholder is omitted, and a real
 * value supplied in its place renders automatically with no code change.
 */
import { describe, expect, test } from 'vitest';

import {
  isRealProcurementValue,
  selectProcurementRows,
} from '../../src/components/catalog/intelligence/ProcurementSheet';
import { makeProduct } from '../fixtures/product';

const PLACEHOLDER_MANUFACTURER = 'Vetted global production partners';
const PLACEHOLDER_ORIGIN = 'Global partner network';

function labelsFor(overrides: Parameters<typeof makeProduct>[0]): string[] {
  return selectProcurementRows(makeProduct(overrides)).map((row) => row.label);
}

describe('isRealProcurementValue', () => {
  test('rejects the catalog-wide manufacturer placeholder', () => {
    expect(isRealProcurementValue(PLACEHOLDER_MANUFACTURER)).toBe(false);
  });

  test('rejects the catalog-wide origin placeholder', () => {
    expect(isRealProcurementValue(PLACEHOLDER_ORIGIN)).toBe(false);
  });

  test('rejects a placeholder regardless of casing or surrounding whitespace', () => {
    expect(isRealProcurementValue('  GLOBAL PARTNER NETWORK  ')).toBe(false);
  });

  test('rejects an absent or blank value', () => {
    expect(isRealProcurementValue(undefined)).toBe(false);
    expect(isRealProcurementValue('   ')).toBe(false);
  });

  test('accepts a real, specific value', () => {
    expect(isRealProcurementValue('Bachem AG')).toBe(true);
    expect(isRealProcurementValue('Switzerland')).toBe(true);
  });
});

describe('selectProcurementRows', () => {
  test('omits the Manufacturer row when the value is the placeholder', () => {
    const labels = labelsFor({
      manufacturer: PLACEHOLDER_MANUFACTURER,
      storageCondition: '-20°C',
    });

    expect(labels).not.toContain('Manufacturer');
    expect(labels).toContain('Storage');
  });

  test('omits the Origin row when the value is the placeholder', () => {
    const labels = labelsFor({
      countryOfOrigin: PLACEHOLDER_ORIGIN,
      storageCondition: '-20°C',
    });

    expect(labels).not.toContain('Origin');
  });

  test('renders Manufacturer and Origin once real values are supplied', () => {
    const rows = selectProcurementRows(
      makeProduct({ manufacturer: 'Bachem AG', countryOfOrigin: 'Switzerland' }),
    );

    expect(rows).toEqual([
      { label: 'Manufacturer', value: 'Bachem AG' },
      { label: 'Origin', value: 'Switzerland' },
    ]);
  });

  test('leaves the remaining procurement rows intact', () => {
    const labels = labelsFor({
      manufacturer: PLACEHOLDER_MANUFACTURER,
      countryOfOrigin: PLACEHOLDER_ORIGIN,
      storageCondition: '-20°C',
      shippingCondition: 'Ambient',
      lotNumber: 'LOT-001',
      batchReference: 'B-77',
      leadTimeDays: 3,
      shelfLifeMonths: 24,
      testingStandard: 'HPLC',
    });

    expect(labels).toEqual([
      'Storage',
      'Shipping',
      'Lot',
      'Batch',
      'Lead Time',
      'Shelf Life',
      'Testing Standard',
    ]);
  });

  test('returns no rows when a product carries only placeholder procurement data', () => {
    const rows = selectProcurementRows(
      makeProduct({
        manufacturer: PLACEHOLDER_MANUFACTURER,
        countryOfOrigin: PLACEHOLDER_ORIGIN,
      }),
    );

    expect(rows).toEqual([]);
  });
});
