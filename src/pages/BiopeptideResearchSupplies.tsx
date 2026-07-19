import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../types';
import { ProductGrid } from '../components/ProductGrid';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { BiopeptideInventoryModal } from '../components/catalog/BiopeptideInventoryModal';
import { CompoundSection } from '../components/catalog/CompoundSection';
import { BundleOfferTile } from '../components/catalog/BundleOfferTile';
import { NewlyCatalogedSpotlight } from '../components/catalog/NewlyCatalogedSpotlight';
import { CatalogFeatureRow, FEATURE_SLIDE } from '../components/catalog/CatalogFeatureRow';
import { useProducts } from '../hooks/useProducts';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATION_ORDER,
  CLASSIFICATION_SECTION_BLURB,
} from '../lib/compoundIntelligence';
import { ClassificationFilter, type CatalogDensity } from '../components/catalog/ClassificationFilter';
import { useProductOverrides, isSkuInStock, isSkuVisible } from '../lib/productOverrides';
import { isWholesaleEligible } from '../lib/wholesale';
import { useCustomerAuth } from '../lib/customerAuth';

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
  // tier; both (or neither) active shows the full catalog. Both are on by
  // default so the page loads showing every compound — tap a chip off to
  // narrow to the other tier.
  const [fastOn, setFastOn] = useState(true);
  const [sourcedOn, setSourcedOn] = useState(true);
  // Wholesale view — an exclusive mode (case-of-10 business pricing on the
  // sourced tier). While on, the speed chips are ignored (and render dimmed);
  // toggling either speed chip drops back to the regular catalog.
  const [wholesaleOn, setWholesaleOn] = useState(false);
  // Wholesale is ACCOUNT-GATED (owner's rule): anonymous visitors never see
  // case pricing — the toggle prompts sign-in instead of entering the mode.
  // `wholesaleActive` is the effective flag; guarding on it means a stale
  // `wholesaleOn` can never leak wholesale pricing to a signed-out session
  // (e.g. after sign-out). The server (place-order) is the real gate.
  // Wholesale pricing is VISIBLE to everyone — browsing it is fine and good for
  // sales. Only ADDING a case + checking out require an account: gated on the
  // tile's Add button and enforced server-side (place-order). So wholesale never
  // "disappears" for signed-out visitors; they get a sign-in nudge to buy.
  const { user } = useCustomerAuth();
  const canWholesale = !!user;
  const wholesaleActive = wholesaleOn;
  // Grid density (detail / grid / dense) — applies to the regular AND
  // wholesale views. Remembered per session so browsing keeps your layout.
  const [density, setDensity] = useState<CatalogDensity>(() => {
    try {
      const saved = sessionStorage.getItem('vsr.catalogDensity');
      return saved === 'detail' || saved === 'compact' ? saved : 'standard';
    } catch {
      return 'standard';
    }
  });
  function changeDensity(d: CatalogDensity) {
    setDensity(d);
    try { sessionStorage.setItem('vsr.catalogDensity', d); } catch { /* private mode */ }
  }
  const showFastOnly = !wholesaleActive && fastOn && !sourcedOn;
  const showSourcedOnly = !wholesaleActive && sourcedOn && !fastOn;
  const [search, setSearch] = useState('');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // isSkuInStock/isSkuVisible read the override store via getState() (not
  // reactively). Subscribing here re-renders the page — and recomputes
  // `filtered` below — once admin overrides finish loading, so the
  // in-stock-by-default filter doesn't stick with a stale pre-load result.
  const variantOverrides = useProductOverrides((s) => s.variantBySku);
  // `loaded` flips true once the first Supabase fetch attempt resolves
  // (success OR failure — see productOverrides.ts). The 24-hour default
  // filter reads per-dose stock from that same data; applying it before
  // `loaded` is true means every SKU fails `isSkuInStock` (no data yet),
  // producing a false "no compounds" grid on every cold load. Gate the
  // stock-dependent filters on this instead of racing the fetch.
  const overridesLoaded = useProductOverrides((s) => s.loaded);
  // Only the two single-tier filters read per-dose stock data — "All" (both
  // or neither chip active) doesn't narrow by stock, so it has nothing to
  // wait on. Block the grid on the overrides fetch only when it would
  // otherwise render a false "no compounds" empty state. Wholesale reads the
  // same per-dose data (sourced-tier eligibility), so it waits too.
  const awaitingStockData = (showFastOnly || showSourcedOnly || wholesaleActive) && !overridesLoaded;

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
      // Wholesale mode replaces the speed filters: a compound qualifies when
      // it has at least one publicly-priced dose on the sourced (7–10 day)
      // tier — the only tier the owner sells by the case.
      if (wholesaleActive) {
        if (!isWholesaleEligible(p)) return false;
      } else {
        if (showFastOnly && !isSkuInStock(p.sku)) return false;
        if (showSourcedOnly && isSkuInStock(p.sku)) return false;
      }
      if (q.length > 0) {
        const hay = `${p.name} ${p.sku} ${p.abbreviation ?? ''} ${p.family ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, classFilter, showFastOnly, showSourcedOnly, wholesaleActive, search, variantOverrides]);

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
    <section className="pt-[var(--space-2)] pb-[var(--space-8)]">
      <div className="relative isolate mb-[var(--space-3)]">
        <div aria-hidden="true" className="bio-mercury-bg pointer-events-none absolute inset-0 -z-10" />

        <header className="mb-[var(--space-2)]">
          <h1 className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
            Research Supplies · Biopeptide
          </h1>
          <p className="holo-text-body max-w-[60ch] text-[13px] leading-relaxed">
            Lyophilized peptides, research-grade consistency. Toggle{' '}
            <span className="text-ink/80">24-hour dispatch</span> vs. the wider
            standard-shipping catalog (7–10 business days).{' '}
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
            // Touching a speed chip always exits wholesale mode — the chips
            // and the case view describe different catalogs.
            onToggleFast: () => { setWholesaleOn(false); setFastOn((v) => !v); },
            onToggleSourced: () => { setWholesaleOn(false); setSourcedOn((v) => !v); },
            wholesale: { on: wholesaleActive, toggle: () => setWholesaleOn((v) => !v) },
          }}
          density={{ value: density, onChange: changeDensity }}
          search={search}
          onSearch={setSearch}
          suggestions={suggestions}
          searchPlaceholder="Search peptides…"
        />
      </div>

      {/* Featured-supply row. Desktop: two equal floating modules side by side.
          Below sm: a scroll-snap carousel — no JS, no dependency. Either child
          can render nothing (BundleOfferTile hides on unresolved pricing, the
          spotlight on unresolved inventory), in which case the survivor simply
          fills the row. */}
      <CatalogFeatureRow label="Featured supply" className="mb-[var(--space-4)]">
        <BundleOfferTile className={FEATURE_SLIDE} />
        <NewlyCatalogedSpotlight
          products={products}
          onInspect={setInspectedId}
          className={FEATURE_SLIDE}
        />
      </CatalogFeatureRow>

      {wholesaleActive && !canWholesale && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-field)] border border-ink/15 bg-ink/[0.03] px-3.5 py-2.5">
          <span className="text-[12.5px] leading-snug text-ink/70">
            Viewing wholesale case pricing. Sign in to add cases and check out at these prices.
          </span>
          <Link
            to="/account"
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-ink underline decoration-ink/30 underline-offset-2 hover:text-ink/70"
          >
            Sign in
          </Link>
        </div>
      )}

      {loading || error || awaitingStockData || filtered.length === 0 ? (
        <ProductGrid
          products={filtered}
          loading={loading || awaitingStockData}
          error={error}
          emptyLabel={
            wholesaleActive
              ? 'No compounds currently available at wholesale case pricing.'
              : showFastOnly
                ? 'No compounds currently cleared for 24-hour dispatch — try STANDARD.'
                : 'No biopeptide research supplies match the active filter.'
          }
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
              wholesale={wholesaleActive}
              density={density}
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
          wholesale={wholesaleActive}
        />
      )}

      <BiopeptideInventoryModal
        open={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
      />

      <style>{`
        /* Ethereal "mercury stream" backdrop for the header + filter module —
           gives the glass panel something to refract against so it reads as
           real glass instead of flat smoke. Silver + a whisper of graphite
           (--c-teal), theme-aware via channel vars. Transform/opacity only. */
        .bio-mercury-bg {
          background:
            radial-gradient(58% 60% at 14% 0%, rgb(var(--c-ink) / 0.05) 0%, transparent 72%),
            radial-gradient(50% 55% at 88% 6%, rgb(var(--c-teal) / 0.07) 0%, transparent 74%),
            linear-gradient(205deg, rgb(var(--c-ink) / 0.03) 0%, transparent 60%);
          will-change: transform;
        }

        @media (prefers-reduced-motion: no-preference) {
          .bio-mercury-bg {
            animation: bioMercuryDrift 26s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
          }
        }

        @keyframes bioMercuryDrift {
          0%   { transform: translate3d(0, -10px, 0) rotate(0deg); }
          50%  { transform: translate3d(0, 10px, 0) rotate(0.5deg); }
          100% { transform: translate3d(0, -6px, 0) rotate(-0.35deg); }
        }
      `}</style>
    </section>
  );
}
