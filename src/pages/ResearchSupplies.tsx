/**
 * ResearchSupplies
 * Phase 4 — VS Research Labs
 *
 * Category page for research supplies. Renders the shared ProductGrid
 * filtered to category="research-supplies".
 */

import { ProductGrid } from '../components/ProductGrid';
import { useProducts } from '../hooks/useProducts';

export function ResearchSupplies() {
  const { products, loading, error } = useProducts('research-supplies');

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-10)] pb-[var(--space-8)] border-b border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
          Catalog
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          Research Supplies
        </h1>
        <p className="mt-[var(--space-3)] text-sm text-white/55 max-w-[52ch]">
          Peptides, bacteriostatic water, syringes, and injection accessories
          — sourced for research-grade consistency.
        </p>
      </header>

      <ProductGrid
        products={products}
        loading={loading}
        error={error}
        emptyLabel="No research supplies available yet."
      />
    </section>
  );
}
