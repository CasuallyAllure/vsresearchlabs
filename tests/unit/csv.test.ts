/**
 * Unit tests for src/lib/csv.ts — dependency-free CSV parsing, the import
 * counterpart to exporters.toCsv.
 *
 * Pins the messy realities spreadsheet apps actually emit: UTF-8 BOMs,
 * quoted fields with embedded commas/newlines, doubled quotes, CRLF vs LF,
 * missing trailing newlines, and trailing blank rows. The final block pins
 * the export→import round trip against exporters.toCsv so the two sides
 * can never drift.
 */
import { describe, expect, test } from 'vitest';
import { parseCsv, parseCsvRecords } from '../../src/lib/csv';
import { toCsv, type Column } from '../../src/lib/exporters';

describe('parseCsv — basic shapes', () => {
  test('parses simple comma-separated rows', () => {
    // Arrange / Act
    const rows = parseCsv('a,b,c\n1,2,3');

    // Assert
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('returns an empty matrix for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  test('treats CRLF and LF line endings identically', () => {
    // Arrange / Act
    const crlf = parseCsv('a,b\r\n1,2\r\n');
    const lf = parseCsv('a,b\n1,2\n');

    // Assert
    expect(crlf).toEqual([['a', 'b'], ['1', '2']]);
    expect(lf).toEqual(crlf);
  });

  test('flushes the last row when the file does not end with a newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('preserves empty fields between commas', () => {
    expect(parseCsv('a,,c\nx,,z')).toEqual([['a', '', 'c'], ['x', '', 'z']]);
  });

  test('drops trailing fully-empty rows', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c']]);
  });
});

describe('parseCsv — BOM handling', () => {
  test('strips a leading UTF-8 BOM before the first header', () => {
    // Arrange / Act — Excel prepends \uFEFF to UTF-8 CSVs.
    const rows = parseCsv('\uFEFFsku,name\nA,Alpha');

    // Assert — the BOM never leaks into the first cell.
    expect(rows[0][0]).toBe('sku');
  });

  test('only strips the BOM at position zero, not mid-file', () => {
    // Arrange / Act — a stray BOM inside a cell is data, not framing.
    const rows = parseCsv('a,﻿b');

    // Assert
    expect(rows).toEqual([['a', '﻿b']]);
  });
});

describe('parseCsv — quoted fields', () => {
  test('a quoted field carries embedded commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  test('a quoted field carries embedded newlines (LF and CRLF)', () => {
    // Arrange / Act
    const rows = parseCsv('"line1\nline2",x\r\n"a\r\nb",y');

    // Assert — the newline stays inside the cell; CR survives as typed.
    expect(rows).toEqual([['line1\nline2', 'x'], ['a\r\nb', 'y']]);
  });

  test('doubled quotes inside a quoted field collapse to one quote', () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
  });

  test('a field that is only a doubled quote pair parses to a single quote', () => {
    expect(parseCsv('""""')).toEqual([['"']]);
  });

  test('quoted and unquoted fields mix freely in one row', () => {
    expect(parseCsv('plain,"quo,ted",also plain')).toEqual([['plain', 'quo,ted', 'also plain']]);
  });

  test('an unterminated quote consumes to end of input without hanging', () => {
    // Arrange / Act — malformed input must still terminate and flush.
    const rows = parseCsv('"never closed,a\nb');

    // Assert — everything after the quote is one field.
    expect(rows).toEqual([['never closed,a\nb']]);
  });
});

describe('parseCsv — trailing blank rows', () => {
  test('drops trailing fully-empty rows left by trailing newlines', () => {
    expect(parseCsv('a,b\n1,2\n\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('drops trailing rows that are only commas/whitespace', () => {
    expect(parseCsv('a,b\n1,2\n,,\n  ,  ')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('keeps interior blank rows (only the tail is trimmed)', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  test('an input of only blank lines parses to an empty matrix', () => {
    expect(parseCsv('\n\n\n')).toEqual([]);
  });
});

describe('parseCsv — unicode', () => {
  test('non-ASCII cell content passes through untouched', () => {
    // Arrange / Act — µg doses, degree signs, CJK, emoji.
    const rows = parseCsv('µ dose,"≥ 98%",5°C,日本語,🧪');

    // Assert
    expect(rows).toEqual([['µ dose', '≥ 98%', '5°C', '日本語', '🧪']]);
  });
});

describe('parseCsvRecords', () => {
  test('normalizes headers (trim + lower-case) and keys records by them', () => {
    // Arrange / Act
    const { headers, records } = parseCsvRecords('  SKU ,Price (USD)\nA-1,12.5');

    // Assert — "Price (USD)" → "price (usd)" per the doc contract.
    expect(headers).toEqual(['sku', 'price (usd)']);
    expect(records).toEqual([{ sku: 'A-1', 'price (usd)': '12.5' }]);
  });

  test('trims record cell values', () => {
    // Arrange / Act
    const { records } = parseCsvRecords('sku,name\n  A-1  ,  Alpha  ');

    // Assert
    expect(records[0]).toEqual({ sku: 'A-1', name: 'Alpha' });
  });

  test('a short row fills missing cells with empty strings', () => {
    // Arrange / Act — 3 headers, row has only 1 cell.
    const { records } = parseCsvRecords('a,b,c\nonly');

    // Assert — the ?? guard backfills '' so every header key exists.
    expect(records[0]).toEqual({ a: 'only', b: '', c: '' });
  });

  test('extra cells beyond the header count are dropped', () => {
    // Arrange / Act
    const { records } = parseCsvRecords('a,b\n1,2,3,4');

    // Assert
    expect(records[0]).toEqual({ a: '1', b: '2' });
  });

  test('empty input yields empty headers and records', () => {
    expect(parseCsvRecords('')).toEqual({ headers: [], records: [] });
  });

  test('a header-only sheet yields headers and zero records', () => {
    // Arrange / Act
    const { headers, records } = parseCsvRecords('sku,name\n');

    // Assert
    expect(headers).toEqual(['sku', 'name']);
    expect(records).toEqual([]);
  });

  test('duplicate headers collapse to one key with the LAST column winning', () => {
    // Arrange / Act — headers.forEach writes in order, so the later column
    // overwrites the earlier one under the shared key.
    const { records } = parseCsvRecords('sku,sku\nfirst,second');

    // Assert
    expect(records[0]).toEqual({ sku: 'second' });
  });
});

describe('round trip with exporters.toCsv', () => {
  interface Row { name: string; note: string; qty: number | null }
  const columns: Column<Row>[] = [
    { header: 'name', value: (r) => r.name },
    { header: 'note', value: (r) => r.note },
    { header: 'qty', value: (r) => r.qty, type: 'number' },
  ];

  test('every CSV-hostile value survives export → parse unchanged', () => {
    // Arrange — commas, quotes, newlines, CRLF, unicode, blanks.
    const rows: Row[] = [
      { name: 'plain', note: 'has,comma', qty: 5 },
      { name: 'quote "q"', note: 'line1\nline2', qty: null },
      { name: 'crlf\r\nsplit', note: 'µ ≥ 日本語 🧪', qty: 0 },
    ];

    // Act
    const parsed = parseCsv(toCsv(columns, rows));

    // Assert — header row + each field byte-identical.
    expect(parsed).toEqual([
      ['name', 'note', 'qty'],
      ['plain', 'has,comma', '5'],
      ['quote "q"', 'line1\nline2', ''],
      ['crlf\r\nsplit', 'µ ≥ 日本語 🧪', '0'],
    ]);
  });

  test('parseCsvRecords keys the exported sheet by its own headers', () => {
    // Arrange
    const rows: Row[] = [{ name: 'a', note: 'b', qty: 2 }];

    // Act
    const { records } = parseCsvRecords(toCsv(columns, rows));

    // Assert
    expect(records).toEqual([{ name: 'a', note: 'b', qty: '2' }]);
  });
});
