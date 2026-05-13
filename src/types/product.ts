/**
 * Product — Canonical Data Model
 * Phase 1 (Local-First Blueprint)
 *
 * Single source of truth for product shape. All consumers import from
 * this file (re-exported via `../types`).
 *
 * Design note
 * -----------
 * The canonical (new) field names are listed first. Legacy fields marked
 * @deprecated are retained as non-optional transitional aliases until
 * Phase 2 migrates all downstream consumers (ProductGrid, CartPage,
 * useCart, dead store/* components) to the canonical names. At that
 * point the deprecated fields will be removed in a single sweep.
 */

export type ProductCategory = 'research-supplies' | 'laboratory-equipment';

export interface ProductSpec {
  label: string;
  value: string;
}

export interface Product {
  // ──────────────────────────────────────────────────────────────────────
  // Canonical fields
  // ──────────────────────────────────────────────────────────────────────

  /** Stable primary key. UUID or kebab-case slug. */
  id: string;
  /** URL-friendly display name. Used for SEO / fallback route key. */
  slug: string;
  /** Display title. */
  name: string;
  /** Enum category. No free strings. */
  category: ProductCategory;
  /** Card subtitle / meta description. ≤ ~160 chars. */
  shortDescription: string;
  /** Product detail body. Plain text (no markdown in v1). */
  longDescription: string;
  /** First image is hero, rest populate gallery. */
  images: string[];
  /** Key/value spec table. Optional per product. */
  specs: ProductSpec[];
  /** Admin-facing identifier. Unique. */
  sku: string;
  /** Nullable. null = "Inquire for pricing". */
  priceCents: number | null;
  /** Nullable. null = stock not tracked. 0 = out of stock. */
  stock: number | null;
  /** Filter / search tags (future). */
  tags: string[];
  /** Landing featured strip flag. */
  featured: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. Admin audit. */
  updatedAt: string;

  // ──────────────────────────────────────────────────────────────────────
  // Transitional legacy fields (Phase 2 will remove)
  // ──────────────────────────────────────────────────────────────────────

  /** @deprecated Use `shortDescription`. */
  description: string | null;
  /** @deprecated Use `priceCents`. Always 0 when `priceCents` is null. */
  price_cents: number;
  /** @deprecated Derived from `stock`. true when stock > 0 or null. */
  in_stock: boolean;
  /** @deprecated Use `createdAt`. */
  created_at: string;
}
