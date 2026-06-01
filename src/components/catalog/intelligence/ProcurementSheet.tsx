/**
 * ProcurementSheet — canonical procurement-metadata renderer
 *
 * Pulls a documented row list from a Product (no synthesized values)
 * and renders it in one of three operational registers.
 *
 * Variants:
 *   - `passport` (default): compact DataGrid (label/value pairs in the
 *     8.5px–10.5px register). Used by the Overlay's procurement module
 *     and by ProductPage's sticky left column's compact strip.
 *   - `full`: labeled `<dl>` with section containment (`research-surface-
 *     elevated`). Used by ProductPage's right-column Procurement module.
 *
 * Optional `maxRows` truncates the row list. Used by the sticky-column
 * compact strip to show only the highest-priority procurement fields.
 *
 * Pure consumer: no Product fields are accessed by any other UI surface.
 * Row selection and ordering live entirely in `selectProcurementRows`.
 */

import { DataGrid } from './IntelModule';
import type { Product } from '../../../types';

interface ProcurementSheetProps {
  product: Product;
  variant?: 'passport' | 'full';
  /** Optional row cap. Top N rows from the canonical order. */
  maxRows?: number;
}

interface ProcurementRow {
  label: string;
  value: string;
}

/**
 * Canonical procurement row order. Higher-priority fields lead so
 * `maxRows` truncates from the tail (manufacturer/origin first when
 * present; batch and shipping last).
 */
export function selectProcurementRows(product: Product): ProcurementRow[] {
  const rows: ProcurementRow[] = [];
  if (product.manufacturer) rows.push({ label: 'Manufacturer', value: product.manufacturer });
  if (product.countryOfOrigin) rows.push({ label: 'Origin', value: product.countryOfOrigin });
  if (product.storageCondition) rows.push({ label: 'Storage', value: product.storageCondition });
  if (product.shippingCondition) rows.push({ label: 'Shipping', value: product.shippingCondition });
  if (product.lotNumber) rows.push({ label: 'Lot', value: product.lotNumber });
  if (product.batchReference) rows.push({ label: 'Batch', value: product.batchReference });
  if (product.leadTimeDays !== undefined) rows.push({ label: 'Lead Time', value: `${product.leadTimeDays} business days` });
  if (product.shelfLifeMonths != null) rows.push({ label: 'Shelf Life', value: `${product.shelfLifeMonths} months` });
  if (product.testingStandard) rows.push({ label: 'Testing Standard', value: product.testingStandard });
  return rows;
}

export function ProcurementSheet({ product, variant = 'passport', maxRows }: ProcurementSheetProps) {
  const allRows = selectProcurementRows(product);
  const rows = typeof maxRows === 'number' ? allRows.slice(0, maxRows) : allRows;
  if (rows.length === 0) return null;

  if (variant === 'full') {
    return (
      <div className="research-surface-elevated overflow-hidden">
        <dl className="border-t border-white/[0.06]">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] px-[var(--space-4)] border-b border-white/[0.06]"
            >
              <dt className="text-[11px] uppercase tracking-[0.2em] text-white/40 shrink-0">{r.label}</dt>
              <dd className="text-sm text-white/70 text-right font-mono tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  // passport variant (default)
  return <DataGrid rows={rows} />;
}
