import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { BiopeptideInventoryModal } from '../components/catalog/BiopeptideInventoryModal';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';
import { ClassificationFilter } from '../components/catalog/ClassificationFilter';
import { isSkuInStock, isSkuVisible } from '../lib/productOverrides';

const ALL_TAB = '__all__';

const ALL_LAYMAN =
  'The full biopeptide catalog — tap a category to filter the list and read what it does in plain terms. Swipe right for the technical detail.';
const ALL_DESCRIPTION =
  'The complete biopeptide catalog. Pick a class to narrow the list and read what it covers.';

export function BiopeptideResearchSupplies() {
  const { products, loading, error } = useProducts('biopeptide-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  const classificationTabs = useMemo<{ id: string; label: string }[]>(() => {
    const seen = new Set<string>();
    const tabs = [{ id: ALL_TAB, label: 'All' }];
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
    () => products.filter((p) => isSkuVisible(p.sku)).map((p) => ({ id: p.id, label: p.name })),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!isSkuVisible(p.sku)) return false;
      if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
      if (inStockOnly && !isSkuInStock(p.sku)) return false;
      if (q.length > 0) {
        const hay = `${p.name} ${p.sku} ${p.abbreviation ?? ''} ${p.family ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, classFilter, inStockOnly, search]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-3)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Research Supplies · Biopeptide
        </p>
        <h1 className="text-[clamp(1.5rem,2.8vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Biopeptide </span>
          <span className="font-medium text-ink">research supplies.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[13px] leading-relaxed">
          Lyophilized peptides, sourced for research-grade consistency. Filter to{' '}
          <span className="text-ink/80">in-stock</span> compounds to surface the selections
          cleared for our fastest dispatch; anything not currently stocked can be reserved
          by inquiry for a scheduled later shipment.{' '}
          <button
            type="button"
            onClick={() => setInventoryOpen(true)}
            className="whitespace-nowrap font-medium text-holo underline decoration-holo/30 underline-offset-4 transition-colors hover:decoration-holo/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40 rounded-sm"
          >
            View full inventory&nbsp;↗
          </button>
        </p>
      </header>

      <ClassificationFilter
        tabs={classificationTabs}
        value={classFilter}
        onChange={setClassFilter}
        allLayman={ALL_LAYMAN}
        allTechnical={ALL_DESCRIPTION}
        inStock={{ on: inStockOnly, toggle: () => setInStockOnly((v) => !v) }}
        search={search}
        onSearch={setSearch}
        suggestions={suggestions}
        searchPlaceholder="Search peptides…"
      />

      <ProductGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel="No biopeptide research supplies match the active filter."
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

      <BiopeptideInventoryModal
        open={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
      />
    </section>
  );
}
