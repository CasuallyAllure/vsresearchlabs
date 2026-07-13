import { useMemo, useState } from 'react';
import type { Product } from '../types';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { BiopeptideInventoryModal } from '../components/catalog/BiopeptideInventoryModal';
import { CompoundSection } from '../components/catalog/CompoundSection';
import { useProducts } from '../hooks/useProducts';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_ORDER,
  CLASSIFICATION_SECTION_BLURB,
} from '../lib/compoundIntelligence';
import { ClassificationFilter } from '../components/catalog/ClassificationFilter';
import { useProductOverrides, isSkuInStock, isSkuVisible } from '../lib/productOverrides';

const UNCATEGORIZED_KEY = '__uncategorized__';

const ALL_TAB = '__all__';

const ALL_LAYMAN =
  'The full biopeptide catalog — tap a category to filter the list and read what it does in plain terms. Swipe right for the technical detail.';
const ALL_DESCRIPTION =
  'The complete biopeptide catalog. Pick a class to narrow the list and read what it covers.';

export function BiopeptideResearchSupplies() {
  const { products, loading, error } = useProducts('biopeptide-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  // Two independent shipping-tier chips. Exactly one active narrows to that
  // tier; both (or neither) active shows the full catalog. 24-hour is on by
  // default so the page loads showing only compounds cleared for next-day
  // dispatch — tap "7–10 DAYS" to widen to the sourced catalog.
  const [fastOn, setFastOn] = useState(true);
  const [sourcedOn, setSourcedOn] = useState(false);
  const showFastOnly = fastOn && !sourcedOn;
  const showSourcedOnly = sourcedOn && !fastOn;
  const [search, setSearch] = useState('');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // isSkuInStock/isSkuVisible read the override store via getState() (not
  // reactively). Subscribing here re-renders the page — and recomputes
  // `filtered` below — once admin overrides finish loading, so the
  // in-stock-by-default filter doesn't stick with a stale pre-load result.
  const variantOverrides = useProductOverrides((s) => s.variantBySku);

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
      if (showFastOnly && !isSkuInStock(p.sku)) return false;
      if (showSourcedOnly && isSkuInStock(p.sku)) return false;
      if (q.length > 0) {
        const hay = `${p.name} ${p.sku} ${p.abbreviation ?? ''} ${p.family ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, classFilter, showFastOnly, showSourcedOnly, search, variantOverrides]);

  // Group the filtered list into category sections, ordered per
  // CLASSIFICATION_ORDER; empty groups are skipped and anything without a
  // classification is collected into a trailing "Other" group.
  const groupedSections = useMemo(() => {
    const byClass = new Map<string, Product[]>();
    const uncategorized: Product[] = [];
    for (const p of filtered) {
      if (p.researchClassification) {
        const list = byClass.get(p.researchClassification) ?? [];
        list.push(p);
        byClass.set(p.researchClassification, list);
      } else {
        uncategorized.push(p);
      }
    }
    const sections: { key: string; label: string; description?: string; products: Product[] }[] = [];
    for (const key of CLASSIFICATION_ORDER) {
      const groupProducts = byClass.get(key);
      if (groupProducts && groupProducts.length > 0) {
        sections.push({
          key,
          label: CLASSIFICATION_LABELS[key] ?? key,
          description: CLASSIFICATION_SECTION_BLURB[key],
          products: groupProducts,
        });
      }
    }
    if (uncategorized.length > 0) {
      sections.push({ key: UNCATEGORIZED_KEY, label: 'Other', products: uncategorized });
    }
    return sections;
  }, [filtered]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      <header className="mb-[var(--space-3)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Research Supplies · Biopeptide
        </p>
        <h1 className="text-[clamp(1.5rem,2.8vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Biopeptide </span>
          <span className="font-light text-ink">research supplies.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[13px] leading-relaxed">
          Lyophilized peptides, sourced for research-grade consistency. Use the shipping-tier
          chips to switch between compounds cleared for{' '}
          <span className="text-ink/80">24-hour dispatch</span> and the wider catalog sourced
          to order within 7–10 business days.{' '}
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
        shippingTiers={{
          fast: fastOn,
          sourced: sourcedOn,
          onToggleFast: () => setFastOn((v) => !v),
          onToggleSourced: () => setSourcedOn((v) => !v),
        }}
        search={search}
        onSearch={setSearch}
        suggestions={suggestions}
        searchPlaceholder="Search peptides…"
      />

      {loading || error || filtered.length === 0 ? (
        <ProductGrid
          products={filtered}
          loading={loading}
          error={error}
          emptyLabel="No biopeptide research supplies match the active filter."
          onInspect={setInspectedId}
          compact
        />
      ) : (
        <div>
          {groupedSections.map((section) => (
            <CompoundSection
              key={section.key}
              sectionKey={section.key}
              label={section.label}
              description={section.description}
              products={section.products}
              onInspect={setInspectedId}
              only24hrDoses={showFastOnly}
            />
          ))}
        </div>
      )}

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
