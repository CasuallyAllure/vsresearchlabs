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
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useCompoundShareRoute } from '../../hooks/useCompoundShareRoute';
import { ShareCompoundButton } from './ShareCompoundButton';
import {
  getCompoundIntelligence,
  chemicalPropertyRows,
  researchHistoryRows,
} from '../../lib/compoundIntelligence';
import { AbbreviationChip } from './AbbreviationChip';
import { VialRender } from './specimen/VialRender';
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
import { getCompoundVideo, type CompoundVideoMeta } from '../../lib/compoundVideo';
import { RegulatoryChipCluster } from './intelligence/RegulatoryChipCluster';
import { ReferenceList } from './intelligence/ReferenceList';
import { FdaResourceList } from './intelligence/FdaResourceList';
import { ShippingVan, DoseChip, SourcedDoseSegment } from './DoseTierChips';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { isMemberPriceEligible } from '../../lib/memberPricing';
import { MemberPrice } from './MemberPrice';
import { useProductOverrides, isVariantPublic, doseAvailability } from '../../lib/productOverrides';
import { useCustomerAuth } from '../../lib/customerAuth';
import {
  WHOLESALE_PACKS,
  wholesaleDoses,
  wholesalePackPricing,
  formatPerVial,
} from '../../lib/wholesale';
import { ProcurementSheet, selectProcurementRows } from './intelligence/ProcurementSheet';
import { QuantityStepper } from './intelligence/QuantityStepper';
import { Button } from '../ui/Button';

// ─── Overlay-local icons ──────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

/** Brand gold — matches WholesaleTile / the catalog's WHOLESALE pill. */
const GOLD = 'var(--color-accent-gold-dark)';

interface CompoundIntelligenceOverlayProps {
  product: Product;
  onClose: () => void;
  /** Optional sibling list (typically the current filtered catalog). When
   *  provided, the overlay surfaces prev/next controls + touch-swipe
   *  navigation so the user can carousel through the catalog without
   *  leaving the modal. */
  list?: Product[];
  onNavigate?: (productId: string) => void;
  /** Opened from the WHOLESALE catalog view — the buy block sells packs at
   *  case pricing (unified 7–10 day dose picker, NO 24hr badge, member-gated
   *  Add) instead of single retail vials. Keep the math in sync with
   *  WholesaleTile (both read src/lib/wholesale.ts). */
  wholesale?: boolean;
}

export function CompoundIntelligenceOverlay({
  product,
  onClose,
  list,
  onNavigate,
  wholesale,
}: CompoundIntelligenceOverlayProps) {
  // Mounted only while open, so the trap is always active for this component's
  // lifetime. Handles initial focus and returns focus to the catalog tile that
  // opened the overlay on unmount.
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const setItemNote = useCart((s) => s.setItemNote);

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

  // Public-visibility filter for variant tiers. Subscribe to variantBySku
  // so the strip re-renders when a price is set / cleared by admin import.
  // Re-uses ci.tiers' identity when nothing changed.
  const variantBySku = useProductOverrides((s) => s.variantBySku);
  const visibleTiers = useMemo(
    () => ci.tiers.filter((v) => isVariantPublic(product.sku, v.dose)),
    // variantBySku in deps so the filter re-runs after an import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ci.tiers, product.sku, variantBySku],
  );

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onCloseRef.current = onClose; });

  const [selectedTierIndex, setSelectedTierIndex] = useState<number>(() => {
    // Initial selection: prefer the catalog's activeDose if it's still public,
    // otherwise the first publicly-priced variant.
    const visible = ci.tiers.filter((v) => isVariantPublic(product.sku, v.dose));
    const idx = visible.findIndex((v) => v.dose === ci.activeDose);
    return idx >= 0 ? idx : 0;
  });
  const [quantity, setQuantity] = useState(1);

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onCloseRef.current(), 230);
  }

  // Shareable URL. Every surface that mounts this overlay inherits the
  // /c/<slug> address bar + back-button-closes behaviour from here — do not
  // re-implement it per call site.
  useCompoundShareRoute(product, { onBack: handleClose });

  function handleAddToInquiry() {
    const line = variantProduct(product, activeDoseLabel);
    const currentItems = useCart.getState().items;
    const existing = currentItems.find((i) => i.product.id === line.id);
    if (existing) {
      updateQuantity(line.id, existing.quantity + quantity);
    } else {
      add(line);
      if (quantity > 1) updateQuantity(line.id, quantity);
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

  // (Initial focus is handled by useFocusTrap above.)

  // ─── Derived values ─────────────────────────────────────────────────────────

  // Subscribe to admin overrides so the price recomputes when they load.
  useProductOverrides((s) => s.variantBySku);
  useProductOverrides((s) => s.bySku);
  const activeTier = visibleTiers[selectedTierIndex] ?? null;
  const activeDoseLabel = activeTier?.dose ?? ci.activeDose;
  const priceCents = effectiveTierPriceCents(product, activeDoseLabel);

  // ── Wholesale mode ──────────────────────────────────────────────────────
  // Pack pricing state — hooks run unconditionally; the block only renders
  // when `wholesale` is set. Indices clamp so carousel navigation to a
  // product with fewer doses never strands the selection.
  const wsDoses = wholesale ? wholesaleDoses(product) : [];
  const [wsDoseIndex, setWsDoseIndex] = useState(0);
  const [wsPackIndex, setWsPackIndex] = useState(0);
  const [wsAdded, setWsAdded] = useState(false);
  const wsDose = wsDoses[Math.min(wsDoseIndex, Math.max(wsDoses.length - 1, 0))] ?? null;
  const wsPack = WHOLESALE_PACKS[wsPackIndex];
  const wsPricing = wsDose ? wholesalePackPricing(product, wsDose, wsPack) : null;
  const { user } = useCustomerAuth();
  const isMember = !!user;

  function handleAddPack() {
    if (!wsDose || !wsPricing) return;
    const line = variantProduct(product, wsDose);
    const currentItems = useCart.getState().items;
    const existing = currentItems.find((i) => i.product.id === line.id);
    if (existing) {
      updateQuantity(line.id, existing.quantity + wsPack.size);
    } else {
      add(line);
      updateQuantity(line.id, wsPack.size);
    }
    setItemNote(
      line.id,
      `Wholesale ${wsPack.label.toLowerCase()} ×${wsPack.size} — ${wsPack.percent}% off applied at checkout`,
    );
    setWsAdded(true);
    setTimeout(() => setWsAdded(false), 1100);
  }

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
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'datagrid'; rows: Array<{ label: string; value: string }> }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'procurement' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'studies' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'video'; video: CompoundVideoMeta }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'fda' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'references' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'reserved' };

    // Compact module: everything below the buy controls is a collapsed
    // accordion by default (no `defaultOpen` on any entry) so the panel
    // stays a small floating square until the shopper opens a section.
    const defs: ModuleDef[] = [];
    if (ci.mechanismSummary) defs.push({ key: 'mech', title: 'Mechanism of Action', kind: 'text', content: ci.mechanismSummary });
    if (ci.receptorActivity) defs.push({ key: 'receptor', title: 'Receptor / Target Activity', kind: 'text', content: ci.receptorActivity });
    if (ci.pathwaySummary) defs.push({ key: 'pathway', title: 'Signaling Pathway', kind: 'text', content: ci.pathwaySummary });
    if (ci.analytical.length > 0) defs.push({ key: 'analytical', title: 'Analytical Parameters', kind: 'datagrid', rows: ci.analytical });
    if (!ci.hasMolecularIntelligence && allSpecs.length > 0) defs.push({ key: 'specs', title: 'Specifications', kind: 'datagrid', rows: allSpecs });
    if (selectProcurementRows(product).length > 0) defs.push({ key: 'procurement', title: 'Procurement Data', kind: 'procurement' });
    if (ci.hasStudies) defs.push({ key: 'studies', title: 'Known Studies', kind: 'studies' });
    // Research media now lives in the accordion stack (was a poster above
    // the summary) so the default view stays compact; the reserved
    // placeholder keeps the same visibility rule it always had.
    if (video) defs.push({ key: 'media', title: 'Research Media', kind: 'video', video });
    else if (ci.hasMolecularIntelligence && !ci.hasStudies) defs.push({ key: 'media', title: 'Research Media', kind: 'reserved', reserved: true });

    // Reference-half sections. Appended after the established stack so every
    // module above keeps the index it has always had — these add to the
    // dossier without renumbering it. Each renders only when its data exists;
    // References additionally declares its own gap with the "Planned"
    // placeholder, matching how Research Media has always handled absence.
    const chemistryRows = chemicalPropertyRows(product);
    if (chemistryRows.length > 0) defs.push({ key: 'chemistry', title: 'Chemical Properties', kind: 'datagrid', rows: chemistryRows });
    const historyRows = researchHistoryRows(product);
    if (historyRows.length > 0) defs.push({ key: 'history', title: 'Research History', kind: 'datagrid', rows: historyRows });
    if (ci.references.length > 0) defs.push({ key: 'references', title: 'References', kind: 'references' });
    else if (ci.hasMolecularIntelligence) defs.push({ key: 'references', title: 'References', kind: 'reserved', reserved: true });
    if (ci.fdaResources.length > 0) defs.push({ key: 'fda', title: 'FDA Resources', kind: 'fda' });

    return defs.map((m, i) => ({ ...m, index: i + 1 }));
  }, [ci, allSpecs, product, video]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const imageUrl = product.images?.[0] ?? null;

  return createPortal(
    <>
      {/* Backdrop — gradient-shaded scrim (never a flat bg-ink/xx wash; the
          scrim token flips correctly in dark mode, a radial gradient gives
          the "floating module" a soft light falloff instead of a flat mask). */}
      <div aria-hidden="true" onClick={handleClose} className="fixed inset-0 z-[70]"
        style={{
          backgroundImage: 'radial-gradient(120% 90% at 50% 38%, color-mix(in srgb, var(--scrim), transparent 30%) 0%, var(--scrim) 70%)',
          animation: closing ? 'cio-bd-out 200ms linear forwards' : 'cio-bd 180ms linear forwards',
        }} />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 lg:p-10 pointer-events-none">
        {/* Panel — compact floating glass square, not a page takeover. */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Compound intelligence: ${ci.substance}`}
          className="cio-panel-el glass-panel pointer-events-auto w-full overflow-hidden flex flex-col relative"
          onTouchStart={onPanelTouchStart}
          onTouchMove={onPanelTouchMove}
          onTouchEnd={onPanelTouchEnd}
          style={{
            maxWidth: '480px',
            maxHeight: 'min(88dvh, 720px)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--glass-highlight), var(--elev-3)',
            animation: closing ? 'cio-panel-out 230ms cubic-bezier(0.23, 1, 0.32, 1) forwards' : 'cio-panel 280ms cubic-bezier(0.23, 1, 0.32, 1) forwards',
            transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
            transition: dragX === 0 ? 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)' : undefined,
          }}
        >
          {/* Chrome strip — carousel nav (when a list is provided) + close.
              Stays outside the scroll region so close is always reachable. */}
          <div className="relative z-10 flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            {hasNav ? (
              <button
                type="button"
                onClick={goPrev}
                disabled={!prevProduct}
                aria-label={prevProduct ? `Previous: ${prevProduct.name}` : 'No previous compound'}
                className="h-10 w-10 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            ) : (
              <span className="h-10 w-10" aria-hidden="true" />
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
                  className="h-10 w-10 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
              <ShareCompoundButton product={product} />
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close compound intelligence"
                className="h-10 w-10 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Everything below the chrome strip lives in one scrollable
              column — identity, visual, summary, buy controls, and the
              collapsed technical accordions. */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">

            {/* Compound identity */}
            <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-start gap-2.5 min-w-0">
                <AbbreviationChip value={ci.abbreviation} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-ink font-normal leading-tight truncate" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>
                    {ci.substance}
                  </h2>
                  <p className="mt-1 text-ink/40 uppercase truncate" style={{ fontSize: '10px', letterSpacing: '0.24em' }}>
                    {ci.classificationLabel || 'Compound'}
                  </p>
                </div>
              </div>
              {(ci.casNumber || ci.molecularWeight) && (
                <p className="mt-2 font-mono text-ink/38 tabular-nums truncate" style={{ fontSize: '10px' }}>
                  {ci.casNumber && <>CAS <span className="text-ink/55">{ci.casNumber}</span></>}
                  {ci.casNumber && ci.molecularWeight && <span className="mx-2 text-ink/15">·</span>}
                  {ci.molecularWeight && <>MW <span className="text-ink/55">{ci.molecularWeight}</span></>}
                </p>
              )}
            </div>

            {/* Specimen visual — contained square, not a full-bleed band. */}
            <div className="px-5 pt-4 flex justify-center">
              <div
                className="overflow-hidden shrink-0"
                style={{
                  width: '188px',
                  height: '188px',
                  borderRadius: 'var(--radius-card-inner)',
                  backgroundColor: 'var(--color-surface-sunken)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={`${ci.substance} research vial`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center p-6">
                    <VialRender substance={ci.substance} dose={activeDoseLabel} abbreviation={ci.abbreviation} sku={ci.sku} />
                  </div>
                )}
              </div>
            </div>

            {/* Plain-English summary */}
            {ci.summary && (
              <div className="px-5 pt-4 pb-3.5">
                <p className="text-ink/35 uppercase mb-2" style={{ fontSize: '10px', letterSpacing: '0.24em' }}>
                  Summary
                </p>
                <SummaryText
                  text={ci.summary}
                  className="text-[13px] leading-relaxed text-ink/70"
                />
              </div>
            )}

            {/* Passport key facts — compact stat chips */}
            {passportStats.length > 0 && (
              <div className="px-5 pb-3.5 flex flex-wrap gap-1.5">
                {passportStats.map((s) => (
                  <StatChip key={s.label} label={s.label} value={s.value} highlight={s.highlight} />
                ))}
              </div>
            )}

            {/* Wholesale buy block — pack pricing, unified 7–10 day picker
                (wholesale sources the whole case; never a 24hr badge here),
                member-gated Add. Grammar mirrors WholesaleTile. */}
            {wholesale && wsDose && wsPricing && (
              <div className="px-5 py-4" style={{ borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-ink/45 uppercase" style={{ fontSize: '10px', letterSpacing: '0.24em' }}>
                      Select mg
                    </span>
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.16em] px-1.5 py-[1px] rounded-full border"
                      style={{ color: GOLD, borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark), transparent 55%)', backgroundColor: 'color-mix(in srgb, var(--color-accent-gold-dark), transparent 90%)' }}
                    >
                      Wholesale
                    </span>
                  </span>
                  <span className="text-ink font-mono tabular-nums leading-none" style={{ fontSize: '17px' }}>
                    {formatPerVial(wsPricing.packCents)}
                  </span>
                </div>

                {/* ONE unified dose group — every pack ships 7–10 business days. */}
                <div className="rounded-[var(--radius-field)] border border-ink/15 overflow-hidden">
                  <div
                    role={wsDoses.length > 1 ? 'radiogroup' : undefined}
                    aria-label={wsDoses.length > 1 ? 'Select pack dose' : undefined}
                    className="flex items-stretch"
                  >
                    {wsDoses.map((dose, i) => (
                      <SourcedDoseSegment
                        key={dose}
                        dose={dose}
                        isActive={dose === wsDose}
                        interactive={wsDoses.length > 1}
                        hasDivider={i > 0}
                        onClick={wsDoses.length > 1 ? () => setWsDoseIndex(i) : undefined}
                      />
                    ))}
                  </div>
                  <div className="border-t border-ink/12 py-1 text-center">
                    <span className="inline-flex items-center justify-center gap-1 font-mono leading-none text-[10px] uppercase tracking-[0.16em] text-ink/45">
                      Standard Shipping
                      <ShippingVan />
                    </span>
                  </div>
                </div>

                {/* Pack picker — full case vs half kit. */}
                <div
                  role="radiogroup"
                  aria-label="Select pack size"
                  className="mt-1.5 flex items-stretch rounded-[var(--radius-field)] border border-ink/15 overflow-hidden"
                >
                  {WHOLESALE_PACKS.map((p, i) => {
                    const on = i === wsPackIndex;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setWsPackIndex(i)}
                        className={[
                          'flex-1 min-h-[40px] px-1 py-1.5 text-center leading-tight transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                          i > 0 ? 'border-l border-ink/12' : '',
                          on ? 'bg-ink/[0.08]' : 'hover:bg-ink/[0.03]',
                        ].join(' ')}
                      >
                        <span className={`block text-[11px] font-medium ${on ? 'text-ink' : 'text-ink/55'}`}>
                          {p.label}
                        </span>
                        <span className={`block font-mono text-[10px] uppercase tracking-[0.08em] ${on ? 'text-ink/60' : 'text-ink/35'}`}>
                          {p.size} vials · −{p.percent}%
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Price ledger — regular value, the wholesale cut, what's billed. */}
                <dl className="mt-2 rounded-[var(--radius-field)] border border-ink/[0.08] bg-ink/[0.03] px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-[11px] text-ink/50">
                      {wsPack.size} vials · {wsDose}
                    </dt>
                    <dd className="font-mono tabular-nums text-[11.5px] text-ink/45 line-through decoration-ink/30">
                      {formatPerVial(wsPricing.regularCents)}
                    </dd>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <dt className="text-[11px]" style={{ color: GOLD }}>
                      Wholesale −{wsPack.percent}%
                    </dt>
                    <dd className="font-mono tabular-nums text-[11.5px]" style={{ color: GOLD }}>
                      −{formatPerVial(wsPricing.discountCents)}
                    </dd>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-ink/[0.07] pt-1">
                    <dt className="text-[11px] font-medium text-ink/75">
                      {wsPack.size === 10 ? 'Case price' : 'Kit price'}
                    </dt>
                    <dd className="font-mono tabular-nums text-[14px] text-ink">
                      {formatPerVial(wsPricing.packCents)}
                    </dd>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-end gap-1">
                    <span className="font-mono tabular-nums text-[10.5px] text-ink/45">
                      {formatPerVial(wsPricing.unitCents)}
                    </span>
                    <span aria-hidden="true" className="text-[10.5px] text-ink/35">→</span>
                    <span className="font-mono tabular-nums text-[10.5px] text-ink/60">
                      {formatPerVial(wsPricing.perVialCents)} per vial
                    </span>
                  </div>
                </dl>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] leading-snug text-ink/40">
                    {isMember
                      ? 'Wholesale price is final — codes, rewards, and other discounts don’t apply.'
                      : 'Sign in to add cases at wholesale pricing.'}
                  </span>
                  {isMember ? (
                    <Button variant="primary" size="sm" type="button" onClick={handleAddPack} className="shrink-0">
                      {wsAdded ? '✓' : `+ Add ${wsPack.noun}`}
                    </Button>
                  ) : (
                    <Button to="/account?mode=signin" variant="secondary" size="sm" className="shrink-0">
                      Sign in
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Select mg + live price + qty + Add to Inquiry (retail — hidden
                in wholesale mode, which sells packs above instead). */}
            {(!wholesale || !wsPricing) && visibleTiers.length > 0 && (
              <div className="px-5 py-4" style={{ borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-ink/45 uppercase" style={{ fontSize: '10px', letterSpacing: '0.24em' }}>
                    Select mg
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-ink font-mono tabular-nums leading-none" style={{ fontSize: '17px' }}>
                      {formatPrice(priceCents)}
                    </span>
                    <MemberPrice baseCents={priceCents} eligible={isMemberPriceEligible(product)} size="md" />
                  </span>
                </div>
                {(() => {
                  // Same shipping-tier treatment as CompoundTile: 24-hour
                  // doses render as standalone green "· 24 HR" chips;
                  // sourced doses group into one bordered box with a
                  // "Standard Shipping" footer — no separate availability pill.
                  const interactive = visibleTiers.length > 1;
                  const withState = visibleTiers.map((v, i) => ({
                    v,
                    i,
                    state: doseAvailability(product.sku, v.dose).state,
                  }));
                  const fastDoses = withState.filter((o) => o.state === 'in_stock');
                  const sourcedDoses = withState.filter((o) => o.state === 'sourced');

                  return (
                    <div className="flex flex-col gap-1.5">
                      {fastDoses.length > 0 && (
                        <div
                          role={interactive ? 'radiogroup' : undefined}
                          aria-label={interactive ? 'Select dose' : undefined}
                          className="flex flex-wrap items-center gap-1"
                        >
                          {fastDoses.map(({ v, i }) => (
                            <DoseChip
                              key={v.dose}
                              sku={product.sku}
                              dose={v.dose}
                              interactive={interactive}
                              isActive={i === selectedTierIndex}
                              onClick={interactive ? () => setSelectedTierIndex(i) : undefined}
                            />
                          ))}
                        </div>
                      )}

                      {sourcedDoses.length > 0 && (
                        <div className="rounded-[var(--radius-field)] border border-ink/15 overflow-hidden">
                          <div
                            role={interactive ? 'radiogroup' : undefined}
                            aria-label={interactive ? 'Select sourced dose' : undefined}
                            className="flex items-stretch"
                          >
                            {sourcedDoses.map(({ v, i }, idx) => (
                              <SourcedDoseSegment
                                key={v.dose}
                                dose={v.dose}
                                isActive={i === selectedTierIndex}
                                interactive={interactive}
                                hasDivider={idx > 0}
                                onClick={interactive ? () => setSelectedTierIndex(i) : undefined}
                              />
                            ))}
                          </div>
                          <div className="border-t border-ink/12 py-1 text-center">
                            <span className="inline-flex items-center justify-center gap-1 font-mono leading-none text-[10px] uppercase tracking-[0.16em] text-ink/45">
                              Standard Shipping
                              <ShippingVan />
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="mt-3 flex items-center gap-2">
                  <QuantityStepper quantity={quantity} onChange={setQuantity} />
                  <Button variant="primary" size="sm" type="button" onClick={handleAddToInquiry} className="flex-1">
                    Add to Inquiry
                  </Button>
                </div>
                {quantity > 1 && priceCents != null && (
                  <p className="mt-2 text-right font-mono tabular-nums text-ink/35" style={{ fontSize: '10px' }}>
                    {quantity} × {formatPrice(priceCents)} = {formatPrice(priceCents * quantity)}
                  </p>
                )}
              </div>
            )}

            {/* Deeper technical sections — collapsible accordions, default
                collapsed, so the module stays compact until expanded. */}
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
                {mod.kind === 'video' && (
                  <ModuleBody><CompoundVideo url={mod.video.url} title={mod.video.title} description={mod.video.description} /></ModuleBody>
                )}
                {mod.kind === 'references' && (
                  <ModuleBody><ReferenceList references={ci.references} /></ModuleBody>
                )}
                {mod.kind === 'fda' && (
                  <ModuleBody><FdaResourceList resources={ci.fdaResources} /></ModuleBody>
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

      <IntelModuleStyles />
    </>,
    document.body,
  );
}
