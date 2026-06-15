/**
 * CompoundIntelligenceOverlay
 *
 * Canonical operational-intelligence surface. Reference implementation
 * of the system's intelligence interaction language: tier-driven
 * passport, stagger-revealed module stack, compound visual identity
 * band (molecular + vial), and synchronous cart merge.
 *
 * Every primitive rendered inside this overlay is now imported from
 * `components/catalog/specimen/` or `components/catalog/intelligence/`.
 * No intelligence-data field is accessed directly off Product — all
 * intelligence reads route through `getCompoundIntelligence(product)`.
 *
 * Surfaces that inherit from this overlay (ProductPage E3, Landing
 * Hero E4, future admin intelligence editor) must mount the same
 * primitives and the same selector — never re-implement these.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';
import { getCompoundIntelligence } from '../../lib/compoundIntelligence';
import { AbbreviationChip } from './AbbreviationChip';
import { CompoundVisualZone } from './specimen/CompoundVisualZone';
import {
  IntelModule,
  IntelModuleStyles,
  ModuleBody,
  ModuleText,
  DataGrid,
  StatChip,
} from './intelligence/IntelModule';
import { StudyCard } from './intelligence/StudyCard';
import { SummaryText } from './intelligence/SummaryText';
import { CompoundVideo } from './intelligence/CompoundVideo';
import { getCompoundVideo } from '../../lib/compoundVideo';
import { RegulatoryChipCluster } from './intelligence/RegulatoryChipCluster';
import { TierStrip } from './intelligence/TierStrip';
import { tierPriceCents, formatPrice } from '../../lib/pricing';
import { ProcurementSheet, selectProcurementRows } from './intelligence/ProcurementSheet';
import { QuantityStepper } from './intelligence/QuantityStepper';

// ─── Overlay-local icons ──────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

interface CompoundIntelligenceOverlayProps {
  product: Product;
  onClose: () => void;
  /** Optional sibling list (typically the current filtered catalog). When
   *  provided, the overlay surfaces prev/next controls + touch-swipe
   *  navigation so the user can carousel through the catalog without
   *  leaving the modal. */
  list?: Product[];
  onNavigate?: (productId: string) => void;
}

export function CompoundIntelligenceOverlay({
  product,
  onClose,
  list,
  onNavigate,
}: CompoundIntelligenceOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);

  // ── Carousel navigation (optional) ────────────────────────────────────────
  // The overlay is stateless about the current selection — parent owns it.
  // We just compute prev/next from the list and notify on navigation.
  const navIndex = (list && list.length > 1)
    ? list.findIndex((p) => p.id === product.id)
    : -1;
  const hasNav = navIndex >= 0 && !!onNavigate;
  const prevProduct = hasNav && navIndex > 0 ? list![navIndex - 1] : null;
  const nextProduct = hasNav && navIndex < (list?.length ?? 0) - 1 ? list![navIndex + 1] : null;
  function goPrev() { if (prevProduct && onNavigate) onNavigate(prevProduct.id); }
  function goNext() { if (nextProduct && onNavigate) onNavigate(nextProduct.id); }

  // Touch swipe state
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);
  function onPanelTouchStart(e: React.TouchEvent) {
    if (!hasNav) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  }
  function onPanelTouchMove(e: React.TouchEvent) {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const dx = e.touches[0].clientX - touchStartXRef.current;
    const dy = e.touches[0].clientY - touchStartYRef.current;
    // Lock to horizontal if the gesture is mostly sideways; otherwise let
    // the inner scroll container take it.
    if (Math.abs(dx) > Math.abs(dy) * 1.4) {
      setDragX(dx * 0.4);
    }
  }
  function onPanelTouchEnd() {
    const threshold = 80;
    if (dragX > threshold && prevProduct) goPrev();
    else if (dragX < -threshold && nextProduct) goNext();
    setDragX(0);
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  }

  // Canonical normalized view-model — single read of Product per render.
  const ci = useMemo(() => getCompoundIntelligence(product), [product]);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onCloseRef.current = onClose; });

  const [selectedTierIndex, setSelectedTierIndex] = useState<number>(() => {
    const idx = ci.tiers.findIndex((v) => v.dose === ci.activeDose);
    return idx >= 0 ? idx : 0;
  });
  const [quantity, setQuantity] = useState(1);

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onCloseRef.current(), 230);
  }

  function handleAddToInquiry() {
    const currentItems = useCart.getState().items;
    const existing = currentItems.find((i) => i.product.id === product.id);
    if (existing) {
      updateQuantity(product.id, existing.quantity + quantity);
    } else {
      add(product);
      if (quantity > 1) updateQuantity(product.id, quantity);
    }
  }

  useEffect(() => {
    const y = window.scrollY;
    document.body.style.cssText = `position:fixed;top:-${y}px;width:100%;overflow-y:scroll`;
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      document.body.style.cssText = '';
      window.scrollTo(0, y);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowLeft' && prevProduct) goPrev();
      if (e.key === 'ArrowRight' && nextProduct) goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevProduct?.id, nextProduct?.id]);

  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLElement>('button, [href]');
    el?.focus();
  }, []);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const activeTier = ci.tiers[selectedTierIndex] ?? null;
  const activeDoseLabel = activeTier?.dose ?? ci.activeDose;
  const priceCents = tierPriceCents(product, activeDoseLabel);

  const passportStats = useMemo(() => {
    const s: Array<{ label: string; value: string; highlight?: boolean }> = [];
    const purity = ci.analytical.find((x) => x.label === 'Purity (HPLC)');
    if (purity) s.push({ label: 'Purity', value: purity.value });
    const form = ci.analytical.find((x) => x.label === 'Form');
    if (form) s.push({ label: 'Form', value: form.value });
    if (ci.molecularWeight) s.push({ label: 'MW', value: ci.molecularWeight });
    return s.slice(0, 4);
  }, [ci]);

  const allSpecs = useMemo(
    () => product.specs.map((s) => ({ label: s.label, value: s.value })),
    [product],
  );

  const video = getCompoundVideo(product);

  const moduleList = useMemo(() => {
    type ModuleDef =
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'text'; content: string }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'tiers' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'datagrid'; rows: Array<{ label: string; value: string }> }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'procurement' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'studies' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'reserved' };

    const defs: ModuleDef[] = [];
    if (ci.mechanismSummary) defs.push({ key: 'mech', title: 'Mechanism of Action', defaultOpen: true, kind: 'text', content: ci.mechanismSummary });
    if (ci.receptorActivity) defs.push({ key: 'receptor', title: 'Receptor / Target Activity', kind: 'text', content: ci.receptorActivity });
    if (ci.pathwaySummary) defs.push({ key: 'pathway', title: 'Signaling Pathway', kind: 'text', content: ci.pathwaySummary });
    if (ci.analytical.length > 0) defs.push({ key: 'analytical', title: 'Analytical Parameters', kind: 'datagrid', rows: ci.analytical });
    if (!ci.hasMolecularIntelligence && allSpecs.length > 0) defs.push({ key: 'specs', title: 'Specifications', kind: 'datagrid', rows: allSpecs });
    if (selectProcurementRows(product).length > 0) defs.push({ key: 'procurement', title: 'Procurement Data', kind: 'procurement' });
    if (ci.hasStudies) defs.push({ key: 'studies', title: 'Known Studies', kind: 'studies' });
    // Research media now renders as a poster at the top of the column; only
    // the reserved placeholder remains for compounds with no clip.
    else if (ci.hasMolecularIntelligence && !video) defs.push({ key: 'media', title: 'Research Media', kind: 'reserved', reserved: true });
    return defs.map((m, i) => ({ ...m, index: i + 1 }));
  }, [ci, allSpecs, product, video]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      {/* Backdrop */}
      <div aria-hidden="true" onClick={handleClose} className="fixed inset-0 z-[70]"
        style={{ backgroundColor: 'rgba(26,23,20,0.45)', animation: closing ? 'cio-bd-out 200ms linear forwards' : 'cio-bd 180ms linear forwards' }} />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6 lg:p-10 pointer-events-none">
        {/* Panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Compound intelligence: ${ci.substance}`}
          className="cio-panel-el pointer-events-auto w-full overflow-hidden flex flex-col relative"
          onTouchStart={onPanelTouchStart}
          onTouchMove={onPanelTouchMove}
          onTouchEnd={onPanelTouchEnd}
          style={{
            maxWidth: '1080px',
            height: 'min(calc(100dvh - 40px), 860px)',
            backgroundColor: '#FBF9F4',
            border: '1px solid rgba(26,23,20,0.10)',
            boxShadow: 'inset 0 1px 0 rgba(26,23,20,0.04), 0 40px 120px rgba(26,23,20,0.22)',
            animation: closing ? 'cio-panel-out 230ms cubic-bezier(0.23, 1, 0.32, 1) forwards' : 'cio-panel 280ms cubic-bezier(0.23, 1, 0.32, 1) forwards',
            transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
            transition: dragX === 0 ? 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)' : undefined,
          }}
        >
          {/* Top bar — carousel nav (when a list is provided) + close.
              Relative (not floating) so it never overlaps the compound title. */}
          <div className="relative z-10 flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid rgba(26,23,20,0.07)' }}>
            {hasNav ? (
              <button
                type="button"
                onClick={goPrev}
                disabled={!prevProduct}
                aria-label={prevProduct ? `Previous: ${prevProduct.name}` : 'No previous compound'}
                className="h-8 w-8 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            ) : (
              <span className="h-8 w-8" aria-hidden="true" />
            )}
            {hasNav && (
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] tabular-nums text-ink/45" aria-live="polite">
                {navIndex + 1} / {list!.length}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {hasNav && (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!nextProduct}
                  aria-label={nextProduct ? `Next: ${nextProduct.name}` : 'No next compound'}
                  className="h-8 w-8 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close compound intelligence"
                className="h-8 w-8 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          {/* ── TOP: Full-width visual identity zone (desktop) ───────────── */}
          <CompoundVisualZone
            substance={ci.substance}
            abbreviation={ci.abbreviation}
            sku={ci.sku}
            activeDoseLabel={activeDoseLabel}
          />

          {/* ── BOTTOM: Two-column layout ─────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

            {/* Left passport — no specimen bay (moved to visual zone above) */}
            <div className="hidden lg:flex flex-col overflow-hidden shrink-0"
              style={{ width: '300px', backgroundColor: '#F4EFE6', borderRight: '1px solid rgba(26,23,20,0.07)' }}>

              {/* Passport header */}
              <div className="px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid rgba(26,23,20,0.07)' }}>
                <span className="text-ink/38 uppercase" style={{ fontSize: '9px', letterSpacing: '0.28em' }}>
                  {ci.classificationLabel || 'Compound'}
                </span>
              </div>

              {/* Compound identity */}
              <div className="px-4 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(26,23,20,0.06)' }}>
                <div className="flex items-center gap-2 min-w-0 mb-2">
                  <AbbreviationChip value={ci.abbreviation} />
                </div>
                <h2 className="text-ink font-medium leading-tight" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>
                  {ci.substance}
                </h2>
                {(ci.casNumber || ci.molecularWeight) && (
                  <div className="mt-2 space-y-0.5">
                    {ci.casNumber && (
                      <p className="font-mono text-ink/40 tabular-nums" style={{ fontSize: '10px' }}>
                        CAS <span className="text-ink/55">{ci.casNumber}</span>
                      </p>
                    )}
                    {ci.molecularWeight && (
                      <p className="font-mono text-ink/40 tabular-nums" style={{ fontSize: '10px' }}>
                        MW&nbsp;&nbsp;<span className="text-ink/55">{ci.molecularWeight}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Passport key stats */}
              {passportStats.length > 0 && (
                <div className="px-4 py-3.5 shrink-0" style={{ borderBottom: '1px solid rgba(26,23,20,0.05)' }}>
                  <div className="grid grid-cols-2 gap-1">
                    {passportStats.map((s) => (
                      <StatChip key={s.label} label={s.label} value={s.value} highlight={s.highlight} />
                    ))}
                  </div>
                </div>
              )}

              {/* Select mg + live price + add-to-inquiry, co-located */}
              {ci.tiers.length > 0 && (
                <div className="px-4 py-3.5 shrink-0" style={{ borderBottom: '1px solid rgba(26,23,20,0.05)' }}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-ink/45 uppercase" style={{ fontSize: '9px', letterSpacing: '0.28em' }}>
                      Select mg
                    </span>
                    <span className="text-ink font-mono tabular-nums leading-none" style={{ fontSize: '17px' }}>
                      {formatPrice(priceCents)}
                    </span>
                  </div>
                  <TierStrip
                    mode="select"
                    variants={ci.tiers}
                    selectedIndex={selectedTierIndex}
                    onSelect={setSelectedTierIndex}
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <QuantityStepper quantity={quantity} onChange={setQuantity} />
                    <button
                      type="button"
                      onClick={handleAddToInquiry}
                      className="flex-1 h-9 rounded-[3px] bg-gold hover:bg-gold-dark text-base-900 font-medium uppercase tracking-[0.06em] text-[11px] active:scale-[0.98] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/50"
                    >
                      Add to Inquiry
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1" />

              {/* Desktop footer — price recap + full record (add lives by the tier) */}
              <div className="shrink-0 px-4 pb-4 pt-3" style={{ borderTop: '1px solid rgba(26,23,20,0.07)' }}>
                {(activeTier || quantity > 1 || priceCents != null) && (
                  <p className="text-ink/30 font-mono tabular-nums mb-1.5" style={{ fontSize: '9px', letterSpacing: '0.08em' }}>
                    {[
                      activeTier?.dose,
                      quantity > 1
                        ? `${quantity} × ${formatPrice(priceCents)} = ${formatPrice(priceCents != null ? priceCents * quantity : null)}`
                        : formatPrice(priceCents),
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            {/* Right: Intelligence column */}
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

              {/* Sticky header */}
              <div className="flex items-center justify-between gap-4 px-4 py-3 shrink-0"
                style={{ borderBottom: '1px solid rgba(26,23,20,0.07)' }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="lg:hidden shrink-0"><AbbreviationChip value={ci.abbreviation} /></span>
                  <div className="min-w-0">
                    <h3 className="text-ink font-medium truncate" style={{ fontSize: '13px', letterSpacing: '-0.005em' }}>{ci.substance}</h3>
                    <p className="text-ink/28 font-mono tabular-nums mt-0.5 truncate" style={{ fontSize: '9px', letterSpacing: '0.18em' }}>
                      {ci.sku}
                      {ci.classificationLabel && <span className="ml-2 text-ink/16">·</span>}
                      {ci.classificationLabel && <span className="ml-2 uppercase" style={{ letterSpacing: '0.14em' }}>{ci.classificationLabel}</span>}
                    </p>
                  </div>
                </div>
              </div>

              {/* Scrollable module list */}
              <div className="flex-1 overflow-y-auto overscroll-contain">

                {/* Research media poster — top of the column, above summary. */}
                {video && (
                  <div className="px-4 pt-4 pb-3.5" style={{ borderBottom: '1px solid rgba(26,23,20,0.06)' }}>
                    <CompoundVideo url={video.url} title={video.title} description={video.description} />
                  </div>
                )}

                {/* Plain-English summary — sits directly under the name,
                    before any technical module. The one friendly,
                    colorized read; everything below it is the detail. */}
                {ci.summary && (
                  <div className="px-4 pt-4 pb-3.5" style={{ borderBottom: '1px solid rgba(26,23,20,0.06)' }}>
                    <p className="text-ink/35 uppercase mb-2" style={{ fontSize: '9px', letterSpacing: '0.28em' }}>
                      Summary
                    </p>
                    <SummaryText
                      text={ci.summary}
                      className="text-[13px] leading-relaxed text-ink/70"
                    />
                  </div>
                )}

                {/* Mobile identity block */}
                <div className="lg:hidden px-4 py-3.5" style={{ borderBottom: '1px solid rgba(26,23,20,0.055)' }}>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 mb-3">
                    {ci.casNumber && <span className="font-mono text-ink/38 tabular-nums" style={{ fontSize: '10px' }}>CAS {ci.casNumber}</span>}
                    {ci.molecularWeight && <span className="font-mono text-ink/38 tabular-nums" style={{ fontSize: '10px' }}>MW {ci.molecularWeight}</span>}
                  </div>
                  {passportStats.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {passportStats.map((s) => <StatChip key={s.label} label={s.label} value={s.value} highlight={s.highlight} />)}
                    </div>
                  )}
                  {ci.tiers.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-ink/45 uppercase" style={{ fontSize: '9px', letterSpacing: '0.28em' }}>
                          Select mg
                        </span>
                        <span className="text-ink font-mono tabular-nums leading-none" style={{ fontSize: '17px' }}>
                          {formatPrice(priceCents)}
                        </span>
                      </div>
                      <TierStrip
                        mode="select"
                        variants={ci.tiers}
                        selectedIndex={selectedTierIndex}
                        onSelect={setSelectedTierIndex}
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <QuantityStepper quantity={quantity} onChange={setQuantity} />
                        <button
                          type="button"
                          onClick={handleAddToInquiry}
                          className="flex-1 h-9 rounded-[3px] bg-gold hover:bg-gold-dark text-base-900 font-medium uppercase tracking-[0.06em] text-[11px] active:scale-[0.98] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/50"
                        >
                          Add to Inquiry
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Module stack */}
                {moduleList.map((mod) => (
                  <IntelModule key={mod.key} index={mod.index} title={mod.title} defaultOpen={mod.defaultOpen} reserved={mod.reserved}>
                    {mod.kind === 'text' && (
                      <ModuleBody><ModuleText>{mod.content}</ModuleText></ModuleBody>
                    )}
                    {mod.kind === 'datagrid' && (
                      <ModuleBody><DataGrid rows={mod.rows} /></ModuleBody>
                    )}
                    {mod.kind === 'procurement' && (
                      <ModuleBody><ProcurementSheet product={product} /></ModuleBody>
                    )}
                    {mod.kind === 'studies' && (
                      <ModuleBody>
                        <RegulatoryChipCluster
                          humanTrials={ci.humanTrials}
                          fdaStatus={ci.fdaStatus}
                        />
                        {ci.studies.map((study, idx) => (
                          <StudyCard key={idx} study={study} index={idx} />
                        ))}
                      </ModuleBody>
                    )}
                  </IntelModule>
                ))}

                <div className="h-4" />
              </div>

            </div>
          </div>
        </div>
      </div>

      <IntelModuleStyles />
    </>,
    document.body,
  );
}
