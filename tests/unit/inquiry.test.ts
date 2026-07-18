/**
 * Unit tests for src/lib/inquiry.ts — generateInquiryRecord().
 *
 * S1 made the reference ID server-authoritative: the generator no longer
 * derives one, it merges the server-returned fields with local form state.
 * These pin that merge — quantities summed, categories de-slugged, blank
 * notes dropped — and that the server fields (referenceId, timestamp, node)
 * pass through verbatim rather than being re-derived on the client.
 */
import { describe, expect, test } from 'vitest';
import { generateInquiryRecord, type InquiryServerData } from '../../src/lib/inquiry';
import type { CartItem, Product } from '../../src/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    slug: 'retatrutide',
    name: 'Retatrutide — 5mg',
    category: 'biopeptide-research-supplies',
    shortDescription: '',
    longDescription: '',
    images: [],
    specs: [],
    sku: 'VSR-PEP-RETA',
    abbreviation: 'RETA',
    family: 'GLP-1 Agonist',
    variants: [],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SERVER: InquiryServerData = {
  referenceId: 'VSR-REQ-260717-001',
  submittedAt: '2026-07-17T12:00:00.000Z',
  intakeChannel: 'web',
  processingNode: 'node-a',
  classificationStatus: 'pending',
};

describe('generateInquiryRecord', () => {
  test('passes the server-authoritative fields through verbatim', () => {
    // Arrange
    const items: CartItem[] = [{ product: makeProduct(), quantity: 1 }];

    // Act
    const record = generateInquiryRecord(
      { name: 'Dr Lab', contact: 'lab@example.com', organization: 'Acme', items },
      SERVER,
    );

    // Assert
    expect(record.referenceId).toBe('VSR-REQ-260717-001');
    expect(record.submittedAt).toBe('2026-07-17T12:00:00.000Z');
    expect(record.intakeChannel).toBe('web');
    expect(record.processingNode).toBe('node-a');
    expect(record.classificationStatus).toBe('pending');
  });

  test('carries the contact summary from local form state', () => {
    const items: CartItem[] = [{ product: makeProduct(), quantity: 1 }];
    const record = generateInquiryRecord(
      { name: 'Dr Lab', contact: 'lab@example.com', organization: 'Acme', items },
      SERVER,
    );
    expect(record.contactSummary).toEqual({
      name: 'Dr Lab',
      contact: 'lab@example.com',
      organization: 'Acme',
    });
  });

  test('sums the total item count across lines', () => {
    const items: CartItem[] = [
      { product: makeProduct({ sku: 'A' }), quantity: 2 },
      { product: makeProduct({ sku: 'B' }), quantity: 3 },
    ];
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items },
      SERVER,
    );
    expect(record.itemCount).toBe(5);
  });

  test('de-slugs the category and trims a note', () => {
    const items: CartItem[] = [
      { product: makeProduct(), quantity: 1, note: '  handle cold  ' },
    ];
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items },
      SERVER,
    );
    expect(record.procurementSummary[0]).toEqual({
      sku: 'VSR-PEP-RETA',
      name: 'Retatrutide — 5mg',
      quantity: 1,
      category: 'biopeptide research supplies',
      note: 'handle cold',
    });
  });

  test('drops a whitespace-only note to undefined', () => {
    const items: CartItem[] = [{ product: makeProduct(), quantity: 1, note: '   ' }];
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items },
      SERVER,
    );
    expect(record.procurementSummary[0].note).toBeUndefined();
  });

  test('omits an absent note', () => {
    const items: CartItem[] = [{ product: makeProduct(), quantity: 1 }];
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items },
      SERVER,
    );
    expect(record.procurementSummary[0].note).toBeUndefined();
  });

  test('sets the static estimated response window', () => {
    const items: CartItem[] = [{ product: makeProduct(), quantity: 1 }];
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items },
      SERVER,
    );
    expect(record.estimatedResponseWindow).toBe('1–2 business days');
  });

  test('produces an empty procurement summary for an empty cart', () => {
    const record = generateInquiryRecord(
      { name: 'n', contact: 'c', organization: 'o', items: [] },
      SERVER,
    );
    expect(record.itemCount).toBe(0);
    expect(record.procurementSummary).toEqual([]);
  });
});
