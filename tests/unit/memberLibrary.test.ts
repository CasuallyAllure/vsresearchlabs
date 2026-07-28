/**
 * Unit tests for src/lib/memberLibrary.ts — the pure order-lines × catalog
 * fold behind /account/library.
 *
 * Pins the contract the portal depends on: one entry per distinct catalog
 * record, doses aggregated from the line names, cancelled/refunded orders
 * dropped, unknown skus skipped, and compounds separated from equipment.
 */
import { describe, expect, test } from 'vitest';
import { buildMemberLibrary } from '../../src/lib/memberLibrary';
import type { MyOrderLineRow } from '../../src/lib/accountData';
import type { Product } from '../../src/types/product';

function makeProduct(over: Partial<Product> & Pick<Product, 'id' | 'sku' | 'name'>): Product {
  return {
    slug: over.id,
    category: 'biopeptide-research-supplies',
    shortDescription: '',
    longDescription: '',
    images: [],
    specs: [],
    abbreviation: 'X',
    family: 'Metabolic Peptide',
    variants: [],
    priceCents: 1000,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    productType: 'peptide',
    ...over,
  } as Product;
}

const AOD = makeProduct({
  id: 'rs-aod9604',
  sku: 'VSR-RS-AOD-005',
  name: 'AOD-9604',
  specs: [
    { label: 'Purity (HPLC)', value: '≥ 98%' },
    { label: 'Form', value: 'Lyophilized powder' },
  ],
  casNumber: '221231-10-3',
  molecularWeight: '1815.14 g/mol',
  researchClassification: 'metabolic-cofactor',
});

const VIAL_RACK = makeProduct({
  id: 'le-rack',
  sku: 'VSR-LE-RCK-001',
  name: 'Vial Rack',
  family: 'Sample Prep',
  category: 'laboratory-equipment',
  productType: 'equipment',
});

function line(over: Partial<MyOrderLineRow> = {}): MyOrderLineRow {
  return {
    sku: 'VSR-RS-AOD-005',
    product_name: 'AOD-9604 — 5mg',
    order_number: 'VSR-ORD-260701-001',
    status: 'fulfilled',
    ...over,
  };
}

describe('buildMemberLibrary', () => {
  test('returns empty groups for no lines', () => {
    expect(buildMemberLibrary([], [AOD])).toEqual({ compounds: [], supplies: [] });
  });

  test('maps a line to its catalog specification, verbatim', () => {
    const { compounds } = buildMemberLibrary([line()], [AOD]);

    expect(compounds).toHaveLength(1);
    expect(compounds[0]).toMatchObject({
      productId: 'rs-aod9604',
      name: 'AOD-9604',
      sku: 'VSR-RS-AOD-005',
      purity: { label: 'Purity (HPLC)', value: '≥ 98%' },
      casNumber: '221231-10-3',
      molecularWeight: '1815.14 g/mol',
      researchClassification: 'metabolic-cofactor',
      doses: ['5mg'],
      orderCount: 1,
    });
  });

  test('dedupes a compound across orders and aggregates the doses ordered', () => {
    const { compounds } = buildMemberLibrary(
      [
        line({ product_name: 'AOD-9604 — 5mg', order_number: 'A' }),
        line({ product_name: 'AOD-9604 — 10mg', order_number: 'B' }),
        line({ product_name: 'AOD-9604 — 5mg', order_number: 'B' }),
      ],
      [AOD],
    );

    expect(compounds).toHaveLength(1);
    expect(compounds[0].doses).toEqual(['5mg', '10mg']);
    expect(compounds[0].orderCount).toBe(2);
  });

  test('skips lines whose sku has no catalog record', () => {
    const { compounds, supplies } = buildMemberLibrary([line({ sku: 'VSR-RETIRED-001' })], [AOD]);

    expect(compounds).toEqual([]);
    expect(supplies).toEqual([]);
  });

  test('drops cancelled and refunded orders', () => {
    const { compounds } = buildMemberLibrary(
      [
        line({ order_number: 'A', status: 'cancelled' }),
        line({ order_number: 'B', status: 'refunded' }),
      ],
      [AOD],
    );

    expect(compounds).toEqual([]);
  });

  test('separates non-compound records into supplies', () => {
    const { compounds, supplies } = buildMemberLibrary(
      [line(), line({ sku: 'VSR-LE-RCK-001', product_name: 'Vial Rack' })],
      [AOD, VIAL_RACK],
    );

    expect(compounds.map((e) => e.name)).toEqual(['AOD-9604']);
    expect(supplies.map((e) => e.name)).toEqual(['Vial Rack']);
    expect(supplies[0].doses).toEqual([]);
  });

  test('leaves absent specification fields null rather than inventing them', () => {
    const { supplies } = buildMemberLibrary(
      [line({ sku: 'VSR-LE-RCK-001', product_name: 'Vial Rack' })],
      [VIAL_RACK],
    );

    expect(supplies[0]).toMatchObject({
      purity: null,
      casNumber: null,
      molecularWeight: null,
      researchClassification: null,
    });
  });

  test('sorts each group by name', () => {
    const zeta = makeProduct({ id: 'rs-zeta', sku: 'VSR-RS-ZET-001', name: 'Zeta-1' });
    const { compounds } = buildMemberLibrary(
      [line({ sku: 'VSR-RS-ZET-001', product_name: 'Zeta-1 — 2mg' }), line()],
      [AOD, zeta],
    );

    expect(compounds.map((e) => e.name)).toEqual(['AOD-9604', 'Zeta-1']);
  });
});
