/**
 * Stock availability — placeholder source of truth.
 *
 * Real inventory data is not wired in yet. Until it is, availability is
 * computed deterministically so the same item always reads the same way
 * across every surface (the biopeptide grid and the full-inventory
 * modal). Swap these helpers for a real inventory lookup when the feed
 * is available — every caller will pick up live data automatically.
 *
 * Distribution: ~83% in stock, scattered evenly.
 */

const OUT_OF_STOCK_THRESHOLD = 4;
const MODULUS = 23;

/** Manifest rows carry a stable serial — used by the full-inventory modal. */
export function inStockBySerial(serial: number): boolean {
  return (serial * 7 + 3) % MODULUS >= OUT_OF_STOCK_THRESHOLD;
}

/** Catalog products have no serial — derive from a stable string key
 *  (e.g. the product id) so the result is stable across renders. */
export function inStockByKey(key: string): boolean {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % MODULUS >= OUT_OF_STOCK_THRESHOLD;
}
