/**
 * ProductPage — Laboratory Specification Sheet
 *
 * This page states what is supplied; it does not discuss what the
 * compound is studied for. All scientific content — mechanism of action,
 * receptor/target activity, signaling pathway, and the published study
 * record — lives in exactly one place, the shared
 * CompoundIntelligenceOverlay (the research dossier), which this page
 * mounts on demand from the ResearchDossierBand. The overlay is reused
 * verbatim, never forked.
 *
 * Layout shell:
 *
 *   - Sticky left reference column: compound visual zone (molecular +
 *     vial, stacked variant), identifier band (name / abbreviation / SKU
 *     / CAS / MW), a compact research-use + FDA-status chip row,
 *     interactive tier strip, quantity + Add to Inquiry, price. Image
 *     gallery on mobile only.
 *
 *   - Scrollable right column: the dossier band, then the spec-sheet
 *     module stack — Description, Analytical Specifications, Procurement
 *     & Handling, Documentation. Each rendered via IntelModule.
 *
 * URL contracts:
 *   - `?tier=<dose>`  → drives initial selected tier on mount and is
 *     updated on user selection (replace, no history pollution).
 *   - `#<module-key>` → opens the matching module on mount and smooth-
 *     scrolls it into view. Valid keys: summary, specifications,
 *     procurement, documentation.
 *
 * No intelligence-data field is accessed directly off `product`. All
 * compound knowledge routes through `getCompoundIntelligence(product)`.
 * Procurement field reads are encapsulated by `ProcurementSheet`;
 * analytical spec reads by `SpecificationSheet`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useProduct } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';
import { variantProduct } from '../lib/cartActions';
import { useProductOverrides, isSkuVisible } from '../lib/productOverrides';
import { useDocumentsByProduct } from '../hooks/useDocuments';
import { getCompoundIntelligence } from '../lib/compoundIntelligence';
import { AbbreviationChip } from '../components/catalog/AbbreviationChip';
import { CompoundVisualZone } from '../components/catalog/specimen/CompoundVisualZone';
import {
  IntelModule,
  IntelModuleStyles,
  ModuleBody,
} from '../components/catalog/intelligence/IntelModule';
import { CompoundIntelligenceOverlay } from '../components/catalog/CompoundIntelligenceOverlay';
import { ResearchDossierBand } from '../components/product/ResearchDossierBand';
import {
  SpecificationSheet,
  selectSpecificationRows,
} from '../components/product/SpecificationSheet';
import { RegulatoryChipCluster } from '../components/catalog/intelligence/RegulatoryChipCluster';
import { TierStrip } from '../components/catalog/intelligence/TierStrip';
import {
  ProcurementSheet,
  selectProcurementRows,
} from '../components/catalog/intelligence/ProcurementSheet';
import { QuantityStepper } from '../components/catalog/intelligence/QuantityStepper';
import { SKUCode, ProcurementValue } from '../components/ui/identifiers';
import { Button } from '../components/ui/Button';
import { DocumentSlot } from '../components/documents/DocumentSlot';
import { ErrorState } from '../components/system/ErrorState';

// ─── Module key contract ──────────────────────────────────────────────────

const MODULE_KEYS = [
  'summary',
  'specifications',
  'procurement',
  'documentation',
] as const;
type ModuleKey = (typeof MODULE_KEYS)[number];

function isValidModuleKey(s: string): s is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(s);
}

interface ModuleDef {
  key: ModuleKey;
  title: string;
  defaultOpen?: boolean;
  render: () => ReactNode;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { product, error } = useProduct(id);
  const addToInquiry = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);

  // Subscribe to the overrides store so this recomputes once inventory loads.
  // A SKU whose product_stock row is hidden (or soft-deleted) must not be
  // reachable by deep link either — otherwise a hidden compound (e.g. an
  // unpriced SKU pulled from sale) still renders addable dose chips here and
  // dead-ends at a checkout refusal. Catalog grids already filter on this;
  // the direct /product/:id route did not.
  useProductOverrides((s) => s.bySku);
  const skuHidden = product ? !isSkuVisible(product.sku) : false;

  const productDocs = useDocumentsByProduct(product?.abbreviation);

  // Single read of Product → normalized view-model.
  const ci = useMemo(() => (product ? getCompoundIntelligence(product) : null), [product]);

  // Hash → initial open module. Captured once at mount; later toggles
  // are uncontrolled and do not write back to the URL.
  const [initialHash] = useState<ModuleKey | ''>(() => {
    if (typeof window === 'undefined') return '';
    const raw = window.location.hash.replace('#', '');
    return isValidModuleKey(raw) ? raw : '';
  });

  // Tier param → initial selected tier index.
  const initialTierIndex = useMemo(() => {
    if (!ci || ci.tiers.length === 0) return 0;
    const tierParam = searchParams.get('tier');
    if (tierParam) {
      const idx = ci.tiers.findIndex((v) => v.dose === tierParam);
      if (idx >= 0) return idx;
    }
    const idx = ci.tiers.findIndex((v) => v.dose === ci.activeDose);
    return idx >= 0 ? idx : 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- captured at mount only
  }, [ci]);

  const [selectedTierIndex, setSelectedTierIndex] = useState(initialTierIndex);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  // The research dossier is the shared CompoundIntelligenceOverlay, mounted
  // on demand. Same component the catalog and /research mount — not a fork.
  const [dossierOpen, setDossierOpen] = useState(false);

  // Reset gallery selection when route changes.
  useEffect(() => { setActiveImageIndex(0); }, [product?.id]);

  // Smooth-scroll the hash-targeted module into view after first paint.
  useEffect(() => {
    if (!initialHash || !product) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`module-${initialHash}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 180);
    return () => window.clearTimeout(t);
  }, [initialHash, product]);

  function handleTierSelect(idx: number) {
    setSelectedTierIndex(idx);
    if (!ci) return;
    const dose = ci.tiers[idx]?.dose;
    if (!dose) return;
    const next = new URLSearchParams(searchParams);
    next.set('tier', dose);
    setSearchParams(next, { replace: true });
  }

  function handleAddToInquiry() {
    if (!product) return;
    const dose = ci?.tiers[selectedTierIndex]?.dose ?? ci?.activeDose ?? '';
    const line = variantProduct(product, dose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) {
      updateQuantity(line.id, existing.quantity + quantity);
    } else {
      addToInquiry(line);
      if (quantity > 1) updateQuantity(line.id, quantity);
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  if (error || !product || !ci || skuHidden) {
    return (
      <ErrorState
        message={error ?? (skuHidden ? 'This compound is not currently available.' : 'Inventory record could not be resolved.')}
        action={
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-xs uppercase tracking-widest text-ink/60 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            Go back
          </button>
        }
      />
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const activeTier = ci.tiers[selectedTierIndex] ?? null;
  const activeDoseLabel = activeTier?.dose ?? ci.activeDose;

  const images = product.images ?? [];
  const safeIndex = images.length > 0 ? Math.min(activeImageIndex, images.length - 1) : 0;
  const activeImageUrl = images[safeIndex] ?? null;
  const hasGallery = images.length > 1;

  const categoryLabel = product.category.replace(/-/g, ' ');
  const categoryHref = `/${product.category}`;
  const outOfStock = product.stock === 0;
  const procurementRowCount = selectProcurementRows(product).length;
  const specificationRowCount = selectSpecificationRows(product).length;

  // ─── Module definitions ───────────────────────────────────────────────────

  const modules: ModuleDef[] = [];

  // Description — the supplied product's own description. `laymanSummary`
  // and every scientific module moved to the dossier. The long and short
  // descriptions are mutually exclusive here so the same prose can never
  // render twice on one page.
  const description = product.longDescription || product.shortDescription;
  if (description) {
    modules.push({
      key: 'summary',
      title: 'Description',
      defaultOpen: true,
      render: () => (
        <ModuleBody>
          <p className="text-ink/65 leading-[1.65] whitespace-pre-line" style={{ fontSize: '13px', maxWidth: '65ch' }}>
            {description}
          </p>
        </ModuleBody>
      ),
    });
  }

  if (specificationRowCount > 0) {
    modules.push({
      key: 'specifications',
      title: 'Analytical Specifications',
      defaultOpen: true,
      render: () => (
        <div className="px-[var(--space-4)] py-[var(--space-5)]">
          <SpecificationSheet product={product} />
        </div>
      ),
    });
  }

  if (procurementRowCount > 0) {
    modules.push({
      key: 'procurement',
      title: 'Procurement & Handling',
      defaultOpen: true,
      render: () => (
        <div className="px-[var(--space-4)] py-[var(--space-5)]">
          <ProcurementSheet product={product} variant="full" />
        </div>
      ),
    });
  }
  // Documentation module — always renders. The four slot rows (COA,
  // HPLC, Mass Spec, Sterility) are shown regardless of whether files
  // exist yet. Empty slots read as "Awaiting Upload" — the documentation
  // architecture is visible before files exist.
  modules.push({
    key: 'documentation',
    title: 'Documentation',
    render: () => (
      <div className="px-[var(--space-4)] py-[var(--space-5)]">
        <DocumentSlot documents={productDocs} />
      </div>
    ),
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <article className="pb-[var(--space-24)] lg:pb-[var(--space-8)]">
      {/* Breadcrumb */}
      <nav className="mb-[var(--space-5)] text-xs uppercase tracking-widest holo-text-caption">
        <Link to="/" className="hover:text-holo-light transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/30">
          Home
        </Link>
        <span className="mx-[var(--space-2)] text-ink/20">/</span>
        <Link to={categoryHref} className="hover:text-holo-light transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/30">
          {categoryLabel}
        </Link>
        <span className="mx-[var(--space-2)] text-ink/20">/</span>
        <span className="holo-text-body normal-case tracking-normal">{ci.substance}</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:gap-x-[var(--space-8)] lg:items-start">

        {/* ─── STICKY LEFT — Operational reference column ──────────────── */}
        <aside
          className="floating-module overflow-hidden [&>*:last-child]:border-b-0 lg:w-[440px] lg:shrink-0 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:overflow-x-hidden mb-[var(--space-6)] lg:mb-0"
          aria-label="Compound reference and inquiry"
        >
          {/* Desktop visual identity zone */}
          <CompoundVisualZone
            substance={ci.substance}
            abbreviation={ci.abbreviation}
            sku={ci.sku}
            activeDoseLabel={activeDoseLabel}
            variant="stacked"
            imageUrl={product.images?.[0] ?? null}
          />

          {/* Mobile image gallery — replaces the visual zone at < lg */}
          {activeImageUrl && (
            <div className="lg:hidden border-b border-ink/[0.05]">
              <div className="aspect-[4/3] w-full overflow-hidden bg-display">
                <img src={activeImageUrl} alt={product.name} className="h-full w-full object-cover" />
              </div>
              {hasGallery && (
                <div
                  className="flex gap-[var(--space-2)] overflow-x-auto px-[var(--space-3)] py-[var(--space-3)]"
                  role="tablist"
                  aria-label="Product images"
                >
                  {images.map((url, idx) => {
                    const isActive = idx === safeIndex;
                    return (
                      <button
                        key={url + idx}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-label={`View image ${idx + 1} of ${images.length}`}
                        onClick={() => setActiveImageIndex(idx)}
                        className={[
                          'shrink-0 w-14 h-14 overflow-hidden rounded-[10px] bg-display border transition-colors',
                          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                          isActive ? 'border-ink' : 'border-ink/[0.06] hover:border-ink/20',
                        ].join(' ')}
                      >
                        <img src={url} alt={`${product.name} - image ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Identifier band */}
          <div className="px-[var(--space-4)] py-[var(--space-5)] border-b border-ink/[0.05]">
            <div className="flex items-center gap-2 mb-[var(--space-2)] flex-wrap">
              <AbbreviationChip value={ci.abbreviation} />
              <span className="text-[10px] uppercase tracking-[0.25em] text-ink/45">{ci.family}</span>
            </div>
            <h1 className="holo-text-display font-light leading-tight mb-[var(--space-1)]" style={{ fontSize: '19px', letterSpacing: '-0.01em' }}>
              {ci.substance}
            </h1>
            <p className="text-ink/60" style={{ fontSize: '11.5px' }}>
              {product.name}
            </p>
            <div className="mt-[var(--space-3)] flex flex-wrap gap-x-[var(--space-3)] gap-y-1 items-center">
              <span className="font-mono text-ink/35 tabular-nums" style={{ fontSize: '10px', letterSpacing: '0.16em' }}>
                SKU <SKUCode value={ci.sku} className="text-ink/55" />
              </span>
              {ci.casNumber && (
                <>
                  <span className="text-ink/15" aria-hidden="true">·</span>
                  <span className="font-mono text-ink/35 tabular-nums" style={{ fontSize: '10px', letterSpacing: '0.16em' }}>
                    CAS <span className="text-ink/55">{ci.casNumber}</span>
                  </span>
                </>
              )}
              {ci.molecularWeight && (
                <>
                  <span className="text-ink/15" aria-hidden="true">·</span>
                  <span className="font-mono text-ink/35 tabular-nums" style={{ fontSize: '10px', letterSpacing: '0.16em' }}>
                    MW <span className="text-ink/55">{ci.molecularWeight}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Regulatory chip cluster */}
          {(ci.humanTrials !== undefined || ci.fdaStatus) && (
            <div className="px-[var(--space-4)] py-[var(--space-5)] border-b border-ink/[0.05]">
              <RegulatoryChipCluster humanTrials={ci.humanTrials} fdaStatus={ci.fdaStatus} />
            </div>
          )}

          {/* Tier strip (interactive) */}
          {ci.tiers.length > 0 && (
            <div className="px-[var(--space-4)] py-[var(--space-5)] border-b border-ink/[0.05]">
              <p className="text-ink/30 uppercase mb-[var(--space-2)]" style={{ fontSize: '11px', letterSpacing: '0.22em' }}>
                Available Tiers
              </p>
              <TierStrip
                mode="select"
                sku={product.sku}
                variants={ci.tiers}
                selectedIndex={selectedTierIndex}
                onSelect={handleTierSelect}
              />
            </div>
          )}

          {/* Quantity + Add to Inquiry — desktop and tablet only */}
          <div className="hidden lg:block px-[var(--space-4)] py-[var(--space-5)] border-b border-ink/[0.05]">
            <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-2)]">
              <QuantityStepper quantity={quantity} onChange={setQuantity} />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={handleAddToInquiry}
                disabled={outOfStock}
                className="flex-1"
              >
                {outOfStock ? 'Unavailable' : added ? 'Added to Inquiry' : 'Add to Inquiry'}
              </Button>
            </div>
            {(activeTier || quantity > 1) && (
              <p className="text-ink/30 font-mono tabular-nums" style={{ fontSize: '10px', letterSpacing: '0.06em' }}>
                {[
                  activeTier?.dose,
                  activeTier?.sku ? `SKU ${activeTier.sku}` : null,
                  `${quantity} ${quantity === 1 ? 'unit' : 'units'}`,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            {product.priceCents != null && (
              <p className="mt-[var(--space-2)]">
                <ProcurementValue cents={product.priceCents} className="text-sm text-ink/70" />
              </p>
            )}
          </div>

        </aside>

        {/* ─── SCROLLABLE RIGHT — Module stack ───────────────────────────── */}
        <div className="flex-1 min-w-0 lg:max-w-[680px] lg:overflow-visible">
          <ResearchDossierBand substance={ci.substance} onOpen={() => setDossierOpen(true)} />
          <div className="floating-module overflow-hidden">
            {modules.map((mod, i) => (
              <div key={mod.key} id={`module-${mod.key}`}>
                <IntelModule
                  index={i + 1}
                  title={mod.title}
                  defaultOpen={mod.key === initialHash || mod.defaultOpen}
                >
                  {mod.render()}
                </IntelModule>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile sticky action bar — sits above the floating BottomNav pill
          (pill is 36px tall + safe-area inset from viewport bottom). */}
      <div
        className="lg:hidden fixed left-0 right-0 z-40"
        style={{
          bottom: 'calc(max(2px, env(safe-area-inset-bottom)) + 44px)',
          backgroundColor: 'var(--color-surface-elevated)',
          borderTop: '1px solid var(--color-border-default)',
        }}
        role="region"
        aria-label="Add to inquiry"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-4)] py-[var(--space-3)] flex items-center gap-[var(--space-2)]">
          <QuantityStepper quantity={quantity} onChange={setQuantity} />
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={handleAddToInquiry}
            disabled={outOfStock}
            className="flex-1"
          >
            {outOfStock ? 'Unavailable' : added ? 'Added to Inquiry' : 'Add to Inquiry'}
          </Button>
        </div>
      </div>

      {/* Research dossier — the shared overlay, mounted on demand. */}
      {dossierOpen && (
        <CompoundIntelligenceOverlay product={product} onClose={() => setDossierOpen(false)} />
      )}

      <IntelModuleStyles />
    </article>
  );
}
