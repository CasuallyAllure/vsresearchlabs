import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS, CLASSIFICATION_DEFINITIONS } from '../lib/compoundIntelligence';

const ALL_TAB = '__all__';

export function SkincareResearchSupplies() {
  const { products, loading, error } = useProducts('skincare-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const classificationTabs = useMemo<PillTab[]>(() => {
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All' }];
    for (const p of products) {
      if (p.researchClassification && !seen.has(p.researchClassification)) {
        seen.add(p.researchClassification);
        tabs.push({
          id: p.researchClassification,
          label: CLASSIFICATION_LABELS[p.researchClassification] ?? p.researchClassification,
          tooltip: CLASSIFICATION_DEFINITIONS[p.researchClassification],
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
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Research Supplies · Skincare
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Skincare </span>
          <span className="font-medium text-ink">research supplies.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed">
          Topical and dermatological research compounds for barrier,
          repair, and pigmentation models. Catalog expanding.
        </p>
      </header>

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
        emptyLabel="No skincare research supplies in the active catalog. Cataloging in progress."
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
