/**
 * AdminImport
 *
 * Bulk inventory import — the offline-to-live bridge.
 *
 *   1. Download a template pre-filled with EVERY catalog SKU and its current
 *      live values (stock, price, visibility, reorder point, and the cited
 *      clip fields). Open it in Excel / Numbers / Sheets.
 *   2. Fill in what you have. Blank cells are left untouched on import, so a
 *      half-finished sheet never wipes existing data.
 *   3. Save As → CSV (UTF-8) and upload it here. Each row is applied through
 *      the `import_inventory` RPC: stock is set absolutely (and logged as a
 *      movement), price/visibility/reorder are overridden, and a video_url
 *      attaches the cited clip exactly like MOTS-C — poster + lightbox, no
 *      redeploy.
 *
 * Reference columns (name, class) are ignored on import; only `sku` + the
 * editable fields matter. `sku` is the join key — it must match the catalog.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import productsData from '../../data/products.json';
import manifestData from '../../data/biopeptideManifest.json';
import type { Product } from '../../types';
import { AdminLayout } from './AdminLayout';
import { downloadXlsx, downloadCsv, stamp, type Column } from '../../lib/exporters';
import { parseCsvRecords } from '../../lib/csv';
import { useProductOverrides } from '../../lib/productOverrides';

const products = productsData as unknown as Product[];

interface ManifestRow {
  serial: number;
  abbreviation: string;
  model: string;
  group?: string;
  specification: string;
}
const manifest = manifestData as ManifestRow[];

interface StockRow {
  sku: string;
  on_hand: number;
  reorder_at: number | null;
  hidden: boolean;
  price_cents_override: number | null;
  video_url: string | null;
  video_title: string | null;
  video_description: string | null;
  video_thumbnail: string | null;
}

/** One row of the downloadable template (current live values pre-filled). */
interface TemplateRow {
  sku: string;
  name: string;
  klass: string;
  on_hand: number | null;
  price_usd: number | null;
  hidden: string;
  reorder_at: number | null;
  video_url: string;
  video_title: string;
  video_description: string;
  video_thumbnail: string;
}

/** The payload we send per row to import_inventory (only set keys included). */
interface ImportPayload {
  sku: string;
  on_hand?: string;
  price_cents?: string;
  hidden?: string;
  reorder_at?: string;
  video_url?: string;
  video_title?: string;
  video_description?: string;
  video_thumbnail?: string;
}

// ── Name / class lookups (best-effort, for the reference columns) ─────────────

function catalogMeta(sku: string): { name: string; klass: string } {
  const fromCatalog = products.find((p) => p.sku === sku);
  if (fromCatalog) {
    const klass =
      (fromCatalog as { family?: string; researchClassification?: string }).family ??
      (fromCatalog as { researchClassification?: string }).researchClassification ??
      fromCatalog.category ??
      '';
    return { name: fromCatalog.name, klass };
  }
  const stripped = sku.replace(/^VSR-RS-/, '');
  const m = manifest.find((row) => row.abbreviation.replace(/\s+/g, '') === stripped);
  if (m) return { name: `${m.model} — ${m.specification}`, klass: m.group ?? '' };
  return { name: sku, klass: '' };
}

function collectSkus(): string[] {
  const set = new Set<string>();
  for (const p of products) if (p.sku) set.add(p.sku);
  for (const row of manifest) set.add(`VSR-RS-${row.abbreviation.replace(/\s+/g, '')}`);
  return Array.from(set).sort();
}

// ── Template columns (headers are the exact import keys → clean round-trip) ────

const TEMPLATE_COLUMNS: Column<TemplateRow>[] = [
  { header: 'sku', value: (r) => r.sku },
  { header: 'name', value: (r) => r.name },
  { header: 'class', value: (r) => r.klass },
  { header: 'on_hand', value: (r) => r.on_hand, type: 'number' },
  { header: 'price_usd', value: (r) => r.price_usd, type: 'currency' },
  { header: 'hidden', value: (r) => r.hidden },
  { header: 'reorder_at', value: (r) => r.reorder_at, type: 'number' },
  { header: 'video_url', value: (r) => r.video_url },
  { header: 'video_title', value: (r) => r.video_title },
  { header: 'video_description', value: (r) => r.video_description },
  { header: 'video_thumbnail', value: (r) => r.video_thumbnail },
];

interface ParsedRow {
  sku: string;
  name: string;
  payload: ImportPayload;
  fields: string[]; // which editable fields are set
  error?: string;
}

interface ImportResult {
  applied: number;
  skipped: number;
  errors: { sku: string | null; message: string }[];
}

export function AdminImport() {
  const [stockBySku, setStockBySku] = useState<Record<string, StockRow> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const reloadOverrides = useProductOverrides((s) => s.reload);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoadError('Backend not configured.'); return; }
      const { data, error } = await supabase
        .from('product_stock')
        .select('sku, on_hand, reorder_at, hidden, price_cents_override, video_url, video_title, video_description, video_thumbnail');
      if (cancelled) return;
      if (error) { setLoadError(error.message); return; }
      const map: Record<string, StockRow> = {};
      for (const r of (data ?? []) as StockRow[]) map[r.sku] = r;
      setStockBySku(map);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Build the template rows: every catalog SKU, pre-filled with live values.
  const templateRows = useMemo<TemplateRow[]>(() => {
    const map = stockBySku ?? {};
    return collectSkus().map((sku) => {
      const s = map[sku];
      const { name, klass } = catalogMeta(sku);
      return {
        sku,
        name,
        klass,
        on_hand: s ? s.on_hand : null,
        price_usd: s && s.price_cents_override != null ? s.price_cents_override / 100 : null,
        hidden: s && s.hidden ? 'true' : '',
        reorder_at: s && s.reorder_at != null ? s.reorder_at : null,
        video_url: s?.video_url ?? '',
        video_title: s?.video_title ?? '',
        video_description: s?.video_description ?? '',
        video_thumbnail: s?.video_thumbnail ?? '',
      };
    });
  }, [stockBySku]);

  function downloadTemplate(kind: 'xlsx' | 'csv') {
    const fname = `vsr-inventory-${stamp(new Date())}`;
    if (kind === 'xlsx') downloadXlsx(fname, 'Inventory', TEMPLATE_COLUMNS, templateRows);
    else downloadCsv(fname, TEMPLATE_COLUMNS, templateRows);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onerror = () => setParseError('Could not read the file.');
    reader.onload = () => {
      try {
        const rows = mapRecords(String(reader.result ?? ''));
        setParsed(rows);
        if (rows.length === 0) setParseError('No data rows found. Is the header row present?');
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse the file.');
        setParsed(null);
      }
    };
    reader.readAsText(file);
  }

  async function apply() {
    if (!supabase || !parsed) return;
    const valid = parsed.filter((r) => !r.error && r.fields.length > 0);
    if (valid.length === 0) return;
    setApplying(true);
    setResult(null);
    const agg: ImportResult = { applied: 0, skipped: 0, errors: [] };
    const CHUNK = 100;
    setProgress({ done: 0, total: valid.length });
    for (let i = 0; i < valid.length; i += CHUNK) {
      const slice = valid.slice(i, i + CHUNK).map((r) => r.payload);
      const { data, error } = await supabase.rpc('import_inventory', { p_rows: slice });
      if (error) {
        agg.errors.push({ sku: null, message: error.message });
        break;
      }
      const res = data as ImportResult;
      agg.applied += res.applied ?? 0;
      agg.skipped += res.skipped ?? 0;
      if (Array.isArray(res.errors)) agg.errors.push(...res.errors);
      setProgress({ done: Math.min(i + CHUNK, valid.length), total: valid.length });
    }
    setApplying(false);
    setProgress(null);
    setResult(agg);
    // Reflect changes in the live catalog without a reload.
    await reloadOverrides();
  }

  const validCount = parsed?.filter((r) => !r.error && r.fields.length > 0).length ?? 0;
  const errorCount = parsed?.filter((r) => r.error).length ?? 0;

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">Inventory</p>
        <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Bulk </span>
          <span className="font-medium text-ink">import.</span>
        </h2>
      </header>

      {loadError && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{loadError}</p>}

      {/* Step 1 — template */}
      <section className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Step 1 · Get the sheet</p>
        <p className="text-[13px] leading-relaxed text-ink/75 mb-[var(--space-4)] max-w-[64ch]">
          Downloads with every catalog SKU and its current live values already filled in. Edit
          stock, price, visibility and the cited-clip fields, then save as CSV and upload below.
          Blank cells are left untouched — you only change what you fill in.
          {stockBySku === null && <span className="text-ink/40"> Loading current values…</span>}
        </p>
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <button type="button" onClick={() => downloadTemplate('xlsx')} disabled={stockBySku === null} className={primaryBtn}>
            Download Excel (.xlsx)
          </button>
          <button type="button" onClick={() => downloadTemplate('csv')} disabled={stockBySku === null} className={ghostBtn}>
            Download CSV
          </button>
          <span className="font-mono text-[11px] text-ink/40">{templateRows.length} SKUs</span>
        </div>
      </section>

      {/* Step 2 — upload */}
      <section className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Step 2 · Upload the filled CSV</p>
        <p className="text-[13px] leading-relaxed text-ink/70 mb-[var(--space-4)] max-w-[64ch]">
          In Excel: <span className="text-ink/90">File → Save As → CSV UTF-8</span>. Then drop it here for a
          preview before anything is written.
        </p>
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} className={ghostBtn}>
            Choose CSV file
          </button>
          {fileName && <span className="font-mono text-[11px] text-ink/55">{fileName}</span>}
        </div>
        {parseError && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{parseError}</p>}
      </section>

      {/* Step 3 — preview + apply */}
      {parsed && parsed.length > 0 && (
        <section className="research-surface-solid p-[var(--space-5)]">
          <div className="flex items-end justify-between gap-[var(--space-4)] flex-wrap mb-[var(--space-4)]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-2)]">Step 3 · Review &amp; apply</p>
              <p className="text-[13px] text-ink/75">
                <span className="text-ink font-medium">{validCount}</span> row{validCount === 1 ? '' : 's'} to apply
                {errorCount > 0 && <span className="text-red-400/85"> · {errorCount} with issues</span>}
              </p>
            </div>
            <button type="button" onClick={apply} disabled={applying || validCount === 0} className={primaryBtn}>
              {applying
                ? progress ? `Applying ${progress.done}/${progress.total}…` : 'Applying…'
                : `Apply ${validCount} row${validCount === 1 ? '' : 's'}`}
            </button>
          </div>

          {result && (
            <div className="mb-[var(--space-4)] rounded-sm border border-ink/[0.10] bg-base-700 p-[var(--space-4)]">
              <p className="text-[13px] text-ink">
                <span className="text-[#2E7D5B] font-medium">{result.applied} applied</span>
                {result.skipped > 0 && <span className="text-ink/55"> · {result.skipped} unchanged</span>}
                {result.errors.length > 0 && <span className="text-red-400/85"> · {result.errors.length} errors</span>}
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-[var(--space-2)] space-y-1 max-h-[160px] overflow-y-auto">
                  {result.errors.slice(0, 50).map((e, i) => (
                    <li key={i} className="font-mono text-[11px] text-red-400/80">{e.sku ?? '—'}: {e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-ink/[0.08] rounded-sm">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="sticky top-0 bg-base-800">
                <tr className="border-b border-ink/[0.10]">
                  <th className="py-[var(--space-2)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.18em] text-ink/45 font-normal">SKU</th>
                  <th className="py-[var(--space-2)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.18em] text-ink/45 font-normal">Product</th>
                  <th className="py-[var(--space-2)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.18em] text-ink/45 font-normal">Changes</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 300).map((r, i) => (
                  <tr key={i} className="border-b border-ink/[0.04]">
                    <td className="py-[var(--space-2)] pl-[var(--space-4)] pr-[var(--space-3)] font-mono text-[11px] text-holo-light/80 align-top">{r.sku || '—'}</td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-[12px] text-ink/75 align-top">{r.name}</td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] align-top">
                      {r.error ? (
                        <span className="text-[11px] text-red-400/85">{r.error}</span>
                      ) : r.fields.length === 0 ? (
                        <span className="text-[11px] text-ink/35">no change</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.fields.map((f) => (
                            <span key={f} className="inline-block rounded-[3px] bg-ink/[0.05] border border-ink/[0.10] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink/65">{f}</span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 300 && (
              <p className="py-[var(--space-2)] text-center text-[11px] text-ink/40">+{parsed.length - 300} more rows (all will be applied)</p>
            )}
          </div>
        </section>
      )}
    </AdminLayout>
  );
}

// ── CSV records → import payloads ─────────────────────────────────────────────

const KNOWN_SKUS = new Set(collectSkus());

function mapRecords(text: string): ParsedRow[] {
  const { headers, records } = parseCsvRecords(text);
  if (!headers.includes('sku')) {
    throw new Error('Missing a "sku" column. Use the downloaded template as your starting point.');
  }
  return records.map((rec) => {
    const sku = (rec['sku'] ?? '').trim();
    const { name } = sku ? catalogMeta(sku) : { name: '' };
    const payload: ImportPayload = { sku };
    const fields: string[] = [];
    let error: string | undefined;

    if (!sku) error = 'Missing SKU';
    else if (!KNOWN_SKUS.has(sku)) error = 'Unknown SKU (not in catalog)';

    const set = (key: keyof ImportPayload, val: string, label: string) => {
      const v = (val ?? '').trim();
      if (v === '') return;
      payload[key] = v;
      fields.push(label);
    };

    // price_usd → cents
    const priceRaw = (rec['price_usd'] ?? '').trim();
    if (priceRaw !== '') {
      const usd = parseFloat(priceRaw.replace(/[$,]/g, ''));
      if (Number.isFinite(usd) && usd >= 0) {
        payload.price_cents = String(Math.round(usd * 100));
        fields.push('price');
      } else if (!error) {
        error = `Bad price "${priceRaw}"`;
      }
    }

    set('on_hand', rec['on_hand'], 'on_hand');
    set('hidden', rec['hidden'], 'hidden');
    set('reorder_at', rec['reorder_at'], 'reorder_at');
    // Clip — record a single "clip" chip when a url is present.
    const url = (rec['video_url'] ?? '').trim();
    if (url !== '') {
      payload.video_url = url;
      payload.video_title = (rec['video_title'] ?? '').trim() || undefined;
      payload.video_description = (rec['video_description'] ?? '').trim() || undefined;
      payload.video_thumbnail = (rec['video_thumbnail'] ?? '').trim() || undefined;
      fields.push('clip');
    }

    return { sku, name, payload, fields, error };
  });
}

// ── styles ────────────────────────────────────────────────────────────────────

const primaryBtn =
  'rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const ghostBtn =
  'rounded-full border border-ink/15 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/75 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
