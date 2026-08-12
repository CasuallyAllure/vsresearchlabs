/**
 * SpecificationSheet — analytical specification table (product page only)
 *
 * Renders the objective, per-lot-independent analytical specification a
 * laboratory buyer needs before ordering: purity and its method, physical
 * form, mass/volume, and the equipment specs on non-compound SKUs.
 *
 * This data lives on `Product.specs` and — until this component existed —
 * was never rendered on the product page at all. It is deliberately NOT
 * part of the research dossier: the dossier documents what a compound is
 * studied for, the spec sheet documents what arrives in the vial.
 *
 * Row selection lives entirely in `selectSpecificationRows` so future
 * specification fields (molecular formula, appearance, solubility,
 * sequence) can be added in one place without restructuring the render.
 * Nothing is synthesized: a field that does not exist yields no row.
 */

import type { Product } from '../../types';

export interface SpecificationRow {
  label: string;
  value: string;
}

/**
 * Spec labels that are rendered by another block of the spec sheet and
 * must not appear twice on one page. `Storage` is owned by the
 * Procurement & Handling block (`Product.storageCondition`).
 */
const RELOCATED_SPEC_LABELS: ReadonlySet<string> = new Set(['Storage']);

/**
 * Canonical analytical rows for a product, in data order. Rows with a
 * missing or blank label/value are omitted entirely rather than rendered
 * as an empty or "undefined" row.
 */
export function selectSpecificationRows(product: Product): SpecificationRow[] {
  const specRows = (product.specs ?? [])
    .filter((s) => Boolean(s?.label?.trim()) && Boolean(s?.value?.trim()))
    .filter((s) => !RELOCATED_SPEC_LABELS.has(s.label.trim()))
    .map((s) => ({ label: s.label.trim(), value: s.value.trim() }));

  // Molecular formula is a first-class specification field rather than a
  // free-form `specs` entry. Absent for blends and heterogeneous biologics by
  // design — no formula, no row.
  const formula = product.molecularFormula?.trim();
  const formulaRows = formula ? [{ label: 'Molecular Formula', value: formula }] : [];

  // Substance name for compounds catalogued under a research code. Leads the
  // sheet so the identity behind the code is stated before any measurement.
  const chemical = product.chemicalName?.trim();
  const identityRows = chemical ? [{ label: 'Chemical Identity', value: chemical }] : [];

  return [...identityRows, ...formulaRows, ...specRows];
}

export function SpecificationSheet({ product }: { product: Product }) {
  const rows = selectSpecificationRows(product);
  if (rows.length === 0) return null;

  return (
    <div className="research-surface-elevated overflow-hidden">
      <dl className="border-t border-ink/[0.05]">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-4)] px-[var(--space-4)] border-b border-ink/[0.05]"
          >
            <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 shrink-0">
              {r.label}
            </dt>
            <dd className="text-sm text-ink/70 text-right font-mono tabular-nums">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
