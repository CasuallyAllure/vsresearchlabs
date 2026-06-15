/**
 * LaboratoryEquipment
 *
 * Equipment catalog. PillTabs filter on `equipmentClassification`
 * (General / Biopeptide Sciences / Nootropics Research / Skincare
 * Research) — internal classification within a single domain rather
 * than separate routes.
 *
 * Compound catalogs live under /research-supplies/* and never mix
 * with this surface.
 */

import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { useProducts } from '../hooks/useProducts';
import type { EquipmentClassification } from '../types/product';

const ALL_TAB = '__all__';

const CLASSIFICATION_LABELS: Record<EquipmentClassification, string> = {
  'general': 'General',
  'biopeptide-sciences': 'Biopeptide Sciences',
  'nootropics-research': 'Nootropics Research',
  'skincare-research': 'Skincare Research',
};

const CLASSIFICATION_ORDER: EquipmentClassification[] = [
  'general',
  'biopeptide-sciences',
  'nootropics-research',
  'skincare-research',
];

export function LaboratoryEquipment() {
  const { products, loading, error } = useProducts('laboratory-equipment');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);

  const classificationTabs = useMemo<PillTab[]>(() => {
    const present = new Set<EquipmentClassification>();
    for (const p of products) {
      if (p.equipmentClassification) present.add(p.equipmentClassification);
    }
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All' }];
    for (const key of CLASSIFICATION_ORDER) {
      if (present.has(key)) {
        tabs.push({ id: key, label: CLASSIFICATION_LABELS[key] });
      }
    }
    return tabs;
  }, [products]);

  const filtered = useMemo(() => {
    if (classFilter === ALL_TAB) return products;
    return products.filter((p) => p.equipmentClassification === classFilter);
  }, [products, classFilter]);

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Catalog
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Laboratory </span>
          <span className="font-medium text-ink">equipment.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed">
          Precision instruments, handling tools, consumables, and
          workflow accessories. Filter by research domain to narrow
          the surface to equipment relevant to a single compound vertical.
        </p>
      </header>

      {classificationTabs.length > 1 && (
        <div className="mb-[var(--space-6)]">
          <PillTabs
            tabs={classificationTabs}
            activeId={classFilter}
            onChange={setClassFilter}
            ariaLabel="Filter by equipment classification"
          />
        </div>
      )}

      <ProductGrid
        products={filtered}
        loading={loading}
        error={error}
        emptyLabel="No laboratory equipment matches the active filter."
      />
    </section>
  );
}
