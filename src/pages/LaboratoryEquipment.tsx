/**
 * LaboratoryEquipment
 * Wave 3 — PillTabs filter bar above the product grid.
 *
 * Category page for laboratory equipment. Filter state is captured but
 * NOT wired to `useProducts` — see notes on the matching change in
 * ResearchSupplies.tsx. Data filtering deferred to Wave 3b.
 */

import { ProductGrid } from '../components/ProductGrid';
import { useProducts } from '../hooks/useProducts';

export function LaboratoryEquipment() {
  const { products, loading, error } = useProducts('laboratory-equipment');

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-10)] pb-[var(--space-6)] border-b border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-3)]">
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
        emptyLabel="No laboratory equipment in the active catalog."
      />
    </section>
  );
}
