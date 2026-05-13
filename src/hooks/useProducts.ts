/**
 * Product Hooks — Local-First
 * Phase 1 (Local-First Blueprint)
 *
 * Public contract:
 *   useProducts(category?)       → { products, loading, error }
 *   useProduct(id)               → { product, loading, error }
 *   useFeaturedProducts(limit?)  → { products }
 *
 * Implementation reads from the local Zustand productStore. The
 * `loading` / `error` fields are retained in the return shape for
 * forward compatibility with a future Supabase-backed rewrite —
 * today they are always `false` / `null`.
 */

import { useMemo } from 'react';
import { useProductStore } from '../stores/productStore';
import type { Product, ProductCategory } from '../types/product';

// ---------------------------------------------------------------------------
// useProducts — list with optional category filter
// ---------------------------------------------------------------------------

export function useProducts(category?: ProductCategory | string) {
  const all = useProductStore((s) => s.products);

  const products = useMemo(() => {
    if (!category) return all;
    return all.filter((p) => p.category === category);
  }, [all, category]);

  return { products, loading: false, error: null as string | null };
}

// ---------------------------------------------------------------------------
// useProduct — single product by id
// ---------------------------------------------------------------------------

export function useProduct(id: string | undefined) {
  const all = useProductStore((s) => s.products);

  const product = useMemo<Product | null>(() => {
    if (!id) return null;
    return all.find((p) => p.id === id) ?? null;
  }, [all, id]);

  const error: string | null = !id
    ? 'Missing product id.'
    : product === null
      ? 'Product not found.'
      : null;

  return { product, loading: false, error };
}

// ---------------------------------------------------------------------------
// useFeaturedProducts — landing strip
// ---------------------------------------------------------------------------

export function useFeaturedProducts(limit?: number) {
  const all = useProductStore((s) => s.products);

  const products = useMemo(() => {
    const featured = all.filter((p) => p.featured);
    return typeof limit === 'number' ? featured.slice(0, limit) : featured;
  }, [all, limit]);

  return { products };
}

// ---------------------------------------------------------------------------
// useProductAdmin — CRUD seam for the admin scaffold
//
// Phase 4 admin pages mutate via this hook only, never via the store
// directly. This preserves the productStore.ts invariant that "no UI
// component imports the store directly".
// ---------------------------------------------------------------------------

export function useProductAdmin() {
  const add = useProductStore((s) => s.add);
  const update = useProductStore((s) => s.update);
  const remove = useProductStore((s) => s.remove);
  const setAll = useProductStore((s) => s.setAll);
  const resetToSeed = useProductStore((s) => s.resetToSeed);

  return { add, update, remove, setAll, resetToSeed };
}
