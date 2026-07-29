import { describe, expect, test } from 'vitest';
import {
  COMPOUND_SHARE_PREFIX,
  compoundSharePath,
  compoundShareUrl,
  isCompoundSharePath,
  resolveCompoundSlug,
  shareDescription,
  shareTitle,
} from '../../src/lib/compoundShare';
import type { Product } from '../../src/types';

function product(patch: Partial<Product>): Product {
  return {
    id: 'rs-bpc157-5mg',
    slug: 'bpc157-5mg',
    name: 'BPC-157',
    sku: 'VSR-PEP-BPC',
    shortDescription: 'Pentadecapeptide research model. Lyophilized, 5mg vial.',
    ...patch,
  } as Product;
}

describe('compoundSharePath / compoundShareUrl', () => {
  test('builds the /c/<slug> path from the product slug', () => {
    expect(compoundSharePath(product({}))).toBe('/c/bpc157-5mg');
  });

  test('builds an absolute canonical URL on the production host', () => {
    // Arrange / Act
    const url = compoundShareUrl(product({}));
    // Assert — never window.location.origin: a link copied on localhost
    // must still work when it is pasted somewhere else.
    expect(url).toBe('https://vsresearchlabs.com/c/bpc157-5mg');
  });

  test('percent-encodes a slug that is not URL-safe', () => {
    expect(compoundSharePath(product({ slug: 'a b' }))).toBe('/c/a%20b');
  });
});

describe('isCompoundSharePath', () => {
  test('matches the prefix and its children', () => {
    expect(isCompoundSharePath(COMPOUND_SHARE_PREFIX)).toBe(true);
    expect(isCompoundSharePath('/c/bpc157-5mg')).toBe(true);
  });

  test('does not match unrelated routes that merely start with the letter', () => {
    expect(isCompoundSharePath('/catalog')).toBe(false);
    expect(isCompoundSharePath('/contact')).toBe(false);
    expect(isCompoundSharePath('/')).toBe(false);
  });
});

describe('resolveCompoundSlug', () => {
  const bpc = product({});
  const aod = product({ id: 'rs-aod9604-5mg', slug: 'aod9604-5mg', name: 'AOD-9604', sku: 'VSR-PEP-AOD' });
  const products = [bpc, aod];

  test('resolves by slug', () => {
    expect(resolveCompoundSlug(products, 'aod9604-5mg')).toBe(aod);
  });

  test('resolves case-insensitively', () => {
    expect(resolveCompoundSlug(products, 'AOD9604-5MG')).toBe(aod);
  });

  test('falls back to id then sku so hand-built links still land', () => {
    expect(resolveCompoundSlug(products, 'rs-aod9604-5mg')).toBe(aod);
    expect(resolveCompoundSlug(products, 'VSR-PEP-BPC')).toBe(bpc);
  });

  test('returns null for an unknown slug rather than throwing', () => {
    expect(resolveCompoundSlug(products, 'not-a-compound')).toBeNull();
  });

  test('returns null for a missing or blank slug', () => {
    expect(resolveCompoundSlug(products, undefined)).toBeNull();
    expect(resolveCompoundSlug(products, '   ')).toBeNull();
  });
});

describe('shareDescription', () => {
  test('appends the research-use boundary to the catalog description', () => {
    const text = shareDescription(product({}));
    expect(text).toContain('Pentadecapeptide research model.');
    expect(text).toContain('For Research Purposes Only');
  });

  test('trims a long description and still carries the boundary', () => {
    const text = shareDescription(product({ shortDescription: 'x'.repeat(400) }));
    expect(text).toContain('…');
    expect(text).toContain('For Research Purposes Only');
    expect(text.length).toBeLessThan(260);
  });

  test('still states the boundary when a product has no description', () => {
    expect(shareDescription(product({ shortDescription: '' }))).toBe(
      'For Research Purposes Only — Not for Human or Veterinary Use.',
    );
  });
});

describe('shareTitle', () => {
  test('is the compound name suffixed with the brand', () => {
    expect(shareTitle(product({}))).toBe('BPC-157 — VS Research Labs');
  });
});

describe('real catalog data', () => {
  test('every shipped product has a unique, URL-safe slug', async () => {
    const seed = (await import('../../src/data/products.json')).default as unknown as Product[];
    const generated = (await import('../../src/data/biopeptideCompounds.generated.json'))
      .default as unknown as Product[];
    const all = [...seed, ...generated];

    const slugs = all.map((p) => p.slug);
    expect(slugs.filter((s) => !/^[a-z0-9][a-z0-9-]*$/.test(s))).toEqual([]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
