/**
 * InventoryRow
 * Wave 7 — Inventory Route Foundation
 *
 * A single procurement-density row in the catalog inventory list.
 * Mobile-first. Text-dominant. Solid surface module per the existing
 * surface hierarchy — reuses `.research-surface-solid` exactly. No new
 * surface level introduced.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │ {family}                       {dose}            [ + ] │
 *   │ {sku} · {shortDescription, truncated}                  │
 *   └────────────────────────────────────────────────────────┘
 *
 * Interactive structure:
 *   - <Link> covers the text content area and routes to /product/:id.
 *   - <button> is an absolutely-positioned SIBLING of the link (not a
 *     descendant) to keep the HTML5 interactive-content nesting valid.
 *     It dispatches `useCart.add(product)` without navigating and
 *     flips to a quiet ✓ affordance for ~1.4s.
 *
 * No image thumbnail. Text-only by design — procurement density wins.
 */

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';
import { useSignedIn } from '../../lib/authPresence';
import { EARLY_ACCESS_GUEST_LINE, isEarlyAccessProduct, useEarlyAccessFlags } from '../../lib/earlyAccess';
import { variantProduct, resolveSellableDose, canQuickAdd } from '../../lib/cartActions';
import { AbbreviationChip } from './AbbreviationChip';
import { SKUCode } from '../ui/identifiers';

interface InventoryRowProps {
  product: Product;
  /** Family label derived in the parent (e.g., "Semaglutide"). */
  family: string;
  /** Dose / spec headline derived in the parent. May be empty. */
  dose: string;
  /** When provided, row click opens the intelligence overlay instead of navigating. */
  onInspect?: (id: string) => void;
}

const ADDED_MS = 1400;

export function InventoryRow({ product, family, dose, onInspect }: InventoryRowProps) {
  const addToCart = useCart((s) => s.add);
  const signedIn = useSignedIn();
  // Member-first window — terminal buy surface, gated like CompoundTile.
  // Subscribed (not .getState()) so a flag load/toggle re-renders this row.
  const earlyAccessFlags = useEarlyAccessFlags((s) => s.bySku);
  const earlyLocked = isEarlyAccessProduct(product, earlyAccessFlags) && !signedIn;
  const [added, setAdded] = useState(false);
  const timerRef = useRef<number | null>(null);

  function handleAdd(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (earlyLocked) return;
    // Resolve to a real priced dose — the row headline is empty for multi-dose
    // compounds (e.g. "AOD-9604"), which would otherwise add a $0 line.
    const sellableDose = resolveSellableDose(product, dose);
    if (!canQuickAdd(product, sellableDose) && onInspect) {
      // Nothing priced to add — let the buyer pick a dose in the overlay.
      onInspect(product.id);
      return;
    }
    addToCart(variantProduct(product, sellableDose));
    setAdded(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setAdded(false);
      timerRef.current = null;
    }, ADDED_MS);
  }

  return (
    <div className="research-surface-solid is-interactive relative group">
      <Link
        to={`/product/${product.id}`}
        onClick={onInspect ? (e) => { e.preventDefault(); onInspect(product.id); } : undefined}
        className="block px-[var(--space-4)] py-[var(--space-3)] pr-14 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/25"
      >
        {/* Row 1 — abbreviation chip + family (primary) + dose chip (caption right).
            Wave 7c — chip prefixes the family for quick procurement scanning. */}
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {/* Compounds catalogued by their own research code (name === chip)
              would render the code twice — show it once. */}
          {family !== product.abbreviation && <AbbreviationChip value={product.abbreviation} />}
          <h3 className="text-sm font-normal text-ink truncate flex-1 min-w-0 group-hover:text-holo-light transition-colors">
            {family}
          </h3>
          {dose && (
            <span className="text-[11px] uppercase tracking-[0.2em] text-ink/55 max-w-[120px] truncate text-right shrink-0">
              {dose}
            </span>
          )}
        </div>

        {/* Row 2 — SKU · short description */}
        <p className="mt-1 text-[11px] tracking-wide text-ink/40 truncate">
          <SKUCode value={product.sku} className="text-ink/55" />
          {product.shortDescription && (
            <>
              <span className="mx-1.5 text-ink/25" aria-hidden="true">
                ·
              </span>
              <span>{product.shortDescription}</span>
            </>
          )}
        </p>
      </Link>

      {/* Inquiry action — absolute sibling, not nested inside <Link> */}
      <button
        type="button"
        onClick={handleAdd}
        disabled={earlyLocked}
        title={earlyLocked ? EARLY_ACCESS_GUEST_LINE : undefined}
        aria-label={
          earlyLocked
            ? EARLY_ACCESS_GUEST_LINE
            : added
              ? `${product.name} added to inquiry`
              : `Add ${product.name} to inquiry`
        }
        className={[
          'absolute right-[var(--space-3)] top-1/2 -translate-y-1/2',
          'h-10 w-10 rounded-full border flex items-center justify-center',
          'transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/50',
          added
            ? 'bg-holo/15 border-holo/40 text-holo-light'
            : 'bg-ink/[0.04] border-ink/[0.09] text-ink/65 hover:bg-holo/[0.08] hover:border-holo/30 hover:text-holo-light',
        ].join(' ')}
      >
        {added ? (
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
    </div>
  );
}

/**
 * InventoryRowSkeleton
 *
 * Mirrors `InventoryRow` bounds so the loading state occupies the list
 * without layout shift.
 */
export function InventoryRowSkeleton() {
  return (
    <div
      className="research-surface-solid relative px-[var(--space-4)] py-[var(--space-3)] pr-14"
      aria-hidden="true"
    >
      <div className="flex items-center gap-[var(--space-3)]">
        <div className="h-3 bg-ink/[0.06] rounded animate-pulse w-1/3" />
        <div className="ml-auto h-3 bg-ink/[0.06] rounded animate-pulse w-10" />
      </div>
      <div className="mt-2 h-2.5 bg-ink/[0.06] rounded animate-pulse w-2/3" />
      <div className="absolute right-[var(--space-3)] top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-ink/[0.06] animate-pulse" />
    </div>
  );
}
