/**
 * csv — dependency-free CSV parsing (the counterpart to exporters.toCsv).
 *
 * Handles the things Excel / Numbers / Sheets actually emit: a UTF-8 BOM,
 * quoted fields, embedded commas + newlines inside quotes, doubled quotes
 * ("" → "), and either CRLF or LF line endings. Trailing blank lines are
 * dropped. Returns a matrix of raw string cells; mapping to records is the
 * caller's job.
 */

/** Parse CSV text into a matrix of string cells. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, ''); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; } // CR handled via the LF
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  // flush the last field/row if the file didn't end with a newline
  if (field !== '' || row.length > 0) endRow();

  // Drop trailing fully-empty rows.
  while (rows.length && rows[rows.length - 1].every((cell) => cell.trim() === '')) {
    rows.pop();
  }
  return rows;
}

/**
 * Parse CSV into objects keyed by a normalized header.
 * Headers are lower-cased and trimmed so "Price (USD)" → "price (usd)".
 * Returns { headers, records } where each record maps normalized header → cell.
 */
export function parseCsvRecords(input: string): {
  headers: string[];
  records: Record<string, string>[];
} {
  const matrix = parseCsv(input);
  if (matrix.length === 0) return { headers: [], records: [] };
  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  const records = matrix.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = (cells[idx] ?? '').trim(); });
    return rec;
  });
  return { headers, records };
}
