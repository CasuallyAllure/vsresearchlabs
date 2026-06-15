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
import { useCart } from '../../hooks/useCart';
import { CompoundIntelligenceOverlay } from './CompoundIntelligenceOverlay';
import { CLASSIFICATION_LABELS, CLASSIFICATION_DEFINITIONS } from '../../lib/compoundIntelligence';
import { inStockByKey } from '../../lib/stock';
import { tierPriceCents, formatPrice } from '../../lib/pricing';

const ALL_TAB = '__all__';
const STOCK_GREEN = '#2E7D5B';
const STOCK_RED = '#B23A3A';
const ALL_DESCRIPTION =
  'The complete biopeptide catalog. Pick a class to narrow the list and read what it covers.';

/** One compact inventory row: name + class · dose select · price · add. */
function InventoryRow({ product, onInspect }: { product: Product; onInspect: (id: string) => void }) {
  const stocked = inStockByKey(product.id);
  const variants = product.variants ?? [];
  const [tierIndex, setTierIndex] = useState(0);
  const activeDose = variants[tierIndex]?.dose ?? deriveProductDose(product);
  const priceCents = tierPriceCents(product, activeDose);
  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const [added, setAdded] = useState(false);
  const timer = useRef<number | null>(null);

  function handleAdd() {
    const items = useCart.getState().items;
    const existing = items.find((i) => i.product.id === product.id);
    if (existing) updateQuantity(product.id, existing.quantity + 1);
    else add(product);
    setAdded(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAdded(false), 1100);
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-1.5 py-2 border-b border-ink/[0.06] hover:bg-ink/[0.02] transition-colors">
      <span
        aria-label={stocked ? 'In stock' : 'Out of stock'}
        title={stocked ? 'In stock' : 'Out of stock'}
        className="shrink-0 inline-block h-[7px] w-[7px] rounded-full"
        style={{ backgroundColor: stocked ? STOCK_GREEN : STOCK_RED }}
      />
      <button
        type="button"
        onClick={() => onInspect(product.id)}
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 rounded-sm"
      >
        <p className="text-[12.5px] font-medium text-ink truncate">{product.name}</p>
        <p className="text-[9.5px] font-mono uppercase tracking-[0.06em] text-ink/45 truncate">
          {product.abbreviation} · {product.family}
        </p>
      </button>

      {variants.length > 1 ? (
        <select
          value={activeDose}
          onChange={(e) => {
            const idx = variants.findIndex((v) => v.dose === e.target.value);
            if (idx >= 0) setTierIndex(idx);
          }}
          aria-label="Select dose"
          className="shrink-0 w-[74px] px-1.5 py-1 text-[10.5px] font-mono tabular-nums text-ink/85 bg-ink/[0.04] border border-ink/[0.1] rounded-[3px] focus:outline-none focus:border-ink/30"
        >
          {variants.map((v) => (
            <option key={v.dose} value={v.dose}>{v.dose}</option>
          ))}
        </select>
      ) : (
        <span className="shrink-0 w-[74px] text-right font-mono text-[11px] tabular-nums text-ink/60">{activeDose}</span>
      )}

      <span className="shrink-0 w-[62px] text-right font-mono text-[11.5px] tabular-nums text-ink/85">
        {formatPrice(priceCents)}
      </span>

      <button
        type="button"
        onClick={handleAdd}
        disabled={!stocked}
        aria-label={`Add ${product.name} ${activeDose} to inquiry`}
        className="shrink-0 rounded-full px-2.5 py-1 text-[9px] uppercase tracking-[0.14em] font-medium leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: added ? 'rgba(52,114,122,0.16)' : 'rgba(26,23,20,0.05)',
          border: added ? '1px solid rgba(52,114,122,0.45)' : '1px solid rgba(26,23,20,0.14)',
          color: added ? '#34727A' : 'rgba(26,23,20,0.78)',
        }}
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

  const activeDescription =
    classFilter === ALL_TAB
      ? ALL_DESCRIPTION
      : CLASSIFICATION_DEFINITIONS[classFilter as keyof typeof CLASSIFICATION_DEFINITIONS] ?? null;

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (classFilter !== ALL_TAB && p.researchClassification !== classFilter) return false;
        if (inStockOnly && !inStockByKey(p.id)) return false;
        return true;
      }),
    [products, classFilter, inStockOnly],
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
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[3px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Biopeptide full inventory"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none"
      >
        <div
          className="pointer-events-auto flex flex-col w-full max-w-[1080px] max-h-[90vh] overflow-hidden rounded-2xl border border-ink/[0.12] bg-base-800"
          style={{ boxShadow: '0 24px 60px rgba(26,23,20,0.22), 0 0 0 0.5px rgba(26,23,20,0.06)' }}
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
                className="-mr-1 -mt-1 p-2 text-ink/55 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-sm shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Compact filter — label + in-stock toggle, scrolling class pills, description */}
            <div className="mt-[var(--space-4)] rounded-xl border border-ink/[0.09] bg-ink/[0.025] p-[var(--space-3)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-[0.28em] text-ink/45">Filter</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={inStockOnly}
                  onClick={() => setInStockOnly((v) => !v)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                    inStockOnly ? 'text-ink' : 'border-ink/15 text-ink/50 hover:text-ink/80 hover:border-ink/25',
                  ].join(' ')}
                  style={
                    inStockOnly
                      ? { borderColor: `${STOCK_GREEN}80`, backgroundColor: `${STOCK_GREEN}18`, boxShadow: `0 0 10px ${STOCK_GREEN}33` }
                      : undefined
                  }
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-[6px] w-[6px] rounded-full"
                    style={{ backgroundColor: inStockOnly ? STOCK_GREEN : 'rgba(26,23,20,0.25)', boxShadow: inStockOnly ? `0 0 5px ${STOCK_GREEN}aa` : undefined }}
                  />
                  In stock only
                </button>
              </div>

              {classificationTabs.length > 1 && (
                <div
                  role="tablist"
                  aria-label="Filter inventory by classification"
                  className="mt-[var(--space-3)] flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {classificationTabs.map((tab) => {
                    const active = tab.id === classFilter;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setClassFilter(tab.id)}
                        className={[
                          'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40',
                          active
                            ? 'border border-holo/30 bg-holo/[0.12] text-holo-light font-medium'
                            : 'border border-ink/12 text-ink/55 hover:text-ink/85 hover:border-ink/25',
                        ].join(' ')}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {activeDescription && (
                <p className="mt-[var(--space-3)] border-t border-ink/[0.07] pt-[var(--space-3)] text-[12px] leading-relaxed text-ink/60 max-w-[72ch]">
                  {activeDescription}
                </p>
              )}
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
              For Research Purposes Only — Not for Human Use
            </p>
            <div className="flex items-center gap-[var(--space-4)] text-[10px] uppercase tracking-[0.2em] text-ink/45">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ backgroundColor: STOCK_GREEN }} aria-hidden="true" />
                In stock
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ backgroundColor: '#B23A3A' }} aria-hidden="true" />
                Out
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
