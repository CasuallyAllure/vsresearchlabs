/**
 * productStore — Local Product Source of Truth
 * Phase 1 (Local-First Blueprint)
 *
 * Zustand store with localStorage persistence. On first load the store
 * hydrates from the seed JSON (`src/data/products.json`). Admin CRUD
 * (added in Phase 4) will mutate this store directly.
 *
 * Invariants
 * ----------
 * - No UI component imports this store directly. Only the hooks in
 *   `src/hooks/useProducts.ts` read from it.
 * - No backend awareness: this store knows nothing about Supabase.
 *   The Supabase seam (Phase: future) lives exclusively in the hooks.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import seedProducts from '../data/products.json';
import generatedCompounds from '../data/biopeptideCompounds.generated.json';
import { siteConfig } from '../config';
import type { Product } from '../types/product';

// The JSON is typed loosely at import; we narrow here once. The biopeptide
// master list is promoted into full products by `npm run gen:inventory`
// (scripts/buildInventory.mjs → biopeptideCompounds.generated.json) and
// merged after the hand-authored rich catalog so the manifest compounds
// gain real product pages + specimen imagery.
const seed: Product[] = [
  ...(seedProducts as unknown as Product[]),
  ...(generatedCompounds as unknown as Product[]),
];

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface ProductStore {
  products: Product[];

  /** Replace the entire product list. Admin import / reset uses this. */
  setAll: (products: Product[]) => void;

  /** Append a new product. Admin "Create" uses this. */
  add: (product: Product) => void;

  /** Update a product by id. Admin "Edit" uses this. */
  update: (id: string, patch: Partial<Product>) => void;

  /** Remove a product by id. Admin "Delete" uses this. */
  remove: (id: string) => void;

  /** Wipe localStorage and re-hydrate from the shipped seed JSON. */
  resetToSeed: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProductStore = create<ProductStore>()(
  persist(
    (set) => ({
      products: seed,

      setAll: (products) => set({ products }),

      add: (product) =>
        set((state) => ({ products: [...state.products, product] })),

      update: (id, patch) =>
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
          ),
        })),

      remove: (id) =>
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        })),

      resetToSeed: () => set({ products: seed }),
    }),
    {
      // Wave 7c — bump from v1 to v2 to invalidate persisted catalogs
      // that pre-date the abbreviation/family/variants schema extension.
      // v3 — full biopeptide inventory promoted to products (the 50
      // generated compounds). Bumping invalidates v2 payloads so returning
      // browsers re-hydrate from the expanded seed rather than the stale
      // 18-product catalog.
      // v4 — product names no longer embed a fixed dose ("BPC-157 — 5mg" →
      // "BPC-157"); the dose comes from the variant/tier. Bump re-hydrates so
      // returning browsers drop the stale dose-in-name catalog.
      name: siteConfig.storage.productsKey,
      storage: createJSONStorage(() => localStorage),
      // Only persist the products array; everything else is derived.
      partialize: (state) => ({ products: state.products }),
    }
  )
);
