/**
 * BiopeptideInventoryModal
 *
 * Centered modal card surfacing the full biopeptide master list as a
 * scrollable reference table. Each row exposes a stock indicator and
 * a compact inquiry control (qty stepper + add) so users can sweep
 * the list and add items to the inquiry cart without leaving the modal.
 *
 * Stock state is a placeholder: deterministic by serial number until
 * real inventory data is wired in. Swap the `inStock()` helper for a
 * data lookup when the inventory feed is available.
 *
 * Cart integration: manifest rows are not full Product records, so on
 * Add we construct a minimal synthetic Product (id / name / category /
 * sku / family / variants) — these are the only fields the inquiry
 * submission payload actually reads.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import manifest from '../../data/biopeptideManifest.json';
import { useCart } from '../../hooks/useCart';
import type { Product, ResearchClassification } from '../../types/product';
import { PillTabs, type PillTab } from '../ui/PillTabs';
import { CLASSIFICATION_LABELS, CLASSIFICATION_DEFINITIONS, CLASSIFICATION_ORDER } from '../../lib/compoundIntelligence';
import { inStockBySerial as inStock } from '../../lib/stock';

/** A manifest group is a research classification, plus 'supply' for
 *  non-research items (e.g. bacteriostatic water). */
type ManifestGroup = ResearchClassification | 'supply';

interface ManifestRow {
  serial: number;
  abbreviation: string;
  model: string;
  group: ManifestGroup;
  specification: string;
  /** Public-catalog visibility. Rows with hidden=true are excluded from the
   *  customer-facing modal but remain in the data file + product_stock so
   *  admin can still inventory-track them. */
  hidden?: boolean;
  hiddenReason?: string;
}

const ROWS = (manifest as ManifestRow[]).filter((r) => r.hidden !== true);

const ALL_GROUPS = '__all__';

/** Canonical group order — research classifications first, supplies last. */
const GROUP_ORDER: ManifestGroup[] = [...CLASSIFICATION_ORDER, 'supply'];

function groupLabel(g: ManifestGroup): string {
  return g === 'supply' ? 'Supplies' : CLASSIFICATION_LABELS[g] ?? g;
}

const MAX_QTY = 999;
const ADDED_MS = 1400;

const STOCK_GREEN = '#7CD992';
const STOCK_RED = '#FF7A7A';

function manifestRowToProduct(row: ManifestRow): Product {
  const now = new Date().toISOString();
  return {
    id: `manifest-${row.serial}-${row.abbreviation.replace(/[^A-Za-z0-9]/g, '_')}`,
    slug: `manifest-${row.serial}`,
    name: `${row.model} — ${row.specification}`,
    category: 'biopeptide-research-supplies',
    shortDescription: '',
    longDescription: '',
    images: [],
    specs: [],
    sku: `VSR-RS-${row.abbreviation.replace(/\s+/g, '')}`,
    abbreviation: row.abbreviation,
    family: row.model,
    variants: [{ dose: row.specification }],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: now,
    updatedAt: now,
  };
}

interface BiopeptideInventoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function BiopeptideInventoryModal({ open, onClose }: BiopeptideInventoryModalProps) {
  const addToCart = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);

  // Per-row UI state. Quantities default to 1; "added" flashes for ADDED_MS.
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [addedSerials, setAddedSerials] = useState<Set<number>>(new Set());
  const timersRef = useRef<Record<number, number>>({});

  // Category filter. Tabs are derived from the groups actually present in
  // the manifest, ordered by the canonical CLASSIFICATION_ORDER.
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);
  // Stock toggle — when on, only in-stock rows are shown.
  const [inStockOnly, setInStockOnly] = useState(false);

  const groupTabs = useMemo<PillTab[]>(() => {
    const present = new Set(ROWS.map((r) => r.group));
    const tabs: PillTab[] = [
      { id: ALL_GROUPS, label: 'All', tooltip: 'Show every product in the manifest, across all classification groups.' },
    ];
    for (const g of GROUP_ORDER) {
      if (present.has(g)) {
        tabs.push({
          id: g,
          label: groupLabel(g),
          tooltip:
            g === 'supply'
              ? 'Consumables and accessories that support research workflows but are not active compounds.'
              : CLASSIFICATION_DEFINITIONS[g as ResearchClassification],
        });
      }
    }
    return tabs;
  }, []);

  const visibleRows = useMemo(() => {
    let rows = groupFilter === ALL_GROUPS ? ROWS : ROWS.filter((r) => r.group === groupFilter);
    if (inStockOnly) rows = rows.filter((r) => inStock(r.serial));
    return rows;
  }, [groupFilter, inStockOnly]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      window.scrollTo(0, y);
    };
  }, [open]);

  // Clear pending timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((t) => window.clearTimeout(t));
      timersRef.current = {};
    };
  }, []);

  function getQty(serial: number): number {
    return quantities[serial] ?? 1;
  }

  function setQty(serial: number, next: number) {
    const clamped = Math.min(MAX_QTY, Math.max(1, Math.floor(next || 1)));
    setQuantities((prev) => ({ ...prev, [serial]: clamped }));
  }

  function handleAdd(row: ManifestRow) {
    if (!inStock(row.serial)) return;
    const product = manifestRowToProduct(row);
    const qty = getQty(row.serial);
    addToCart(product);
    if (qty > 1) {
      // useCart.add seeds qty=1; bump to the requested quantity.
      updateQuantity(product.id, qty);
    }

    // Flash the "added" affordance, then revert.
    setAddedSerials((prev) => {
      const next = new Set(prev);
      next.add(row.serial);
      return next;
    });
    if (timersRef.current[row.serial] !== undefined) {
      window.clearTimeout(timersRef.current[row.serial]);
    }
    timersRef.current[row.serial] = window.setTimeout(() => {
      setAddedSerials((prev) => {
        const next = new Set(prev);
        next.delete(row.serial);
        return next;
      });
      delete timersRef.current[row.serial];
    }, ADDED_MS);
  }

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Biopeptide full inventory"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none"
      >
        <div
          className="pointer-events-auto flex flex-col w-full max-w-[1040px] max-h-[88vh] sm:max-h-[86vh] overflow-hidden"
          style={{
            background:
              'linear-gradient(180deg, rgba(22, 22, 22, 0.96) 0%, rgba(12, 12, 12, 0.97) 100%)',
            border: '0.5px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '14px',
            boxShadow:
              '0 0 0 0.5px rgba(0, 0, 0, 0.5), 0 24px 60px rgba(0, 0, 0, 0.7), inset 0 0.5px 0 rgba(255, 255, 255, 0.10)',
          }}
        >
          {/* Header */}
          <header className="shrink-0 px-[var(--space-5)] sm:px-[var(--space-6)] pt-[var(--space-5)] pb-[var(--space-4)] border-b border-white/[0.06]">
            <div className="flex items-start justify-between gap-[var(--space-4)]">
              <div className="min-w-0">
                <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">
                  Reference · Master List
                </p>
                <h2 className="text-[clamp(1.1rem,2.4vw,1.5rem)] leading-[1.15] tracking-[-0.01em] text-white">
                  <span className="font-light text-white/85">Biopeptide </span>
                  <span className="font-medium text-white">product list.</span>
                </h2>
                <p className="holo-text-body mt-[var(--space-2)] max-w-[60ch] text-[12px] leading-relaxed">
                  Review peptide names, mg options, and supporting
                  product notes in one place. Scroll the list,
                  bump the quantity, and add directly to the inquiry cart.
                </p>
                <p className="holo-text-caption mt-[var(--space-2)] text-[10px] uppercase tracking-[0.22em]">
                  {groupFilter === ALL_GROUPS
                    ? `${ROWS.length} records on file`
                    : `${visibleRows.length} of ${ROWS.length} records`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inventory"
                className="-mr-1 -mt-1 p-2 text-white/55 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded-sm shrink-0"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Stock toggle — tiny pill above the category filter. */}
            <div className="mt-[var(--space-4)]">
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

            {/* Category filter — honors the unified research taxonomy. */}
            <div className="mt-[var(--space-3)]">
              <PillTabs
                tabs={groupTabs}
                activeId={groupFilter}
                onChange={setGroupFilter}
                ariaLabel="Filter inventory by category"
              />
            </div>
          </header>

          {/* Scroll region */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="sticky top-0 z-10" style={{ backgroundColor: 'rgb(18, 18, 18)' }}>
                <tr className="border-b border-white/[0.10]">
                  <th className="py-[var(--space-3)] pl-[var(--space-5)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-14">
                    #
                  </th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[150px]">
                    Abbrev
                  </th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal">
                    Product Model
                  </th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[110px]">
                    Spec
                  </th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-center text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[60px]">
                    Stock
                  </th>
                  <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-5)] text-right text-[10px] uppercase tracking-[0.2em] text-white/45 font-normal w-[200px]">
                    Inquiry
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const prev = i > 0 ? visibleRows[i - 1] : null;
                  const continuesModel = prev !== null && prev.model === row.model;
                  const stocked = inStock(row.serial);
                  const qty = getQty(row.serial);
                  const wasAdded = addedSerials.has(row.serial);
                  return (
                    <tr
                      key={`${row.serial}-${row.abbreviation}-${i}`}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-[var(--space-3)] pl-[var(--space-5)] pr-[var(--space-3)] align-middle font-mono text-[11px] tabular-nums text-white/35">
                        {String(row.serial).padStart(3, '0')}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle font-mono text-[11.5px] tracking-[0.04em] text-holo-light/80">
                        {row.abbreviation}
                      </td>
                      <td
                        className={`py-[var(--space-3)] px-[var(--space-3)] align-middle text-[12.5px] ${
                          continuesModel ? 'text-white/35' : 'text-white/85'
                        }`}
                      >
                        {continuesModel ? (
                          <span className="font-mono text-white/20" aria-hidden="true">
                            ↳
                          </span>
                        ) : (
                          row.model
                        )}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[11.5px] tabular-nums text-white/70">
                        {row.specification}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle">
                        <div className="flex justify-center">
                          <span
                            aria-label={stocked ? 'In stock' : 'Out of stock'}
                            title={stocked ? 'In stock' : 'Out of stock'}
                            className="inline-block h-[9px] w-[9px] rounded-full"
                            style={{
                              backgroundColor: stocked ? STOCK_GREEN : STOCK_RED,
                              boxShadow: stocked
                                ? `0 0 6px ${STOCK_GREEN}66, inset 0 0 0 0.5px rgba(255,255,255,0.25)`
                                : `0 0 6px ${STOCK_RED}66, inset 0 0 0 0.5px rgba(255,255,255,0.25)`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-5)] align-middle">
                        <div className="flex items-center justify-end gap-2">
                          {/* Qty stepper */}
                          <div
                            className="flex items-center rounded-full border border-white/15"
                            style={{
                              backgroundColor: 'rgba(255,255,255,0.03)',
                              opacity: stocked ? 1 : 0.4,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => setQty(row.serial, qty - 1)}
                              disabled={!stocked || qty <= 1}
                              aria-label="Decrease quantity"
                              className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35 rounded-full"
                            >
                              −
                            </button>
                            <span
                              className="w-6 text-center text-[11.5px] tabular-nums text-white"
                              aria-live="polite"
                            >
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => setQty(row.serial, qty + 1)}
                              disabled={!stocked || qty >= MAX_QTY}
                              aria-label="Increase quantity"
                              className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35 rounded-full"
                            >
                              +
                            </button>
                          </div>
                          {/* Add button */}
                          <button
                            type="button"
                            onClick={() => handleAdd(row)}
                            disabled={!stocked}
                            aria-label={
                              stocked
                                ? `Add ${qty} × ${row.model} ${row.specification} to inquiry`
                                : `${row.model} ${row.specification} unavailable`
                            }
                            className={[
                              'h-6 px-3 rounded-full text-[10px] uppercase tracking-[0.16em] font-medium transition-colors',
                              'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                              !stocked
                                ? 'bg-white/[0.04] border border-white/10 text-white/30 cursor-not-allowed'
                                : wasAdded
                                  ? 'bg-holo/[0.18] border border-holo/40 text-holo-light'
                                  : 'bg-white/[0.08] border border-white/15 text-white/80 hover:bg-holo/[0.10] hover:border-holo/30 hover:text-holo-light',
                            ].join(' ')}
                            style={
                              wasAdded
                                ? {
                                    boxShadow:
                                      '0 0 8px rgba(100, 200, 255, 0.28), inset 0 0 6px rgba(100, 200, 255, 0.08)',
                                  }
                                : undefined
                            }
                          >
                            {!stocked ? 'Unavail' : wasAdded ? '✓ Added' : 'Add'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <footer className="shrink-0 px-[var(--space-5)] sm:px-[var(--space-6)] py-[var(--space-3)] border-t border-white/[0.06] flex items-center justify-between gap-[var(--space-3)] flex-wrap">
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">
              For Research Purposes Only — Not for Human Use
            </p>
            <div className="flex items-center gap-[var(--space-4)] text-[10px] uppercase tracking-[0.2em] text-white/45">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: STOCK_GREEN, boxShadow: `0 0 4px ${STOCK_GREEN}66` }}
                  aria-hidden="true"
                />
                In stock
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-[7px] w-[7px] rounded-full"
                  style={{ backgroundColor: STOCK_RED, boxShadow: `0 0 4px ${STOCK_RED}66` }}
                  aria-hidden="true"
                />
                Out
              </span>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
