import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { ClassificationFilter } from '../components/catalog/ClassificationFilter';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';

const ALL_TAB = '__all__';

export function SkincareResearchSupplies() {
  const { products, loading, error } = useProducts('skincare-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [search, setSearch] = useState('');
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const classificationTabs = useMemo<{ id: string; label: string }[]>(() => {
    const seen = new Set<string>();
    const tabs: { id: string; label: string }[] = [{ id: ALL_TAB, label: 'All' }];
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

  const suggestions = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.name })),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
      if (q.length > 0) {
        const hay = `${p.name} ${p.sku} ${p.abbreviation ?? ''} ${p.family ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, classFilter, search]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      <header className="mb-[var(--space-3)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Research Supplies · Dermatological
        </p>
        <h1 className="font-serif text-[clamp(1.5rem,2.8vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Dermatological </span>
          <span className="font-light text-ink">research compounds.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[52ch] text-[13px] leading-relaxed">
          Topical and dermal-tissue research compounds supplied for barrier,
          repair, and pigmentation research models. Catalog expanding.
        </p>
      </header>

      {products.length > 0 && (
        <ClassificationFilter
          tabs={classificationTabs}
          value={classFilter}
          onChange={setClassFilter}
          allLayman="The full dermatological research catalog — tap a category to filter the list and read what each compound is studied for in plain terms. Swipe right for the technical detail."
          search={search}
          onSearch={setSearch}
          suggestions={suggestions}
          searchPlaceholder="Search dermatological compounds…"
        />
      )}

      <ProductGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel="No dermatological research compounds in the active catalog. Cataloging in progress."
        onInspect={setInspectedId}
        compact
      />

      {inspectedProduct && (
        <CompoundIntelligenceOverlay
          product={inspectedProduct}
          onClose={() => setInspectedId(null)}
          list={filtered}
          onNavigate={setInspectedId}
        />
      )}
    </section>
  );
}
