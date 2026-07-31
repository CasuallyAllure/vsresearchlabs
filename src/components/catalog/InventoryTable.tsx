/**
 * InventoryTable
 * Wave 7b — Desktop tabular rendering of the inventory list.
 *
 * Renders the same product set as the mobile `InventoryRow` stack, but
 * in a procurement-terminal-style HTML <table>. Targeted at lg+ only;
 * the parent `InventoryList` gates visibility via responsive classes.
 *
 * Design posture:
 *   - One outer surface container (solid, no hover lift).
 *   - Sticky <thead> at top: 56px (just below the 56px GlobalHeader).
 *   - No zebra striping. Hairline row dividers only.
 *   - Subtle row-hover bg using `--surface-product-hover`.
 *   - No images. No badges. No avatars. Dense single-line rows.
 *
 * Interactive structure:
 *   - <tr onClick> navigates to /product/:id, but only when the click
 *     target is NOT inside an existing <a> or <button> (avoids double-
 *     activation when users click the product-name link or the + button).
 *   - The Product cell wraps the substance name in a real <Link>, which
 *     serves as the keyboard-tabbable focus target for the row.
 *   - The + button stops propagation and dispatches useCart.add().
 *
 * Surface containment:
 *   - Outer container uses tokens inline (bg/border/radius) instead of
 *     the `.research-surface-solid` utility class. The utility ships a
 *     :hover rule that would inappropriately lift the whole table.
 */

import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Product, ProductCategory } from '../../types';
import { useCart } from '../../hooks/useCart';
import { useSignedIn } from '../../lib/authPresence';
import { EARLY_ACCESS_GUEST_LINE, isEarlyAccessProduct, useEarlyAccessFlags } from '../../lib/earlyAccess';
import { variantProduct, resolveSellableDose, canQuickAdd } from '../../lib/cartActions';
import { AbbreviationChip } from './AbbreviationChip';

export interface InventoryTableRow {
  product: Product;
  family: string;
  dose: string;
}

interface InventoryTableProps {
  rows: InventoryTableRow[];
  onInspect?: (id: string) => void;
}

const ADDED_MS = 1400;

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  'biopeptide-research-supplies': 'Biopeptide',
  'nootropics-research-supplies': 'Nootropics',
  'skincare-research-supplies': 'Dermatological',
  'laboratory-equipment': 'Equipment',
};

function categoryLabel(category: ProductCategory): string {
  return CATEGORY_LABEL[category] ?? '—';
}

/**
 * Row click should not fire when the user activated a real interactive
 * descendant (the product-name link or the + inquiry button).
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('a, button') !== null;
}

const TH_CLASS =
  'text-left text-[11px] uppercase tracking-[0.14em] text-ink/45 font-medium px-[var(--space-4)] py-[var(--space-3)]';

export function InventoryTable({ rows, onInspect }: InventoryTableProps) {
  const navigate = useNavigate();
  const addToCart = useCart((s) => s.add);
  const signedIn = useSignedIn();
  // Subscribed (not .getState()) so a flag load/toggle re-renders every row.
  const earlyAccessFlags = useEarlyAccessFlags((s) => s.bySku);
  const [addedId, setAddedId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  function activate(id: string) {
    if (onInspect) {
      onInspect(id);
    } else {
      navigate(`/product/${id}`);
    }
  }

  function handleAdd(e: React.MouseEvent<HTMLButtonElement>, product: Product, dose: string) {
    e.preventDefault();
    e.stopPropagation();
    // Member-first window — terminal buy surface, gated like CompoundTile.
    if (isEarlyAccessProduct(product, earlyAccessFlags) && !signedIn) return;
    // Resolve to a real priced dose — the row spec is empty for multi-dose
    // compounds (e.g. "AOD-9604"), which would otherwise add a $0 line.
    const sellableDose = resolveSellableDose(product, dose);
    if (!canQuickAdd(product, sellableDose) && onInspect) {
      onInspect(product.id);
      return;
    }
    addToCart(variantProduct(product, sellableDose));
    setAddedId(product.id);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setAddedId(null);
      timerRef.current = null;
    }, ADDED_MS);
  }

  return (
    <div
      className="overflow-hidden border rounded-procurement shadow-elev-1"
      style={{
        backgroundColor: 'var(--surface-product)',
        borderColor: 'var(--border-product)',
      }}
    >
      <table className="w-full text-sm table-fixed">
        <caption className="sr-only">Inventory catalog</caption>
        <thead className="sticky top-[56px] z-10 bg-base-700 border-b border-ink/[0.06]">
          <tr>
            <th scope="col" className={`${TH_CLASS} w-[200px]`}>SKU</th>
            <th scope="col" className={TH_CLASS}>Product</th>
            <th scope="col" className={`${TH_CLASS} w-[140px]`}>Family</th>
            <th scope="col" className={`${TH_CLASS} w-[200px]`}>Spec</th>
            <th scope="col" className={`${TH_CLASS} text-right w-[72px]`}>
              <span className="sr-only">Inquiry</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product, family, dose }, idx) => {
            const isAdded = addedId === product.id;
            const isLast = idx === rows.length - 1;
            return (
              <tr
                key={product.id}
                onClick={(e) => {
                  if (isInteractiveTarget(e.target)) return;
                  activate(product.id);
                }}
                className={[
                  'group transition-colors cursor-pointer',
                  'hover:bg-ink/[0.02]',
                  isLast ? '' : 'border-b border-ink/[0.06]',
                ].join(' ')}
              >
                {/* SKU */}
                <td className="px-[var(--space-4)] py-[var(--space-3)] tabular-nums text-ink/65 text-[12px] whitespace-nowrap truncate">
                  {product.sku}
                </td>

                {/* Product — abbreviation chip + real <Link> as keyboard focus target.
                    Wave 7c — chip prefixed for parity with mobile InventoryRow. */}
                <td className="px-[var(--space-4)] py-[var(--space-3)] truncate">
                  <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
                    <AbbreviationChip value={product.abbreviation} />
                    <Link
                      to={`/product/${product.id}`}
                      onClick={onInspect ? (e) => { e.preventDefault(); e.stopPropagation(); onInspect(product.id); } : undefined}
                      className="text-ink font-medium truncate group-hover:text-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35 focus-visible:text-gold"
                    >
                      {family}
                    </Link>
                  </span>
                </td>

                {/* Family / class — derived from category */}
                <td className="px-[var(--space-4)] py-[var(--space-3)] text-ink/55 text-[12px] whitespace-nowrap truncate">
                  {categoryLabel(product.category)}
                </td>

                {/* Spec — dose or spec headline */}
                <td className="px-[var(--space-4)] py-[var(--space-3)] text-ink/65 text-[12px] truncate">
                  {dose || <span className="text-ink/30">—</span>}
                </td>

                {/* Inquiry */}
                <td className="px-[var(--space-4)] py-[var(--space-3)] text-right">
                  <button
                    type="button"
                    onClick={(e) => handleAdd(e, product, dose)}
                    disabled={isEarlyAccessProduct(product, earlyAccessFlags) && !signedIn}
                    title={isEarlyAccessProduct(product, earlyAccessFlags) && !signedIn ? EARLY_ACCESS_GUEST_LINE : undefined}
                    aria-label={
                      isEarlyAccessProduct(product, earlyAccessFlags) && !signedIn
                        ? EARLY_ACCESS_GUEST_LINE
                        : isAdded
                          ? `${product.name} added to inquiry`
                          : `Add ${product.name} to inquiry`
                    }
                    className={[
                      'h-10 w-10 rounded-full border inline-flex items-center justify-center transition-colors',
                      'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/50',
                      isAdded
                        ? 'bg-gold/15 border-gold/40 text-gold'
                        : 'bg-ink/[0.04] border-ink/[0.09] text-ink/65 hover:bg-ink/[0.08] hover:text-ink',
                    ].join(' ')}
                  >
                    {isAdded ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * InventoryTableSkeleton
 *
 * Renders the table chrome (container + sticky header + N skeleton rows)
 * so the loading state preserves the exact column geometry of the live
 * table. No layout shift on data arrival.
 */
export function InventoryTableSkeleton({ rowCount = 8 }: { rowCount?: number }) {
  return (
    <div
      className="overflow-hidden border rounded-procurement shadow-elev-1"
      style={{
        backgroundColor: 'var(--surface-product)',
        borderColor: 'var(--border-product)',
      }}
      aria-hidden="true"
    >
      <table className="w-full text-sm table-fixed">
        <caption className="sr-only">Inventory catalog — loading</caption>
        <thead className="sticky top-[56px] z-10 bg-base-700 border-b border-ink/[0.06]">
          <tr>
            <th className={`${TH_CLASS} w-[200px]`}>SKU</th>
            <th className={TH_CLASS}>Product</th>
            <th className={`${TH_CLASS} w-[140px]`}>Family</th>
            <th className={`${TH_CLASS} w-[200px]`}>Spec</th>
            <th className={`${TH_CLASS} text-right w-[72px]`}></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr
              key={i}
              className={i === rowCount - 1 ? '' : 'border-b border-ink/[0.06]'}
            >
              <td className="px-[var(--space-4)] py-[var(--space-3)]">
                <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-32" />
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-3)]">
                <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-40" />
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-3)]">
                <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-20" />
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-3)]">
                <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-16" />
              </td>
              <td className="px-[var(--space-4)] py-[var(--space-3)] text-right">
                <div className="h-10 w-10 rounded-full bg-ink/[0.06] animate-pulse inline-block" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
