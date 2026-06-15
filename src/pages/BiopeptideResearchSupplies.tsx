import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { BiopeptideInventoryModal } from '../components/catalog/BiopeptideInventoryModal';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';
import { ClassificationFilter } from '../components/catalog/ClassificationFilter';
import { inStockByKey } from '../lib/stock';

const ALL_TAB = '__all__';

const ALL_LAYMAN =
  'The full biopeptide catalog — tap a category to filter the list and read what it does in plain terms. Swipe right for the technical detail.';
const ALL_DESCRIPTION =
  'The complete biopeptide catalog. Pick a class to narrow the list and read what it covers.';

export function BiopeptideResearchSupplies() {
  const { products, loading, error } = useProducts('biopeptide-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inStockOnly, setInStockOnly] = useState(false);
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

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
      if (inStockOnly && !inStockByKey(p.id)) return false;
      return true;
    });
  }, [products, classFilter, inStockOnly]);

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  return (
    <section className="py-[var(--space-8)]">
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <div className="flex flex-col gap-[var(--space-5)] sm:flex-row sm:items-end sm:justify-between sm:gap-[var(--space-6)]">
          <div className="min-w-0">
            <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
              Research Supplies · Biopeptide
            </p>
            <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
              <span className="font-light text-ink/85">Biopeptide </span>
              <span className="font-medium text-ink">research supplies.</span>
            </h1>
            <p className="holo-text-body mt-[var(--space-3)] max-w-[56ch] text-[13px] leading-relaxed">
              Lyophilized peptides, sourced for research-grade consistency.
              Open the full inventory for the complete list view, and filter to{' '}
              <span className="text-ink/80">in-stock</span> compounds to surface the
              selections cleared for our fastest dispatch. Anything not currently
              stocked can be reserved by inquiry for a scheduled later shipment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInventoryOpen(true)}
            className="inv-metal-pill cta-holo group relative inline-flex shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-[11px] py-[6px] text-[9px] uppercase tracking-[0.18em] transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 sm:self-end sm:mb-[var(--space-6)] sm:mr-[calc(var(--space-16)*2+var(--space-6))]"
          >
            <span aria-hidden="true" className="cta-holo-sheen pointer-events-none absolute inset-0" />
            <span className="inv-metal-text relative font-medium">View full inventory</span>
            <span aria-hidden="true" className="inv-metal-text relative text-[10px]">↗</span>
          </button>
        </div>
      </header>

      {/* Filter — vertical accordion: tap a category to expand its plain-English
          description (swipe right for the technical version). */}
      <ClassificationFilter
        tabs={classificationTabs}
        value={classFilter}
        onChange={setClassFilter}
        allLayman={ALL_LAYMAN}
        allTechnical={ALL_DESCRIPTION}
        inStock={{ on: inStockOnly, toggle: () => setInStockOnly((v) => !v) }}
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

      {/* Metallic chrome + glow for the "View full inventory" CTA — matches
          the polished-steel header wordmark, with an outer silver glow. */}
      <style>{`
        .inv-metal-pill {
          background: linear-gradient(180deg, rgba(58,60,64,0.55) 0%, rgba(22,23,26,0.62) 100%) !important;
          border: 0.5px solid rgba(214,218,224,0.42) !important;
          box-shadow:
            0 0 0 0.5px rgba(210,214,222,0.18),
            0 0 14px rgba(214,220,230,0.30),
            0 0 30px rgba(182,192,204,0.18),
            inset 0 1px 0 rgba(255,255,255,0.28),
            inset 0 -1px 0 rgba(0,0,0,0.40) !important;
        }
        .inv-metal-pill:hover {
          border-color: rgba(236,239,244,0.62) !important;
          box-shadow:
            0 0 0 0.5px rgba(225,229,236,0.30),
            0 0 22px rgba(226,231,241,0.50),
            0 0 46px rgba(26,23,20,0.30),
            inset 0 1px 0 rgba(255,255,255,0.40),
            inset 0 -1px 0 rgba(0,0,0,0.40) !important;
        }
        .inv-metal-pill .cta-holo-sheen {
          background: linear-gradient(110deg, transparent 35%, rgba(245,248,252,0.45) 50%, transparent 65%) !important;
        }
        .inv-metal-text {
          background: linear-gradient(
            180deg,
            #FFFFFF 0%,
            #EAECEE 18%,
            #BCBFC3 42%,
            #93969B 50%,
            #52555A 50.5%,
            #A1A4A8 65%,
            #DADCDE 84%,
            #F6F7F8 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          filter:
            drop-shadow(0 1px 0 rgba(20,22,26,0.5))
            drop-shadow(0 0 6px rgba(216,221,229,0.45));
        }
      `}</style>
    </section>
  );
}
