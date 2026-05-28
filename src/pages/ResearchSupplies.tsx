import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { useProducts } from '../hooks/useProducts';
import type { ResearchClassification } from '../types';

const ALL_TAB = '__all__';

const CLASSIFICATION_LABELS: Partial<Record<ResearchClassification, string>> = {
  'glp-1-agonist': 'GLP-1 Agonist',
  'dual-agonist': 'Dual Agonist',
  'triple-agonist': 'Triple Agonist',
  'growth-hormone-secretagogue': 'GH Secretagogue',
  'growth-factor': 'Growth Factor',
  'metabolic-lipolytic': 'Metabolic',
  'nootropic-neuroactive': 'Nootropic',
  'regenerative-healing': 'Regenerative',
  'immunomodulatory': 'Immunomodulatory',
  'bio-regulator': 'Bio-Regulator',
  'experimental': 'Experimental',
};

export function ResearchSupplies() {
  const { products, loading, error } = useProducts('research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // Build classification tabs from peptides in the dataset
  const classificationTabs = useMemo<PillTab[]>(() => {
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All' }];
    for (const p of products) {
      if (p.researchClassification && !seen.has(p.researchClassification)) {
        seen.add(p.researchClassification);
        tabs.push({
          id: p.researchClassification,
          label: CLASSIFICATION_LABELS[p.researchClassification] ?? p.researchClassification,
        });
      }
    }
    return tabs;
  }, [products]);

  const filtered = useMemo(() => {
    if (classFilter === ALL_TAB) return products;
    return products.filter((p) => p.researchClassification === classFilter);
  }, [products, classFilter]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-white/[0.06]">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 mb-[var(--space-3)]">
          Catalog
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          Research Supplies
        </h1>
        <p className="mt-[var(--space-3)] text-sm text-white/55 max-w-[52ch]">
          Peptides, solvents, and injection accessories sourced for research-grade
          consistency. Click any compound to open compound intelligence.
        </p>
      </header>

      {/* Classification filter — only shows when classifications are present */}
      {classificationTabs.length > 1 && (
        <div className="mb-[var(--space-6)]">
          <PillTabs
            tabs={classificationTabs}
            activeId={classFilter}
            onChange={setClassFilter}
            ariaLabel="Filter by research classification"
          />
        </div>
      )}

      <ProductGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel="No research supplies match the active filter."
        onInspect={setInspectedId}
      />

      {inspectedProduct && (
        <CompoundIntelligenceOverlay
          product={inspectedProduct}
          onClose={() => setInspectedId(null)}
        />
      )}
    </section>
  );
}
