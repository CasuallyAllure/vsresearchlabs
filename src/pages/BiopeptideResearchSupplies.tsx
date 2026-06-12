import { useMemo, useState } from 'react';
import { ProductGrid } from '../components/ProductGrid';
import { PillTabs, type PillTab } from '../components/ui/PillTabs';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { BiopeptideInventoryModal } from '../components/catalog/BiopeptideInventoryModal';
import { useProducts } from '../hooks/useProducts';
import { CLASSIFICATION_LABELS } from '../lib/compoundIntelligence';
import { inStockByKey } from '../lib/stock';

const ALL_TAB = '__all__';
const STOCK_GREEN = '#7CD992';

export function BiopeptideResearchSupplies() {
  const { products, loading, error } = useProducts('biopeptide-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  const classificationTabs = useMemo<PillTab[]>(() => {
    const seen = new Set<string>();
    const tabs: PillTab[] = [{ id: ALL_TAB, label: 'All' }];
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
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-white/[0.06]">
        <div className="flex flex-col gap-[var(--space-5)] sm:flex-row sm:items-end sm:justify-between sm:gap-[var(--space-6)]">
          <div className="min-w-0">
            <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
              Research Supplies · Biopeptide
            </p>
            <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-white">
              <span className="font-light text-white/85">Biopeptide </span>
              <span className="font-medium text-white">research supplies.</span>
            </h1>
            <p className="holo-text-body mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed">
              Lyophilized peptides sourced for research-grade consistency.
              Click any compound to open compound intelligence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInventoryOpen(true)}
            className="inv-metal-pill cta-holo group relative inline-flex shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-[11px] py-[6px] text-[9px] uppercase tracking-[0.18em] transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 sm:self-end sm:mb-[var(--space-6)] sm:mr-[calc(var(--space-16)*2+var(--space-6))]"
          >
            <span aria-hidden="true" className="cta-holo-sheen pointer-events-none absolute inset-0" />
            <span className="inv-metal-text relative font-medium">View full inventory</span>
            <span aria-hidden="true" className="inv-metal-text relative text-[10px]">↗</span>
          </button>
        </div>
      </header>

      {/* Stock toggle — tiny pill above the category filters. */}
      <div className="mb-[var(--space-4)]">
        <button
          type="button"
          role="switch"
          aria-checked={inStockOnly}
          onClick={() => setInStockOnly((v) => !v)}
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35',
            inStockOnly
              ? 'text-white'
              : 'border-white/15 text-white/45 hover:text-white/75 hover:border-white/25',
          ].join(' ')}
          style={
            inStockOnly
              ? {
                  borderColor: `${STOCK_GREEN}80`,
                  backgroundColor: `${STOCK_GREEN}18`,
                  boxShadow: `0 0 10px ${STOCK_GREEN}33`,
                }
              : undefined
          }
        >
          <span
            aria-hidden="true"
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{
              backgroundColor: inStockOnly ? STOCK_GREEN : 'rgba(255,255,255,0.3)',
              boxShadow: inStockOnly ? `0 0 5px ${STOCK_GREEN}aa` : undefined,
            }}
          />
          In stock only
        </button>
      </div>

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
        emptyLabel="No biopeptide research supplies match the active filter."
        onInspect={setInspectedId}
        showStock
        showPurchase
      />

      {inspectedProduct && (
        <CompoundIntelligenceOverlay
          product={inspectedProduct}
          onClose={() => setInspectedId(null)}
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
            0 0 46px rgba(196,206,217,0.30),
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
