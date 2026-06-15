/**
 * Research — Research Intelligence Library
 *
 * Intelligence-first archive. The Retatrutide dossier (shown inline on
 * the Landing carousel) is the prototype; this page is the collection
 * of those dossiers. Each row opens the canonical
 * CompoundIntelligenceOverlay — the same dossier experience used
 * everywhere else on the platform.
 *
 * Framing: NOT a catalog, NOT inventory, NOT procurement. This page
 * answers "What is this compound?" Procurement-framed browsing lives
 * at /catalog, /research-supplies, /laboratory-equipment.
 *
 * Scope: compounds only. The dataset is filtered to
 * `productType === 'peptide'`. Equipment, consumables, and solvents
 * live in the procurement surfaces and are not surfaced here.
 *
 * Implementation: reuses the canonical primitives (useProducts,
 * InventoryList, CompoundIntelligenceOverlay, PillTabs). No new
 * components, no parallel system.
 */

import { useMemo, useState } from 'react';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';

const ALL_TAB = '__all__';
const MAX_CLASS_TABS = 8;

export function Research() {
  const { products: allProducts, loading, error } = useProducts();

  // Intelligence-first scope: compounds only. The procurement surfaces
  // continue to carry equipment, consumables, and solvents.
  const compounds = useMemo(
    () => allProducts.filter((p) => p.productType === 'peptide'),
    [allProducts],
  );

  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // Pharmacological classification tabs — the only filter dimension the
  // library exposes. Type tabs are unnecessary (everything here is a
  // peptide).
  const classificationTabs = useMemo<PillTab[]>(() => {
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All Compounds' }];
    for (const p of compounds) {
      if (p.researchClassification && !seen.has(p.researchClassification)) {
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
  }, [compounds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return compounds.filter((p) => {
      if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
      if (q.length === 0) return true;
      const hay = `${p.name} ${p.sku} ${p.shortDescription ?? ''} ${p.family ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [compounds, query, classFilter]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? compounds.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, compounds],
  );

  const totalLabel = loading
    ? 'Loading intelligence records…'
    : `${filtered.length}${filtered.length !== compounds.length ? ` of ${compounds.length}` : ''} ${filtered.length === 1 ? 'compound' : 'compounds'} on record`;

  return (
    <section className="py-[var(--space-8)]">
      {/* Header — intelligence archive framing. Holo register. */}
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Research Intelligence Library
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Compounds </span>
          <span className="font-medium text-ink">on record.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-3)] max-w-[58ch] text-[13px] leading-relaxed">
          Every compound on record — mechanism, receptor activity,
          signaling pathway, published studies, regulatory posture.
          Sourced and citable. Open any compound to read its full
          intelligence dossier.
        </p>
      </header>

      {/* Search */}
      <div className="mb-[var(--space-4)]">
        <label className="sr-only" htmlFor="research-search">
          Search compounds
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
            id="research-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by compound, abbreviation, or family…"
            className="w-full bg-ink/[0.04] border border-ink/[0.09] rounded-2xl pl-10 pr-10 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:outline-none focus:bg-ink/[0.06] focus:border-ink/[0.18] transition-colors"
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

      {/* Pharmacological classification filter */}
      {classificationTabs.length > 1 && (
        <div className="mb-[var(--space-4)]">
          <PillTabs
            tabs={classificationTabs}
            activeId={classFilter}
            onChange={setClassFilter}
            ariaLabel="Filter by pharmacological classification"
          />
        </div>
      )}

      <p
        className="text-[11px] uppercase tracking-[0.2em] text-ink/40 mb-[var(--space-4)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {totalLabel}
      </p>

      <ProductGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel={
          query.trim().length > 0
            ? `No compounds match "${query.trim()}".`
            : 'No compounds match the active filters.'
        }
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
