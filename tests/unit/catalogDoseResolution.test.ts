/**
 * Guard: every real catalog line must resolve to its own dose.
 *
 * place-order now FAILS CLOSED — a line whose dose the server cannot resolve
 * unambiguously refuses the order (priceCheck.ts). That makes dose resolution a
 * checkout availability concern, not just a security one: a new SKU whose doses
 * collide textually would silently make real orders unbuyable.
 *
 * So this replays the whole live catalog through the real resolver, building each
 * cart line the way src/lib/cartActions.ts variantProduct does (the dose is
 * appended to the product name unless the name already carries one).
 *
 * If this fails after a catalog change, do NOT loosen the resolver — the two
 * doses genuinely can't be told apart from the line text, and the fix is to
 * rename the dose (or give the SKU distinguishable dose labels).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { resolveVariantRow } from '../../supabase/functions/place-order/priceCheck';
import { deriveProductDose } from '../../src/types/product';

interface CatalogRow {
  sku: string;
  dose: string;
}
interface CatalogLine extends CatalogRow {
  name: string;
}

/**
 * The line name the cart would actually send, using the REAL predicate the
 * client uses — cartActions.variantProduct asks deriveProductDose (a separator
 * scan for " — " / " – " / " - "), NOT "does the name look dose-shaped?". An
 * earlier cut of this test used a lookalike regex, which would have modelled a
 * name like "Special Batch — Alpha" as needing its dose appended when the real
 * client would not append it — hiding exactly the failure this guard exists to
 * catch.
 */
const cartLineName = (name: string, dose: string): string =>
  deriveProductDose({ name }).length > 0 ? name : `${name} — ${dose}`;

function loadCatalog(): { rows: CatalogRow[]; lines: CatalogLine[] } {
  const rows: CatalogRow[] = [];
  const lines: CatalogLine[] = [];
  for (const file of ['src/data/products.json', 'src/data/biopeptideCompounds.generated.json']) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const products = Array.isArray(parsed) ? parsed : (parsed.products ?? parsed.compounds ?? []);
    for (const product of products) {
      for (const variant of product.variants ?? []) {
        rows.push({ sku: product.sku, dose: variant.dose });
        lines.push({
          sku: product.sku,
          dose: variant.dose,
          name: cartLineName(product.name, variant.dose),
        });
      }
    }
  }
  return { rows, lines };
}

describe('live catalog dose resolution', () => {
  const { rows, lines } = loadCatalog();

  test('the catalog is actually loaded (guards a silently empty sweep)', () => {
    expect(lines.length).toBeGreaterThan(100);
  });

  test('every catalog line resolves to its own dose — no misses, no ambiguity', () => {
    const broken = lines
      .map((line) => ({ line, got: resolveVariantRow(line.sku, line.name, rows) }))
      .filter(({ line, got }) => got?.dose !== line.dose)
      .map(({ line, got }) =>
        `${line.sku} "${line.name}" → expected ${line.dose}, got ${got?.dose ?? 'UNRESOLVED (would refuse this order)'}`,
      );

    expect(broken).toEqual([]);
  });

  test('IGF-1 LR3 is still the nesting case this guard exists for', () => {
    // If this ever fails the catalog changed shape; the sweep above is the real
    // assertion, but this documents the known-hard example.
    const igf = rows.filter((r) => r.sku === 'VSR-RS-IGF').map((r) => r.dose).sort();
    expect(igf).toEqual(['0.1mg', '1mg']);
  });
});
