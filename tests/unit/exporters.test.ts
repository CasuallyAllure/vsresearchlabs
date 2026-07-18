// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/exporters.ts — the dependency-free spreadsheet
 * export layer: toCsv/downloadCsv, the hand-built OOXML .xlsx writer
 * (downloadXlsx), and the filename stamp.
 *
 * The download trigger is exercised minimally through stubs
 * (URL.createObjectURL + anchor click); the data shaping is exercised
 * thoroughly — including unzipping the store-method .xlsx produced by
 * downloadXlsx with a test-local ZIP reader to pin the worksheet XML,
 * part names, sheet-name sanitizing, and central-directory bookkeeping.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadCsv, downloadXlsx, stamp, toCsv, type Column } from '../../src/lib/exporters';

// ── download capture harness ────────────────────────────────────────────────

let capturedBlobs: Blob[] = [];
let clickedAnchors: Array<{ download: string; href: string; connected: boolean }> = [];

beforeEach(() => {
  capturedBlobs = [];
  clickedAnchors = [];
  // happy-dom lacks object URLs — install capturing stubs.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobs.push(blob);
    return `blob:mock-${capturedBlobs.length}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchors.push({
      download: this.download,
      href: this.getAttribute('href') ?? '',
      connected: this.isConnected,
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── test-local store-method ZIP reader (mirrors nothing; reads the spec) ────

const readU16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const readU32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface ZipEntry { data: Uint8Array; crc: number }

function parseZip(bytes: Uint8Array): { entries: Map<string, ZipEntry>; centralOffset: number } {
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  let o = 0;
  while (o + 4 <= bytes.length && readU32(bytes, o) === 0x04034b50) {
    const crc = readU32(bytes, o + 14);
    const size = readU32(bytes, o + 18);
    const nameLen = readU16(bytes, o + 26);
    const extraLen = readU16(bytes, o + 28);
    const name = dec.decode(bytes.slice(o + 30, o + 30 + nameLen));
    const start = o + 30 + nameLen + extraLen;
    entries.set(name, { data: bytes.slice(start, start + size), crc });
    o = start + size;
  }
  return { entries, centralOffset: o };
}

async function lastBlobZip(): Promise<{ entries: Map<string, ZipEntry>; bytes: Uint8Array }> {
  const blob = capturedBlobs[capturedBlobs.length - 1];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { entries: parseZip(bytes).entries, bytes };
}

async function sheetXmlOf(): Promise<string> {
  const { entries } = await lastBlobZip();
  return new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml')!.data);
}

// ── shared fixtures ─────────────────────────────────────────────────────────

interface Row { label: string; qty: number | null; usd: number | null }
const columns: Column<Row>[] = [
  { header: 'Label', value: (r) => r.label },
  { header: 'Qty', value: (r) => r.qty, type: 'number' },
  { header: 'Invoice (USD)', value: (r) => r.usd, type: 'currency' },
];

// ── stamp ───────────────────────────────────────────────────────────────────

describe('stamp', () => {
  test('formats a date as a YYYYMMDD filename stamp', () => {
    expect(stamp(new Date('2026-07-17T15:30:00Z'))).toBe('20260717');
  });

  test('zero-pads month and day', () => {
    expect(stamp(new Date('2026-01-05T00:00:00Z'))).toBe('20260105');
  });
});

// ── toCsv ───────────────────────────────────────────────────────────────────

describe('toCsv', () => {
  test('joins the header row and data rows with CRLF', () => {
    // Arrange / Act
    const csv = toCsv(columns, [{ label: 'vial', qty: 3, usd: 12.5 }]);

    // Assert
    expect(csv).toBe('Label,Qty,Invoice (USD)\r\nvial,3,12.5');
  });

  test('zero rows still emit the header line', () => {
    expect(toCsv(columns, [])).toBe('Label,Qty,Invoice (USD)\r\n');
  });

  test('null and undefined cells become empty fields', () => {
    // Arrange
    const cols: Column<Record<string, never>>[] = [
      { header: 'a', value: () => null },
      { header: 'b', value: () => undefined },
    ];

    // Act / Assert
    expect(toCsv(cols, [{}])).toBe('a,b\r\n,');
  });

  test('quotes and escapes fields containing commas, quotes, and newlines', () => {
    // Arrange
    const cols: Column<string>[] = [{ header: 'v', value: (s) => s }];

    // Act / Assert — comma, doubled quote, LF, CR each force quoting.
    expect(toCsv(cols, ['a,b'])).toBe('v\r\n"a,b"');
    expect(toCsv(cols, ['say "hi"'])).toBe('v\r\n"say ""hi"""');
    expect(toCsv(cols, ['l1\nl2'])).toBe('v\r\n"l1\nl2"');
    expect(toCsv(cols, ['l1\rl2'])).toBe('v\r\n"l1\rl2"');
  });

  test('a header containing a comma is quoted too', () => {
    // Arrange
    const cols: Column<string>[] = [{ header: 'Name, Full', value: (s) => s }];

    // Act / Assert
    expect(toCsv(cols, ['x'])).toBe('"Name, Full"\r\nx');
  });

  test('numeric columns write finite numbers raw, without quoting', () => {
    expect(toCsv(columns, [{ label: 'x', qty: 0, usd: 1234.56 }])).toBe(
      'Label,Qty,Invoice (USD)\r\nx,0,1234.56',
    );
  });

  test('a non-finite number in a numeric column falls back to its text form', () => {
    // Arrange / Act — NaN fails Number.isFinite, so it goes down the string path.
    const csv = toCsv(columns, [{ label: 'x', qty: NaN, usd: Infinity }]);

    // Assert
    expect(csv).toBe('Label,Qty,Invoice (USD)\r\nx,NaN,Infinity');
  });

  test('a string value in a numeric column is treated as text', () => {
    // Arrange — a column typed number whose accessor leaks a string.
    const cols: Column<string>[] = [{ header: 'n', value: (s) => s, type: 'number' }];

    // Act / Assert — quoted because of its comma, not written as a number.
    expect(toCsv(cols, ['1,000'])).toBe('n\r\n"1,000"');
  });
});

// ── downloadCsv ─────────────────────────────────────────────────────────────

describe('downloadCsv', () => {
  test('builds a UTF-8 BOM-prefixed text/csv blob of the toCsv output', async () => {
    // Arrange / Act
    downloadCsv('report', columns, [{ label: 'vial', qty: 3, usd: 12.5 }]);

    // Assert
    expect(capturedBlobs).toHaveLength(1);
    expect(capturedBlobs[0].type).toBe('text/csv;charset=utf-8');
    expect(await capturedBlobs[0].text()).toBe('﻿Label,Qty,Invoice (USD)\r\nvial,3,12.5');
  });

  test('appends .csv when the filename lacks it and keeps it when present', () => {
    // Arrange / Act
    downloadCsv('report', columns, []);
    downloadCsv('report.csv', columns, []);

    // Assert
    expect(clickedAnchors.map((a) => a.download)).toEqual(['report.csv', 'report.csv']);
  });

  test('clicks a connected anchor pointing at the object URL, then removes it', () => {
    // Arrange / Act
    downloadCsv('report', columns, []);

    // Assert — clicked while attached to the DOM, href = created URL, gone after.
    expect(clickedAnchors).toEqual([{ download: 'report.csv', href: 'blob:mock-1', connected: true }]);
    expect(document.querySelector('a')).toBeNull();
  });

  test('revokes the object URL one second after the click, not before', () => {
    // Arrange
    vi.useFakeTimers();

    // Act
    downloadCsv('report', columns, []);

    // Assert — revoke waits for the browser to start the download.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });
});

// ── downloadXlsx ────────────────────────────────────────────────────────────

describe('downloadXlsx — package structure', () => {
  test('produces a spreadsheet-typed blob and appends .xlsx when missing', async () => {
    // Arrange / Act
    downloadXlsx('report', 'Sheet', columns, []);
    downloadXlsx('report.xlsx', 'Sheet', columns, []);

    // Assert
    expect(capturedBlobs[0].type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(clickedAnchors.map((a) => a.download)).toEqual(['report.xlsx', 'report.xlsx']);
  });

  test('the ZIP holds the five OOXML parts, in order, all store-method', async () => {
    // Arrange / Act
    downloadXlsx('report', 'Sheet', columns, []);
    const { entries } = await lastBlobZip();

    // Assert
    expect([...entries.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  test('the central directory and end record agree with the local entries', async () => {
    // Arrange / Act
    downloadXlsx('report', 'Sheet', columns, [{ label: 'x', qty: 1, usd: 2 }]);
    const { entries, bytes } = await lastBlobZip();
    const { centralOffset } = parseZip(bytes);

    // Assert — central dir starts where the locals end; EOCD counts 5 entries
    // and points back at the central dir; per-entry CRCs match local↔central.
    expect(readU32(bytes, centralOffset)).toBe(0x02014b50);
    const eocd = bytes.length - 22;
    expect(readU32(bytes, eocd)).toBe(0x06054b50);
    expect(readU16(bytes, eocd + 8)).toBe(5); // entries on this disk
    expect(readU16(bytes, eocd + 10)).toBe(5); // entries total
    expect(readU32(bytes, eocd + 16)).toBe(centralOffset);
    // Walk central entries: crc at +16, name at +46.
    let o = centralOffset;
    const dec = new TextDecoder();
    while (readU32(bytes, o) === 0x02014b50) {
      const crc = readU32(bytes, o + 16);
      const nameLen = readU16(bytes, o + 28);
      const name = dec.decode(bytes.slice(o + 46, o + 46 + nameLen));
      expect(crc).toBe(entries.get(name)!.crc);
      o += 46 + nameLen;
    }
    expect(o).toBe(eocd);
  });

  test('workbook.xml carries the sheet name', async () => {
    // Arrange / Act
    downloadXlsx('report', 'Inventory 2026', columns, []);
    const { entries } = await lastBlobZip();

    // Assert
    expect(new TextDecoder().decode(entries.get('xl/workbook.xml')!.data))
      .toContain('<sheet name="Inventory 2026" sheetId="1"');
  });
});

describe('downloadXlsx — sheet name sanitizing', () => {
  const nameInWorkbook = async (): Promise<string> => {
    const { entries } = await lastBlobZip();
    const xml = new TextDecoder().decode(entries.get('xl/workbook.xml')!.data);
    return /<sheet name="([^"]*)"/.exec(xml)![1];
  };

  test('replaces the characters Excel forbids with spaces', async () => {
    // Arrange / Act — \ / ? * [ ] : are all illegal in sheet names.
    downloadXlsx('r', 'a\\b/c?d*e[f]g:h', columns, []);

    // Assert
    expect(await nameInWorkbook()).toBe('a b c d e f g h');
  });

  test('truncates to the 31-character Excel limit', async () => {
    // Arrange / Act
    downloadXlsx('r', 'X'.repeat(40), columns, []);

    // Assert
    expect(await nameInWorkbook()).toBe('X'.repeat(31));
  });

  test('an all-illegal name collapses to the Report fallback', async () => {
    // Arrange / Act
    downloadXlsx('r', '///', columns, []);

    // Assert
    expect(await nameInWorkbook()).toBe('Report');
  });
});

describe('downloadXlsx — worksheet cells', () => {
  test('writes headers as inline strings on row 1 with A1-style refs', async () => {
    // Arrange / Act
    downloadXlsx('r', 'S', columns, []);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml).toContain(
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">Label</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t xml:space="preserve">Qty</t></is></c>' +
      '<c r="C1" t="inlineStr"><is><t xml:space="preserve">Invoice (USD)</t></is></c>' +
      '</row>',
    );
  });

  test('number and currency cells are written as real numeric <v> cells', async () => {
    // Arrange / Act
    downloadXlsx('r', 'S', columns, [{ label: 'vial', qty: 3, usd: 12.5 }]);
    const xml = await sheetXmlOf();

    // Assert — Excel can sum these; they are not text.
    expect(xml).toContain('<row r="2">' +
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">vial</t></is></c>' +
      '<c r="B2"><v>3</v></c>' +
      '<c r="C2"><v>12.5</v></c>' +
      '</row>');
  });

  test('null, undefined, and empty-string values become empty cells', async () => {
    // Arrange
    const cols: Column<Record<string, never>>[] = [
      { header: 'a', value: () => null },
      { header: 'b', value: () => undefined, type: 'number' },
      { header: 'c', value: () => '' },
    ];

    // Act
    downloadXlsx('r', 'S', cols, [{}]);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml).toContain('<row r="2"><c r="A2"/><c r="B2"/><c r="C2"/></row>');
  });

  test('a non-finite number in a numeric column degrades to an inline string', async () => {
    // Arrange
    const cols: Column<number>[] = [{ header: 'n', value: (v) => v, type: 'number' }];

    // Act
    downloadXlsx('r', 'S', cols, [NaN]);
    const xml = await sheetXmlOf();

    // Assert — never an invalid <v>NaN</v> numeric cell.
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>');
  });

  test('a number in an untyped column is stringified, not written as numeric', async () => {
    // Arrange
    const cols: Column<number>[] = [{ header: 'n', value: (v) => v }];

    // Act
    downloadXlsx('r', 'S', cols, [7]);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">7</t></is></c>');
  });

  test('escapes XML metacharacters and strips forbidden control chars', async () => {
    // Arrange
    const cols: Column<string>[] = [{ header: 'v', value: (s) => s }];

    // Act — & < > " ' plus a NUL and a BEL that XML 1.0 forbids.
    downloadXlsx('r', 'S', cols, ['a&b<c>d"e\'f\u0000\u0007g']);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml).toContain(
      '<t xml:space="preserve">a&amp;b&lt;c&gt;d&quot;e&apos;fg</t>',
    );
  });

  test('column refs roll from Z to AA past the 26th column', async () => {
    // Arrange — 28 columns → refs A..Z, AA, AB.
    const cols: Column<Record<string, never>>[] = Array.from({ length: 28 }, (_, i) => ({
      header: `h${i}`,
      value: () => `v${i}`,
    }));

    // Act
    downloadXlsx('r', 'S', cols, [{}]);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml).toContain('<c r="Z1"');
    expect(xml).toContain('<c r="AA1"');
    expect(xml).toContain('<c r="AB1"');
    expect(xml).toContain('<c r="AB2"');
    expect(xml).not.toContain('<c r="AC1"');
  });

  test('data rows are numbered from 2 in input order', async () => {
    // Arrange / Act
    downloadXlsx('r', 'S', columns, [
      { label: 'first', qty: 1, usd: 1 },
      { label: 'second', qty: 2, usd: 2 },
    ]);
    const xml = await sheetXmlOf();

    // Assert
    expect(xml.indexOf('<row r="2">')).toBeGreaterThan(-1);
    expect(xml.indexOf('<row r="3">')).toBeGreaterThan(xml.indexOf('<row r="2">'));
    expect(xml).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">second</t></is></c>');
  });
});
