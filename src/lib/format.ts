/**
 * Procurement formatting utilities — R1
 *
 * Pure functions. No I/O. Safe to call in render and server contexts.
 */

/** Format an ISO 8601 date or datetime as "YYYY-MM-DD". */
export function formatDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/**
 * Format a price in cents for procurement display.
 * null or 0 → "Inquire for pricing"
 * positive  → "$XX.XX USD"
 */
export function formatProcurementNumber(cents: number | null): string {
  if (cents === null || cents === 0) return 'Inquire for pricing';
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)} USD`;
}

/**
 * Format a quantity + unit for display.
 * e.g. formatQuantityUnit(5, 'mg') → "5 mg"
 *      formatQuantityUnit(100, 'units') → "100 units"
 */
export function formatQuantityUnit(qty: number, unit: string): string {
  return `${qty} ${unit}`;
}

/**
 * Normalize a short procurement code: uppercase, trimmed.
 * e.g. formatShortCode('sem') → "SEM"
 */
export function formatShortCode(s: string): string {
  return s.trim().toUpperCase();
}
