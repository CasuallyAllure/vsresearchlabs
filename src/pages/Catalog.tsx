import { useMemo, useState } from 'react';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { InventoryList } from '../components/catalog/InventoryList';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { useProducts } from '../hooks/useProducts';
import { ErrorState } from '../components/system/ErrorState';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';
import type { ProductType } from '../types';
import { ServiceReviews } from '../components/order/ServiceReviews';

const ALL_TAB = '__all__';
const MAX_CLASS_TABS = 8;

const TYPE_LABELS: Record<ProductType, string> = {
  peptide: 'Peptides',
  solvent: 'Solvents',
  consumable: 'Consumables',
  equipment: 'Equipment',
};

export function Catalog() {
  const { products, loading, error } = useProducts();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TAB);
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // ─── Tier-1: product type tabs ──────────────────────────────────────
  const typeTabs = useMemo<PillTab[]>(() => {
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All' }];
    for (const p of products) {
      if (p.productType && !seen.has(p.productType)) {
        seen.add(p.productType);
        tabs.push({ id: p.productType, label: TYPE_LABELS[p.productType] ?? p.productType });
      }
    }
    return tabs;
  }, [products]);

  // ─── Tier-2: classification tabs (peptides only) ─────────────────────
  const classificationTabs = useMemo<PillTab[]>(() => {
    if (typeFilter !== 'peptide') return [];
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All Peptides' }];
    for (const p of products) {
      if (
        p.productType === 'peptide' &&
        p.researchClassification &&
        !seen.has(p.researchClassification)
      ) {
        seen.add(p.researchClassification);
        if (tabs.length <= MAX_CLASS_TABS) {
          tabs.push({
            id: p.researchClassification,
            label: CLASSIFICATION_LABELS[p.researchClassification] ?? p.researchClassification,
          });
        }
      }
    }
    return tabs;
  }, [products, typeFilter]);

  // When type filter changes, reset classification filter
  function handleTypeChange(id: string) {
    setTypeFilter(id);
    setClassFilter(ALL_TAB);
  }

  // ─── Filter pipeline ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== ALL_TAB && p.productType !== typeFilter) return false;
      if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
      if (q.length === 0) return true;
      const hay = `${p.name} ${p.sku} ${p.shortDescription ?? ''} ${p.family ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, query, typeFilter, classFilter]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  // ─── Result meta ─────────────────────────────────────────────────────
  const totalLabel = loading
    ? 'Loading inventory…'
    : `${filtered.length}${filtered.length !== products.length ? ` of ${products.length}` : ''} ${filtered.length === 1 ? 'SKU' : 'SKUs'}`;

  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      {/* Header */}
      <header className="mb-[var(--space-4)] pb-[var(--space-4)] border-b border-ink/[0.06]">
        <p className="text-[10px] uppercase tracking-[0.28em] text-ink/40 mb-[var(--space-2)]">
          Catalog
        </p>
        <h1 className="text-2xl sm:text-3xl font-light text-ink tracking-tight">
          Inventory
        </h1>
        <p className="mt-[var(--space-2)] text-[13px] leading-relaxed text-ink/55 max-w-[52ch]">
          Full SKU list across all categories. Click any row to open compound
          intelligence. Add directly to inquiry.
        </p>
      </header>

      {/* Search */}
      <div className="mb-[var(--space-4)]">
        <label className="sr-only" htmlFor="catalog-search">
          Search inventory
        </label>
        <div className="relative">
          <svg
            className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="catalog-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU, or description…"
            className="w-full bg-base-700 border border-ink/12 rounded-field pl-9 pr-9 py-[11px] text-[14px] text-ink placeholder:text-ink/30 shadow-[inset_0_1px_2px_rgba(26,23,20,0.035)] hover:border-ink/20 focus:outline-none focus:border-gold/70 focus:ring-2 focus:ring-gold/15 transition-[border-color,box-shadow] duration-150"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-[var(--space-3)] top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tier-1: type filter */}
      {typeTabs.length > 1 && (
        <div className="mb-[var(--space-3)]">
          <PillTabs
            tabs={typeTabs}
            activeId={typeFilter}
            onChange={handleTypeChange}
            ariaLabel="Filter by product type"
          />
        </div>
      )}

      {/* Tier-2: classification filter (peptides only) */}
      {classificationTabs.length > 1 && (
        <div className="mb-[var(--space-4)]">
          <PillTabs
            tabs={classificationTabs}
            activeId={classFilter}
            onChange={setClassFilter}
            ariaLabel="Filter by research classification"
          />
        </div>
      )}

      {/* Result count */}
      <p
        className="text-[11px] uppercase tracking-[0.2em] text-ink/40 mb-[var(--space-4)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {totalLabel}
      </p>

      {error && <ErrorState message="Inventory query failed." />}

      {!error && (
        <InventoryList
          products={filtered}
          loading={loading}
          emptyLabel={
            query.trim().length > 0
              ? `No inventory matches "${query.trim()}".`
              : 'No matching inventory.'
          }
          onInspect={setInspectedId}
        />
      )}

      {inspectedProduct && (
        <CompoundIntelligenceOverlay
          product={inspectedProduct}
          onClose={() => setInspectedId(null)}
        />
      )}

      {/* Approved fulfilment feedback from completed orders (089). Renders
          nothing until the first review is approved. */}
      <ServiceReviews />
    </section>
  );
}
