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
 * Deterministic: uses fixed timestamps and stable ordering so re-runs
 * produce byte-identical output (no git churn).
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

const CLASSIFICATION_LABELS = {
  'glp1-appetite': 'GLP-1 & Appetite',
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
    compoundName: meta.name.toUpperCase(),
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
  writeFileSync(resolve(SPECIMENS_DIR, `${slug}.svg`), svg);
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
    compoundName: substanceOf(p.name).toUpperCase(),
    doseLabel: mass ? `${mass.replace(/\s*\/\s*vial/, '')} / vial` : `${p.variants?.[0]?.dose || ''} / vial`,
    sku: p.sku,
    purity,
    cas: p.casNumber,
    mw: p.molecularWeight,
    classLine: classLabel.toUpperCase(),
    liquid,
  });
  writeFileSync(file, svg);
  regenExisting++;
}

// ── Write generated products + report ────────────────────────────────────
writeFileSync(OUT, JSON.stringify(generated, null, 2) + '\n');

console.log(`\n✓ Generated ${generated.length} new compound products → ${OUT.replace(ROOT + '/', '')}`);
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
