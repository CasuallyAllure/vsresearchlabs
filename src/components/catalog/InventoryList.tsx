/**
 * InventoryList
 * Wave 7 — Inventory Route Foundation
 * Wave 7b — Adds desktop tabular rendering at lg+ via `InventoryTable`.
 *
 * Renders a vertical, procurement-density list of `InventoryRow`s on
 * mobile, and a procurement-terminal-style `InventoryTable` on lg+.
 * Both subtrees consume the SAME derived row data — derivation runs
 * exactly once per render and is shared across viewports.
 *
 * Visibility is CSS-gated (`lg:hidden` / `hidden lg:block`) so the
 * mobile stack is byte-for-byte identical to Wave 7. Wave 7b is purely
 * additive for desktop.
 *
 * Owns the row-level meta derivation (family + dose) via a pure
 * function exported alongside the component so the page can reuse it
 * for filter / search semantics without re-implementing.
 */

import { useMemo } from 'react';
import type { Product } from '../../types';
import { InventoryRow, InventoryRowSkeleton } from './InventoryRow';
import {
  InventoryTable,
  InventoryTableSkeleton,
  type InventoryTableRow,
} from './InventoryTable';
import { EmptyState } from '../system/EmptyState';

interface InventoryListProps {
  products: Product[];
  loading?: boolean;
  emptyLabel?: string;
  onInspect?: (id: string) => void;
}

export interface DerivedRowMeta {
  family: string;
  dose: string;
}

const SPLIT_TOKENS = [' — ', ' – ', ' - '];

/**
 * deriveRowMeta
 *
 * Pure derivation of a row's family + dose labels from `product.name`.
 * Seed convention is em-dash separated: "Semaglutide — 5mg".
 * Falls back to en-dash and hyphen for robustness.
 * Non-conforming names degrade gracefully: family = full name, dose = "".
 */
export function deriveRowMeta(product: Product): DerivedRowMeta {
  for (const sep of SPLIT_TOKENS) {
    const idx = product.name.indexOf(sep);
    if (idx > -1) {
      return {
        family: product.name.slice(0, idx).trim(),
        dose: product.name.slice(idx + sep.length).trim(),
      };
    }
  }
  return { family: product.name, dose: '' };
}

const SKELETON_COUNT = 8;

export function InventoryList({
  products,
  loading = false,
  emptyLabel = 'No matching SKUs.',
  onInspect,
}: InventoryListProps) {
  const rows = useMemo<InventoryTableRow[]>(
    () =>
      products.map((product) => ({
        product,
        ...deriveRowMeta(product),
      })),
    [products],
  );

  if (loading) {
    return (
      <>
        {/* Mobile — vertical skeleton stack */}
        <div className="lg:hidden flex flex-col gap-[var(--space-2)]">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <InventoryRowSkeleton key={i} />
          ))}
        </div>
        {/* Desktop — table skeleton */}
        <div className="hidden lg:block">
          <InventoryTableSkeleton rowCount={SKELETON_COUNT} />
        </div>
      </>
    );
  }

  if (rows.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <>
      {/* Mobile — vertical row stack (Wave 7, unchanged) */}
      <div className="lg:hidden flex flex-col gap-[var(--space-2)]">
        {rows.map(({ product, family, dose }) => (
          <InventoryRow
            key={product.id}
            product={product}
            family={family}
            dose={dose}
            onInspect={onInspect}
          />
        ))}
      </div>

      {/* Desktop — tabular rendering at lg+ (Wave 7b) */}
      <div className="hidden lg:block">
        <InventoryTable rows={rows} onInspect={onInspect} />
      </div>
    </>
  );
}
