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
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { ClassificationFilter } from '../components/catalog/ClassificationFilter';
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
  const classificationTabs = useMemo<{ id: string; label: string }[]>(() => {
    const seen = new Set<string>();
    const tabs: { id: string; label: string }[] = [{ id: ALL_TAB, label: 'All Compounds' }];
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

  const suggestions = useMemo(
    () => compounds.map((p) => ({ id: p.id, label: p.name })),
    [compounds],
  );

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
      <header className="mb-[var(--space-3)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Research Intelligence Library
        </p>
        <h1 className="text-[clamp(1.5rem,2.8vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Compounds </span>
          <span className="font-medium text-ink">on record.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[13px] leading-relaxed">
          Every compound on record — mechanism, receptor activity, signaling
          pathway, published studies, regulatory posture. Open any compound to
          read its full intelligence dossier.
        </p>
      </header>

      {/* Smart search + classification filter (one compact bar) */}
      <ClassificationFilter
        tabs={classificationTabs}
        value={classFilter}
        onChange={setClassFilter}
        allLayman="Every compound on record. Pick a category to focus the library, or read what each class does in plain terms — swipe right for the technical detail."
        search={query}
        onSearch={setQuery}
        suggestions={suggestions}
        searchPlaceholder="Search compounds, abbreviation, family…"
      />

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
