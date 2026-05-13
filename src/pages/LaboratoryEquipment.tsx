/**
 * LaboratoryEquipment
 * Phase 4 — VS Research Labs
 *
 * Category page for laboratory equipment. Renders the shared ProductGrid
 * filtered to category="laboratory-equipment".
 */

import { ProductGrid } from '../components/ProductGrid';
import { useProducts } from '../hooks/useProducts';

export function LaboratoryEquipment() {
  const { products, loading, error } = useProducts('laboratory-equipment');

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-10)] pb-[var(--space-8)] border-b border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
          Catalog
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          Laboratory Equipment
        </h1>
        <p className="mt-[var(--space-3)] text-sm text-white/55 max-w-[52ch]">
          Precision instruments and bench tools for analytical and preparative
          workflows.
        </p>
      </header>

      <ProductGrid
        products={products}
        loading={loading}
        error={error}
        emptyLabel="No laboratory equipment available yet."
      />
    </section>
  );
}
