/**
 * exporters — dependency-free spreadsheet export.
 *
 * Turns a typed (columns, rows) spec into a downloadable file:
 *   • downloadCsv  — UTF-8 CSV (opens in Excel/Numbers/Sheets)
 *   • downloadXlsx — a REAL .xlsx workbook, hand-built (OOXML + a minimal
 *     store-method ZIP with CRC32). Numeric/currency cells are written as
 *     real numbers so Excel can sum/filter them — not text.
 *
 * No third-party libraries. Browser-only (uses Blob + a temporary anchor).
 *
 * A column maps a row to a cell. `type` controls how the value is written:
 *   'text'     → string cell
 *   'number'   → numeric cell
 *   'currency' → numeric cell (value already in the display unit, e.g.
 *                dollars); header should note the unit (e.g. "Invoice (USD)")
 */

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  type?: 'text' | 'number' | 'currency';
}

// ── shared ──────────────────────────────────────────────────────────────────

function isNumeric<T>(col: Column<T>): boolean {
  return col.type === 'number' || col.type === 'currency';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ISO date stamp (YYYYMMDD) for filenames — caller passes `new Date()`. */
export function stamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(raw: string | number | null | undefined, numeric: boolean): string {
  if (raw === null || raw === undefined) return '';
  if (numeric && typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  const s = String(raw);
  // Quote anything risky; double internal quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const head = columns.map((c) => csvCell(c.header, false)).join(',');
  const body = rows
    .map((row) => columns.map((c) => csvCell(c.value(row), isNumeric(c))).join(','))
    .join('\r\n');
  return `${head}\r\n${body}`;
}

export function downloadCsv<T>(filename: string, columns: Column<T>[], rows: T[]): void {
  // Prepend a BOM so Excel reads UTF-8 (µ, ≥, °, etc.) correctly.
  const blob = new Blob(["\uFEFF", toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

// ── XLSX (hand-built OOXML in a minimal ZIP) ─────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // strip control chars XML 1.0 forbids
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function colLetter(n: number): string {
  // 0-based → A, B, … Z, AA, AB …
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml<T>(columns: Column<T>[], rows: T[]): string {
  const lines: string[] = [];
  // header row (r=1)
  lines.push(
    `<row r="1">${columns
      .map((c, ci) => `<c r="${colLetter(ci)}1" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.header)}</t></is></c>`)
      .join('')}</row>`,
  );
  rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells = columns
      .map((c, ci) => {
        const ref = `${colLetter(ci)}${r}`;
        const v = c.value(row);
        if (isNumeric(c) && typeof v === 'number' && Number.isFinite(v)) {
          return `<c r="${ref}"><v>${v}</v></c>`;
        }
        if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
      })
      .join('');
    lines.push(`<row r="${r}">${cells}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

function safeSheetName(name: string): string {
  return (name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)) || 'Report';
}

// ── minimal ZIP (store / no compression) ─────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const push = (a: Uint8Array) => { for (let i = 0; i < a.length; i++) out.push(a[i]); };
  const enc = new TextEncoder();
  const central: number[] = [];
  const cu16 = (v: number) => central.push(v & 0xff, (v >> 8) & 0xff);
  const cu32 = (v: number) => central.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const offset = out.length;
    // local file header
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0); // sig, ver, flags, method, time, date
    u32(crc); u32(f.data.length); u32(f.data.length); u16(nameBytes.length); u16(0);
    push(nameBytes); push(f.data);
    // central directory entry (buffered)
    cu32(0x02014b50); cu16(20); cu16(20); cu16(0); cu16(0); cu16(0); cu16(0);
    cu32(crc); cu32(f.data.length); cu32(f.data.length);
    cu16(nameBytes.length); cu16(0); cu16(0); cu16(0); cu16(0); cu32(0); cu32(offset);
    for (let i = 0; i < nameBytes.length; i++) central.push(nameBytes[i]);
  }

  const cdOffset = out.length;
  for (const b of central) out.push(b);
  const cdSize = central.length;
  // end of central directory
  u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(cdSize); u32(cdOffset); u16(0);
  return Uint8Array.from(out);
}

export function downloadXlsx<T>(
  filename: string,
  sheetName: string,
  columns: Column<T>[],
  rows: T[],
): void {
  const enc = new TextEncoder();
  const file = (name: string, content: string) => ({ name, data: enc.encode(content) });
  const sn = safeSheetName(sheetName);

  const files = [
    file('[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    file('_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file('xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sn)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    file('xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    file('xl/worksheets/sheet1.xml', sheetXml(columns, rows)),
  ];

  const blob = new Blob([zipStore(files) as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
