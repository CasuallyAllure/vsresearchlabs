/**
 * buildInventory — promote the biopeptide manifest into full products and
 * generate uniform specimen-plate imagery.
 *
 * Run:  node scripts/buildInventory.mjs   (or: npm run gen:inventory)
 *
 * Outputs (committed artifacts):
 *   1. public/specimens/<slug>.svg   — one uniform plate per NEW compound,
 *      plus regenerated plates for any existing biopeptide product whose
 *      referenced SVG is missing (the previously-broken 8).
 *   2. src/data/biopeptideCompounds.generated.json — full Product[] for the
 *      NEW canonical compounds, merged into the store seed by productStore.
 *
 * Fixed timestamps and stable ordering keep re-runs free of incidental churn,
 * but the output is NOT byte-identical to the committed artifacts: the
 * generated JSON has been hand-edited since it was last generated, so a run
 * reverts those edits. Diff before committing.
 *
 * Guard: the manifest is not the whole truth — records have been added to the
 * generated JSON by hand, and records have been deliberately retired from it.
 * A plain run silently reverts both (drops the hand-added, resurrects the
 * retired), and the record count can stay identical while it happens. So the
 * run refuses to write when the output would drop a slug that is currently
 * committed, or re-add a TOMBSTONED one.
 *
 *   node scripts/buildInventory.mjs --check   report ADD/DROP/MODIFY, write
 *                                             nothing, exit 1 if anything differs
 *   node scripts/buildInventory.mjs           write, but abort before touching
 *                                             any file if a drop/tombstone trips
 *   node scripts/buildInventory.mjs --allow-drops
 *                                             write anyway (tombstones still
 *                                             block); use when a removal is
 *                                             genuinely intended
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { META, LAYMAN, modelToKey, EXISTING } from './lib/compoundData.mjs';
import { INTELLIGENCE } from './lib/compoundIntelligence.mjs';
import { renderSpecimen } from './lib/specimenTemplate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPECIMENS_DIR = resolve(ROOT, 'public/specimens');
const MANIFEST = resolve(ROOT, 'src/data/biopeptideManifest.json');
const PRODUCTS = resolve(ROOT, 'src/data/products.json');
const OUT = resolve(ROOT, 'src/data/biopeptideCompounds.generated.json');

const STAMP = '2026-06-01T00:00:00.000Z';

const CHECK_ONLY = process.argv.includes('--check');
const ALLOW_DROPS = process.argv.includes('--allow-drops');

// Slugs deliberately retired from the catalogue. The manifest still carries
// rows for these, so every run tries to resurrect them — unpriced, which then
// falls through to the price formula and publishes an absurd number. Removing
// the manifest row is the real fix; until then this blocks the resurrection.
// Never add a slug here to silence a diff — only to record a decision.
const TOMBSTONED = new Set([
  '10-amino-1mq',
]);

const CLASSIFICATION_LABELS = {
  'incretin-metabolic-agonists': 'Incretin & Metabolic Receptor Agonists',
  'gh-secretagogue': 'GH Secretagogues',
  'growth-factor-anabolic': 'Growth Factors / Anabolic',
  'metabolic-cofactor': 'Metabolic Cofactors',
  'regenerative': 'Regenerative',
  'nootropic-neuroactive': 'Nootropic / Neuroactive',
  'bioregulator': 'Bioregulators',
  'immunomodulatory': 'Immunomodulatory',
  'reproductive-hormonal': 'Reproductive / Hormonal',
  'antioxidant-beauty': 'Antioxidant / Beauty',
};

// Compounds that are NOT peptides — omit productType:'peptide' to avoid a
// factually wrong label.
const NON_PEPTIDE = new Set([
  'nad-plus', 'aicar', 'l-carnitine', 'glutathione',
  '5-amino-1mq', '10-amino-1mq', 'mk-677', 'lipo-c', 'lemon-bottle',
]);

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── Dose helpers ────────────────────────────────────────────────────────
function uniq(arr) {
  return [...new Set(arr)];
}
function doseRangeLabel(specs) {
  if (specs.length === 1) {
    const s = specs[0];
    return /mg$/.test(s) ? `${s.replace(/mg$/, ' mg')} / vial` : `${s} / vial`;
  }
  // numeric min–max when the unit is consistent
  const nums = specs.map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
  const unitMatch = specs[0].match(/[a-zA-Z]+/);
  const unit = unitMatch ? unitMatch[0] : '';
  const sameUnit = specs.every((s) => (s.match(/[a-zA-Z]+/)?.[0] ?? '') === unit);
  if (nums.length === specs.length && sameUnit && unit) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const u = unit === 'iu' ? 'iu' : ` ${unit}`;
    return `${lo} – ${hi}${u} / vial`;
  }
  return `${specs[0]} – ${specs[specs.length - 1]} / vial`;
}

// ── Build canonical NEW compounds from the manifest ──────────────────────
const manifest = readJSON(MANIFEST);
const products = readJSON(PRODUCTS);

const grouped = new Map(); // key -> { specs:[], group }
const unclassified = new Set();

for (const row of manifest) {
  const key = modelToKey(row.model);
  if (key === null) { unclassified.add(row.model); continue; }
  if (typeof key !== 'string') continue; // EXISTING.* descriptor → skip
  if (!grouped.has(key)) grouped.set(key, { specs: [], group: row.group });
  grouped.get(key).specs.push(row.specification);
}

const keys = [...grouped.keys()].sort();
let specimenSeq = 100;

const generated = [];
const missingChem = [];
const builtSlugs = new Set();

// Every write is queued, not performed, so the guard below can abort the run
// before a single file is touched. flushWrites() is the only writer.
const pendingWrites = [];
const queueWrite = (path, contents) => pendingWrites.push({ path, contents });
const flushWrites = () => {
  for (const { path, contents } of pendingWrites) writeFileSync(path, contents);
};

for (const key of keys) {
  const meta = META[key];
  if (!meta) { console.warn(`! No META for key "${key}" — skipping`); continue; }
  const { specs, group } = grouped.get(key);
  const variants = uniq(specs).map((dose) => ({ dose }));
  const specimenId = `VS-RS-${String(specimenSeq++).padStart(3, '0')}`;
  const slug = key;
  const sku = `VSR-RS-${meta.abbr.toUpperCase()}`;
  const purity = meta.purity || (meta.blend ? '≥ 95%' : '≥ 98%');
  const isLiquid = !!meta.liquid;
  const classLabel = CLASSIFICATION_LABELS[group] || meta.family;
  const doseLabel = doseRangeLabel(uniq(specs));
  const massValue = doseLabel.replace(' / vial', '');
  const storageHuman = isLiquid ? '2–8°C, protect from light' : '−20°C, desiccated';

  if (!meta.cas || !meta.mw) {
    missingChem.push(`${meta.name} (${[!meta.cas && 'CAS', !meta.mw && 'MW'].filter(Boolean).join(' + ')})`);
  }

  // ── Specimen plate ──
  const svg = renderSpecimen({
    eyebrow: meta.eyebrow,
    specimenId,
    compoundName: meta.name,
    doseLabel,
    sku,
    purity,
    cas: meta.cas,
    mw: meta.mw,
    formLine: meta.blend ? 'PEPTIDE BLEND' : undefined,
    storageLine: isLiquid ? 'STORE 2–8°C · PROTECT LIGHT' : 'STORE −20°C · DESICCATED',
    classLine: classLabel.toUpperCase(),
    liquid: isLiquid,
  });
  queueWrite(resolve(SPECIMENS_DIR, `${slug}.svg`), svg);
  builtSlugs.add(slug);

  // ── Product record ──
  const specsArr = [];
  if (!isLiquid && !meta.blend) specsArr.push({ label: 'Purity (HPLC)', value: purity });
  specsArr.push({ label: 'Form', value: isLiquid ? 'Sterile solution' : (meta.blend ? 'Lyophilized blend' : 'Lyophilized powder') });
  specsArr.push({ label: isLiquid ? 'Volume' : 'Mass', value: massValue });
  specsArr.push({ label: 'Storage', value: storageHuman });

  const product = {
    id: `rs-${slug}`,
    slug,
    name: meta.name,
    category: 'biopeptide-research-supplies',
    shortDescription: `${meta.lead} ${isLiquid ? 'Supplied as a sterile solution.' : 'Lyophilized, research grade.'}`.slice(0, 200),
    laymanSummary: LAYMAN[key] || meta.lead,
    longDescription:
      `${meta.name} — ${meta.lead}\n\n` +
      `Supplied for laboratory and in-vitro research applications only. Each lot is tested for identity and purity and ships with documentation on request.\n\n` +
      `Not for human use. For research purposes only.`,
    images: [`/specimens/${slug}.svg`],
    specs: specsArr,
    sku,
    abbreviation: meta.abbr,
    family: meta.family,
    variants,
    priceCents: null,
    stock: null,
    tags: uniq([
      group,
      meta.blend ? 'blend' : (NON_PEPTIDE.has(key) ? 'compound' : 'peptide'),
      'research',
    ]).filter(Boolean),
    featured: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    manufacturer: 'VSR Synthesis · In-house',
    countryOfOrigin: 'United States',
    storageCondition: isLiquid ? '2–8°C, protect from light' : '−20°C, desiccated, light-protected',
    shelfLifeMonths: isLiquid ? 18 : 24,
    unitOfMeasure: 'vial',
    leadTimeDays: 7,
    testingStandard: 'HPLC VSR-QC-001 · USP <62>',
    shippingCondition: isLiquid ? 'Cold-chain, 2–8°C' : 'Dry ice required',
    researchClassification: group,
  };
  if (!NON_PEPTIDE.has(key) && !meta.blend) product.productType = 'peptide';
  if (meta.cas) product.casNumber = meta.cas;
  if (meta.mw) product.molecularWeight = meta.mw;

  // ── Compound intelligence (source-verified mechanism + studies) ──
  const intel = INTELLIGENCE[key];
  if (intel) {
    if (intel.mechanismSummary) product.mechanismSummary = intel.mechanismSummary;
    if (intel.receptorActivity) product.receptorActivity = intel.receptorActivity;
    if (intel.pathwaySummary) product.pathwaySummary = intel.pathwaySummary;
    if (intel.fdaStatus) product.fdaStatus = intel.fdaStatus;
    if (typeof intel.humanTrialsConfirmed === 'boolean') product.humanTrialsConfirmed = intel.humanTrialsConfirmed;
    if (Array.isArray(intel.knownStudies) && intel.knownStudies.length) product.knownStudies = intel.knownStudies;
  } else {
    console.warn(`! No INTELLIGENCE for key "${key}" — compound shipped without mechanism/studies`);
  }

  generated.push(product);
}

// ── Regenerate any MISSING specimen images referenced by existing
//    biopeptide products (the previously-broken 8). ──────────────────────
const SEP = [' — ', ' – ', ' - '];
function substanceOf(name) {
  for (const s of SEP) { const i = name.indexOf(s); if (i > -1) return name.slice(0, i).trim(); }
  return name;
}
// Regenerate EVERY existing vial plate (the rich peptides + bacteriostatic
// water) so the whole catalogue shares the upgraded template. Bespoke
// instrument drawings (balance, centrifuge, …) are left untouched.
let regenExisting = 0;
for (const p of products) {
  const img = p.images?.[0];
  if (!img || !img.startsWith('/specimens/')) continue;
  const isBio = p.category === 'biopeptide-research-supplies';
  const isBacWater = p.id === 'rs-bacteriostatic-water-30ml';
  if (!isBio && !isBacWater) continue;
  const file = resolve(ROOT, 'public', img.replace(/^\//, ''));
  const liquid = isBacWater || p.productType === 'solvent';
  const purity = p.specs?.find((s) => s.label === 'Purity (HPLC)')?.value || '≥ 98%';
  const mass = p.specs?.find((s) => s.label === 'Mass' || s.label === 'Volume')?.value || '';
  const classLabel = CLASSIFICATION_LABELS[p.researchClassification] || p.family;
  const svg = renderSpecimen({
    eyebrow: (p.family || classLabel).toUpperCase(),
    specimenId: `VS-RS-${p.abbreviation}`,
    compoundName: substanceOf(p.name),
    doseLabel: mass ? `${mass.replace(/\s*\/\s*vial/, '')} / vial` : `${p.variants?.[0]?.dose || ''} / vial`,
    sku: p.sku,
    purity,
    cas: p.casNumber,
    mw: p.molecularWeight,
    classLine: classLabel.toUpperCase(),
    liquid,
  });
  queueWrite(file, svg);
  regenExisting++;
}

const outJSON = JSON.stringify(generated, null, 2) + '\n';
queueWrite(OUT, outJSON);

// ── Guard: compare against the committed artifact before writing ──────────
const rel = (p) => p.replace(ROOT + '/', '');

const committed = existsSync(OUT) ? readJSON(OUT) : [];
const committedBySlug = new Map(committed.map((p) => [p.slug, p]));
const generatedBySlug = new Map(generated.map((p) => [p.slug, p]));

const drops = committed
  .filter((p) => !generatedBySlug.has(p.slug))
  .map((p) => `${p.slug} (${p.sku})`);
const adds = generated
  .filter((p) => !committedBySlug.has(p.slug))
  .map((p) => `${p.slug} (${p.sku})`);
const revives = generated.filter((p) => TOMBSTONED.has(p.slug)).map((p) => p.slug);
// Name the fields that differ — "49 records changed" tells an operator nothing
// about whether the change is churn or a lost hand-edit.
const changedFields = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

const modified = generated
  .filter((p) => committedBySlug.has(p.slug))
  .map((p) => ({ slug: p.slug, fields: changedFields(committedBySlug.get(p.slug), p) }))
  .filter((m) => m.fields.length)
  .map((m) => `${m.slug} → ${m.fields.join(', ')}`);

const report = (label, items) => {
  if (items.length) console.log(`\n${label} (${items.length}):\n${items.map((i) => `   · ${i}`).join('\n')}`);
};

if (CHECK_ONLY) {
  console.log(`\nDry run — nothing written. ${rel(OUT)}: ${committed.length} committed → ${generated.length} generated.`);
  report('WOULD DROP', drops);
  report('WOULD ADD', adds);
  report('WOULD MODIFY', modified);
  if (revives.length) report('WOULD REVIVE (tombstoned)', revives);
  const differs = drops.length || adds.length || modified.length;
  console.log(differs ? '\n✗ Output differs from the committed artifact.\n' : '\n✓ Output matches the committed artifact.\n');
  process.exit(differs ? 1 : 0);
}

if (revives.length) {
  console.error(`\n✗ Refusing to write: this run would resurrect ${revives.length} tombstoned compound(s):`);
  revives.forEach((s) => console.error(`   · ${s}`));
  console.error(`\nThese were retired on purpose. Remove the manifest rows that produce them,`);
  console.error(`or drop the slug from TOMBSTONED in ${rel(fileURLToPath(import.meta.url))} if the decision changed.\n`);
  process.exit(1);
}

if (drops.length && !ALLOW_DROPS) {
  console.error(`\n✗ Refusing to write: this run would drop ${drops.length} compound(s) present in ${rel(OUT)}:`);
  drops.forEach((d) => console.error(`   · ${d}`));
  console.error(`\nThese exist in the committed artifact but not in the manifest — they were almost`);
  console.error(`certainly added by hand, and this run would silently delete them (the record count`);
  console.error(`can stay the same while it happens). Add the manifest row + META entry to keep them,`);
  console.error(`or re-run with --allow-drops if the removal is intended.\n`);
  process.exit(1);
}

flushWrites();

console.log(`\n✓ Generated ${generated.length} new compound products → ${rel(OUT)}`);
if (drops.length) console.log(`⚠ Dropped ${drops.length} compound(s) via --allow-drops: ${drops.join(', ')}`);
console.log(`✓ Wrote ${builtSlugs.size} new specimen plates + regenerated ${regenExisting} existing vial plates`);
if (unclassified.size) {
  console.log(`\n⚠ Unclassified manifest models (skipped):`);
  [...unclassified].forEach((m) => console.log(`   · ${m}`));
}
if (missingChem.length) {
  console.log(`\nℹ Compounds shipped WITHOUT full chem facts (CAS/MW omitted — verify later):`);
  missingChem.forEach((m) => console.log(`   · ${m}`));
}
console.log('');
