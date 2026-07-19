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
import { ResearchCompoundGrid } from '../components/catalog/ResearchCompoundGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { ClassificationFilter, type CatalogDensity } from '../components/catalog/ClassificationFilter';
import { ResearchDomainFilter, ALL_DOMAINS } from '../components/catalog/ResearchDomainFilter';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';
import { researchDomainFor, RESEARCH_DOMAIN_ORDER, type ResearchDomain } from '../lib/researchDomain';

const ALL_TAB = '__all__';
const MAX_CLASS_TABS = 8;
const DENSITY_KEY = 'vsr.researchDensity';

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
  const [domainFilter, setDomainFilter] = useState<string>(ALL_DOMAINS);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // Layout density — same control, vocabulary and persistence mechanism as
  // the store catalog, remembered per session so browsing keeps the layout.
  const [density, setDensity] = useState<CatalogDensity>(() => {
    try {
      const saved = sessionStorage.getItem(DENSITY_KEY);
      return saved === 'standard' || saved === 'compact' ? saved : 'detail';
    } catch {
      return 'detail';
    }
  });
  function changeDensity(d: CatalogDensity) {
    setDensity(d);
    try { sessionStorage.setItem(DENSITY_KEY, d); } catch { /* private mode */ }
  }

  // Biological systems present in the dataset, with their record counts.
  const { domains, domainCounts } = useMemo(() => {
    const counts = {} as Partial<Record<ResearchDomain, number>>;
    for (const p of compounds) {
      const d = researchDomainFor(p.researchClassification);
      counts[d] = (counts[d] ?? 0) + 1;
    }
    return {
      domains: RESEARCH_DOMAIN_ORDER.filter((d) => (counts[d] ?? 0) > 0),
      domainCounts: counts,
    };
  }, [compounds]);

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
      if (domainFilter !== ALL_DOMAINS && researchDomainFor(p.researchClassification) !== domainFilter) return false;
      if (q.length === 0) return true;
      const hay = `${p.name} ${p.sku} ${p.shortDescription ?? ''} ${p.family ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [compounds, query, classFilter, domainFilter]);

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
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      {/* Header — intelligence archive framing. Holo register. */}
      <header className="mb-[var(--space-3)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
          Research Intelligence Library
        </p>
        <h1 className="font-serif text-[clamp(1.5rem,2.8vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Compounds </span>
          <span className="font-light text-ink">on record.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[13px] leading-relaxed">
          Every compound on record — mechanism, receptor activity, signaling
          pathway, published studies, regulatory posture. Open any compound to
          read its full intelligence dossier.
        </p>
      </header>

      {/* Biological system studied — the "which part of the body is this
          research in" dimension, derived from the classification. */}
      <ResearchDomainFilter
        domains={domains}
        value={domainFilter}
        onChange={setDomainFilter}
        counts={domainCounts}
      />

      {/* Smart search + classification filter + layout picker (one compact bar) */}
      <ClassificationFilter
        tabs={classificationTabs}
        value={classFilter}
        onChange={setClassFilter}
        allLayman="Every compound on record. Pick a category to focus the library, or read what each class does in plain terms — swipe right for the technical detail."
        search={query}
        onSearch={setQuery}
        suggestions={suggestions}
        searchPlaceholder="Search compounds, abbreviation, family…"
        density={{ value: density, onChange: changeDensity }}
      />

      <p
        className="text-[11px] uppercase tracking-[0.2em] text-ink/40 mb-[var(--space-4)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {totalLabel}
      </p>

      <ResearchCompoundGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel={
          query.trim().length > 0
            ? `No compounds match "${query.trim()}".`
            : 'No compounds match the active filters.'
        }
        onInspect={setInspectedId}
        density={density}
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
