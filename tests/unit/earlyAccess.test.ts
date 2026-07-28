/**
 * earlyAccess — the member-first visibility window helper. Pure logic: the
 * gate itself is the tag; the surfaces (CompoundTile / ProductPage) disable
 * ordering for guests when it's present. Ships dark — no product is tagged.
 */
import { describe, expect, test } from 'vitest';
import { EARLY_ACCESS_TAG, isEarlyAccessProduct } from '../../src/lib/earlyAccess';
import type { Product } from '../../src/types/product';

const base = { id: 'p1', sku: 'VSR-X', name: 'Test', variants: [] } as unknown as Product;

describe('isEarlyAccessProduct', () => {
  test('true when the tag is present', () => {
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide', EARLY_ACCESS_TAG] } as Product)).toBe(true);
  });

  test('false when tags exist without the tag', () => {
    expect(isEarlyAccessProduct({ ...base, tags: ['peptide', 'blend'] } as Product)).toBe(false);
  });

  test('false when tags are absent entirely', () => {
    expect(isEarlyAccessProduct({ ...base, tags: undefined } as unknown as Product)).toBe(false);
  });
});
