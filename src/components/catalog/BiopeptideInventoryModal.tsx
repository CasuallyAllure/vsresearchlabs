/**
 * BiopeptideInventoryModal
 *
 * "View full inventory" pop-up — the complete biopeptide catalog as a dense
 * grid of compact tiles (image · name · dose select · price · add), on the
 * cream system. Same filter grammar as the Biopeptide page: a compact bar
 * with an in-stock toggle, one horizontally-scrolling row of class pills,
 * and the active class's description beneath it.
 *
 * Tiles read from the live product store (useProducts) so each carries real
 * mg tiers + a specimen image; adding goes straight to the inquiry cart.
 * Tapping a tile opens the compound-intelligence overlay above the modal.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '../../types';
import { deriveProductDose } from '../../types';
import { useProducts } from '../../hooks/useProducts';
import { siteConfig } from '../../config';
import { useCart } from '../../hooks/useCart';
import { CompoundIntelligenceOverlay } from './CompoundIntelligenceOverlay';
import { CLASSIFICATION_LABELS } from '../../lib/compoundIntelligence';
import { ClassificationFilter } from './ClassificationFilter';
import { useSignedIn } from '../../lib/authPresence';
import { EARLY_ACCESS_GUEST_LINE, isEarlyAccessProduct } from '../../lib/earlyAccess';
import { variantProduct } from '../../lib/cartActions';
import { effectiveTierPriceCents, formatPrice } from '../../lib/pricing';
import { useProductOverrides, isVariantPublic, isSkuInStock, doseAvailability } from '../../lib/productOverrides';

const ALL_TAB = '__all__';
const STOCK_GREEN = 'var(--color-status-success)';
const SOURCED_GRAY = 'var(--color-accent-teal-light)';
const ALL_LAYMAN =
  'The full biopeptide catalog — pick a category to filter the list and read what it does in plain terms. Swipe right for the technical detail.';
const ALL_DESCRIPTION =
  'The complete biopeptide catalog. Pick a class to narrow the list and read what it covers.';

/** One compact inventory row: name + class · dose select · price · add. */
function InventoryRow({ product, onInspect }: { product: Product; onInspect: (id: string) => void }) {
  // Re-render when variant overrides load.
  useProductOverrides((s) => s.variantBySku);
  const stocked = isSkuInStock(product.sku);
  // Filter to publicly-priced variants only — see lib/productOverrides.
  const allVariants = product.variants ?? [];
  const variants = allVariants.filter((v) => isVariantPublic(product.sku, v.dose));
  const [tierIndex, setTierIndex] = useState(0);
  const activeDose = variants[tierIndex]?.dose ?? deriveProductDose(product);
  const priceCents = effectiveTierPriceCents(product, activeDose);
  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const signedIn = useSignedIn();
  // Member-first window — mirrors CompoundTile/ProductPage (release audit:
  // this modal is a terminal buy surface, so it must gate too).
  const earlyLocked = isEarlyAccessProduct(product) && !signedIn;
  const [added, setAdded] = useState(false);
  const timer = useRef<number | null>(null);

  function handleAdd() {
    if (earlyLocked) return;
    const line = variantProduct(product, activeDose);
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === line.id);
    if (existing) updateQuantity(line.id, existing.quantity + 1);
    else add(line);
    setAdded(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-1.5 py-2 border-b border-ink/[0.06] hover:bg-ink/[0.02] transition-colors">
      <span
        aria-label={stocked ? '24 Hour Shipping' : 'Standard shipping (7–10 business days)'}
        title={stocked ? '24 Hour Shipping' : 'Standard shipping (7–10 business days)'}
        className="shrink-0 inline-block h-[7px] w-[7px] rounded-full"
        style={{ backgroundColor: stocked ? STOCK_GREEN : SOURCED_GRAY }}
      />
      <button
        type="button"
        onClick={() => onInspect(product.id)}
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 rounded-[var(--radius-field)]"
      >
        <p className="text-[12.5px] font-medium text-ink truncate">{product.name}</p>
        <p className="text-[10px] font-mono uppercase tracking-[0.06em] text-ink/45 truncate">
          {product.abbreviation} · {product.family}
        </p>
      </button>

      {variants.length > 1 ? (
        <div
          role="radiogroup"
          aria-label="Select dose"
          className="shrink-0 flex flex-wrap gap-1 max-w-[140px] justify-end"
        >
          {variants.map((v, i) => {
            const isActive = i === tierIndex;
            const av = doseAvailability(product.sku, v.dose);
            const isFast = av.state === 'in_stock' && av.fast;
            const doseTxt = v.dose.replace(/\s+/g, '').toUpperCase();
            return (
              <button
                key={v.dose}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setTierIndex(i)}
                title={isFast ? `${v.dose} · 24 hour shipping` : v.dose}
                className="font-mono leading-none px-1.5 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                style={{
                  fontSize: '10px',
                  letterSpacing: '0.14em',
                  backgroundColor: isActive ? 'var(--color-content-primary)' : 'var(--color-interactive-secondary)',
                  color: isActive ? 'var(--color-surface-base)' : 'var(--color-content-secondary)',
                  borderColor: isActive ? 'var(--color-content-primary)' : 'rgb(var(--c-ink) / 0.12)',
                }}
              >
                {doseTxt}
                {isFast && (
                  <span
                    className="ml-1"
                    style={{
                      // Light mint (active branch) is a fixed contrast tint
                      // tuned for the pill's inverted dark fill
                      // (var(--color-content-primary)) — no status token
                      // matches this contrast requirement, left as-is.
                      color: isActive ? 'rgba(155,196,163,1)' : 'var(--color-status-success)',
                      fontSize: '10px',
                      letterSpacing: '0.20em',
                    }}
                  >
                    · 24 HR
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="shrink-0 w-[74px] text-right font-mono text-[11px] tabular-nums text-ink/60">{activeDose}</span>
      )}

      <span className="shrink-0 w-[62px] text-right font-mono text-[11.5px] tabular-nums text-ink/85">
        {formatPrice(priceCents)}
      </span>

      <button
        type="button"
        onClick={handleAdd}
        disabled={earlyLocked}
        title={earlyLocked ? EARLY_ACCESS_GUEST_LINE : undefined}
        aria-label={earlyLocked ? EARLY_ACCESS_GUEST_LINE : `Add ${product.name} ${activeDose} to inquiry`}
        className={[
          'shrink-0 inline-flex items-center justify-center min-h-[40px] rounded-full border px-2.5 text-[10px] uppercase tracking-[0.14em] font-medium leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 disabled:opacity-40 disabled:cursor-not-allowed',
          // Theme-bound teal-light token (was a hardcoded hex) — never
          // hardcode the near-black ink hex here or the label goes
          // invisible on dark.
          added
            ? 'bg-teal-light/[0.16] border-teal-light/45 text-teal-light'
            : 'bg-ink/[0.05] border-ink/[0.14] text-ink/[0.78] hover:bg-ink/[0.09] hover:text-ink',
        ].join(' ')}
      >
        {added ? '✓' : '+ Add'}
      </button>
    </div>
  );
}

interface BiopeptideInventoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function BiopeptideInventoryModal({ open, onClose }: BiopeptideInventoryModalProps) {
  const { products, loading, error } = useProducts('biopeptide-research-supplies');
  const [classFilter, setClassFilter] = useState<string>(ALL_TAB);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // isSkuInStock reads the override store via getState() (not reactively) —
  // subscribe here so `filtered` recomputes once admin overrides finish
  // loading (same pattern as BiopeptideResearchSupplies).
  const variantOverrides = useProductOverrides((s) => s.variantBySku);

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

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
        if (inStockOnly && !isSkuInStock(p.sku)) return false;
        return true;
      }),
    [products, classFilter, inStockOnly, variantOverrides],
  );

  const inspectedProduct = useMemo(
    () => (inspectedId ? products.find((p) => p.id === inspectedId) ?? null : null),
    [inspectedId, products],
  );

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !inspectedId) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, inspectedId]);

  // Body scroll lock while open (skip while the inspect overlay manages its own)
  useEffect(() => {
    if (!open || inspectedId) return;
    const y = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      window.scrollTo(0, y);
    };
  }, [open, inspectedId]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-[color:var(--scrim)] backdrop-blur-[3px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Biopeptide full inventory"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none"
      >
        <div
          className="glass-panel pointer-events-auto flex flex-col w-full max-w-[1080px] max-h-[90vh] overflow-hidden rounded-[24px]"
          style={{ boxShadow: 'var(--glass-highlight), var(--elev-3)' }}
        >
          {/* Header + filter */}
          <header className="shrink-0 px-[var(--space-5)] sm:px-[var(--space-6)] pt-[var(--space-5)] pb-[var(--space-4)] border-b border-ink/[0.08]">
            <div className="flex items-start justify-between gap-[var(--space-4)]">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.3em] text-ink/45 mb-[var(--space-2)]">
                  Reference · Master List
                </p>
                <h2 className="text-[clamp(1.1rem,2.4vw,1.5rem)] leading-[1.15] tracking-[-0.01em] text-ink">
                  <span className="font-light text-ink/85">Biopeptide </span>
                  <span className="font-medium text-ink">full inventory.</span>
                </h2>
                <p className="mt-1.5 text-[10px] uppercase tracking-[0.22em] text-ink/40">
                  {filtered.length}
                  {filtered.length !== products.length ? ` of ${products.length}` : ''} compounds
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inventory"
                className="-mr-1.5 -mt-1.5 h-10 w-10 flex items-center justify-center text-ink/55 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-full shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Filter — same dropdown grammar as the Biopeptide page */}
            <div className="mt-[var(--space-4)]">
              <ClassificationFilter
                tabs={classificationTabs}
                value={classFilter}
                onChange={setClassFilter}
                allLayman={ALL_LAYMAN}
                allTechnical={ALL_DESCRIPTION}
                inStock={{ on: inStockOnly, toggle: () => setInStockOnly((v) => !v) }}
              />
            </div>
          </header>

          {/* Scroll region — compact list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-[var(--space-4)] sm:px-[var(--space-5)] py-[var(--space-2)]">
            {loading ? (
              <p className="py-[var(--space-10)] text-center text-[12px] text-ink/45">Loading inventory…</p>
            ) : error ? (
              <p className="py-[var(--space-10)] text-center text-[12px] text-ink/45">Inventory could not be loaded.</p>
            ) : filtered.length === 0 ? (
              <p className="py-[var(--space-10)] text-center text-[12px] text-ink/45">No compounds match the active filter.</p>
            ) : (
              <div>
                {filtered.map((p) => (
                  <InventoryRow key={p.id} product={p} onInspect={setInspectedId} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="shrink-0 px-[var(--space-5)] sm:px-[var(--space-6)] py-[var(--space-3)] border-t border-ink/[0.08] flex items-center justify-between gap-[var(--space-3)] flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45">
              {siteConfig.compliance.fullLine}
            </p>
            <div className="flex items-center gap-[var(--space-4)] text-[10px] uppercase tracking-[0.2em] text-ink/45">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ backgroundColor: STOCK_GREEN }} aria-hidden="true" />
                24 Hour
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ backgroundColor: SOURCED_GRAY }} aria-hidden="true" />
                Sourced
              </span>
            </div>
          </footer>
        </div>
      </div>

      {/* Inspect overlay — renders above the modal */}
      {inspectedProduct && (
        <CompoundIntelligenceOverlay product={inspectedProduct} onClose={() => setInspectedId(null)} />
      )}
    </>
  );
}
