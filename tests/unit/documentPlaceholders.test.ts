/**
 * Pins the honesty seal on the documentation archive.
 *
 * `src/data/documents.json` is illustrative sample data — no PDF exists
 * behind any record, and the issuer / authorising analyst / standard /
 * instrument fields are invented. Because the site is pursuing GLP
 * credentials, none of it may render as an issued quality record.
 *
 * These tests pin the two guarantees the rendering surfaces rely on:
 *   • every seeded record declares `isSamplePlaceholder`
 *   • `hasSamplePlaceholders` reports honestly on a list
 *
 * The type-level guarantee — that `isSamplePlaceholder` is REQUIRED, so a
 * future real record must consciously set it false — is asserted with a
 * `@ts-expect-error` below. `tsc -b` typechecks this directory, so making
 * the field optional breaks the build rather than silently passing.
 */
import { describe, expect, test } from 'vitest';

import documentsData from '../../src/data/documents.json';
import { hasSamplePlaceholders } from '../../src/hooks/useDocuments';
import type { Document } from '../../src/types';

const RECORDS = documentsData.documents as unknown as Document[];

describe('documents.json seed data', () => {
  test('ships the full seeded archive', () => {
    expect(RECORDS).toHaveLength(10);
  });

  test('every record is flagged as an illustrative placeholder', () => {
    const unflagged = RECORDS.filter((doc) => doc.isSamplePlaceholder !== true);

    expect(unflagged.map((doc) => doc.id)).toEqual([]);
  });

  test('carries a top-level note stating the records are not issued', () => {
    expect(documentsData._note).toMatch(/NOT ISSUED QUALITY RECORDS/);
  });
});

describe('hasSamplePlaceholders', () => {
  test('is true when any record in the list is a placeholder', () => {
    // Arrange
    const list = RECORDS.slice(0, 3);

    // Act
    const result = hasSamplePlaceholders(list);

    // Assert
    expect(result).toBe(true);
  });

  test('is false once every record is a real issued document', () => {
    // Arrange
    const issued = RECORDS.map((doc) => ({ ...doc, isSamplePlaceholder: false }));

    // Act
    const result = hasSamplePlaceholders(issued);

    // Assert
    expect(result).toBe(false);
  });

  test('is false for an empty archive', () => {
    expect(hasSamplePlaceholders([])).toBe(false);
  });
});

describe('Document type contract', () => {
  test('requires isSamplePlaceholder — omitting it is a compile error', () => {
    const build = (): Document =>
      // @ts-expect-error isSamplePlaceholder is required; a new record must
      // consciously declare whether it is a placeholder or an issued document.
      ({
        id: 'doc-new-coa-001',
        productAbbreviation: 'NEW',
        productName: 'New Compound',
        documentType: 'Certificate of Analysis',
        batchId: 'NEW-2026-001',
        issuedDate: '2026-01-01',
        thumbnailUrl: '/docs/coa.svg',
      });

    expect(build().id).toBe('doc-new-coa-001');
  });
});
