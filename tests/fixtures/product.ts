/**
 * Test-only factory for the (large, mostly-irrelevant-to-money-math)
 * `Product` shape, so unit tests can build a `CartItem` without repeating
 * every required field. Only `sku`, `name`, and `priceCents` are varied by
 * callers today.
 */
import type { CartItem, Product } from '../../src/types';

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.sku ?? 'test-sku',
    slug: 'test-product',
    name: 'Test Compound',
    category: 'biopeptide-research-supplies',
    shortDescription: 'Test product for unit tests.',
    longDescription: 'Test product for unit tests.',
    images: [],
    specs: [],
    sku: 'TEST-SKU',
    abbreviation: 'TST',
    family: 'Test Family',
    variants: [],
    priceCents: 1000,
    stock: 10,
    tags: [],
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeCartItem(overrides: Partial<Product> = {}, quantity = 1): CartItem {
  return { product: makeProduct(overrides), quantity };
}
