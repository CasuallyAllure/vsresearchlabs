/**
 * buildCompoundShareRoutes — bakes per-compound Open Graph HTML for /c/<slug>.
 *
 * WHY: the site is a client-rendered SPA served as static assets by the
 * Cloudflare Worker (wrangler.jsonc → `assets`). Link unfurlers (iMessage,
 * Slack, Discord, X, Facebook) do not run JavaScript, so a shared compound
 * link would otherwise preview as the generic landing page.
 *
 * HOW: after `vite build`, this clones the built dist/index.html once per
 * compound and swaps the title / description / canonical / og / twitter tags
 * for that compound's, writing dist/c/<slug>.html. Cloudflare's asset router
 * (html_handling: auto-trailing-slash, the default) serves /c/<slug>.html at
 * the clean path /c/<slug> with no redirect, and every OTHER path — including
 * an unknown /c/<bogus> — still falls through to the SPA index.html via
 * `not_found_handling: single-page-application`.
 *
 * The cloned file keeps index.html's script/link tags verbatim, so the React
 * app boots exactly as it does anywhere else: DisclaimerGate first, then the
 * compound record. These files are share metadata, not a second renderer.
 *
 * Run: node scripts/buildCompoundShareRoutes.mjs   (wired into `npm run build`)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(DIST, 'c');

/** Must match src/lib/compoundShare.ts (SHARE_ORIGIN) and index.html canonical. */
const ORIGIN = 'https://vsresearchlabs.com';
const BRAND = 'VS Research Labs';
/** Must match siteConfig.compliance.fullLine. */
const RUO_LINE = 'For Research Purposes Only — Not for Human or Veterinary Use';
/** Must match DESCRIPTION_MAX in src/lib/compoundShare.ts. */
const DESCRIPTION_MAX = 165;
/** Vial renders are square masters. */
const IMAGE_SIZE = 1024;
const FALLBACK_IMAGE = '/brand/vs-dna-s-full-colour.png';

function shareDescription(shortDescription) {
  const raw = (shortDescription ?? '').trim();
  const trimmed = raw.length > DESCRIPTION_MAX
    ? `${raw.slice(0, DESCRIPTION_MAX).trimEnd().replace(/[,;:.]$/, '')}…`
    : raw;
  return trimmed ? `${trimmed} ${RUO_LINE}.` : `${RUO_LINE}.`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the `content` of a single meta tag, identified by its name/property.
 * Throws if the tag is missing — a silent no-op here would ship every share
 * link with the landing page's preview.
 */
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${escapeRegExp(key)}"\\s+content=")[^"]*(")`, 'i');
  if (!re.test(html)) {
    throw new Error(`dist/index.html has no <meta ${attr}="${key}"> — share metadata template drifted.`);
  }
  return html.replace(re, `$1${escapeAttr(value)}$2`);
}

function setTitle(html, value) {
  if (!/<title>[^<]*<\/title>/i.test(html)) {
    throw new Error('dist/index.html has no <title> — share metadata template drifted.');
  }
  return html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeText(value)}</title>`);
}

function setCanonical(html, value) {
  const re = /(<link\s+rel="canonical"\s+href=")[^"]*(")/i;
  if (!re.test(html)) {
    throw new Error('dist/index.html has no canonical link — share metadata template drifted.');
  }
  return html.replace(re, `$1${escapeAttr(value)}$2`);
}

function buildShareHtml(template, product) {
  const title = `${product.name} — ${BRAND}`;
  const description = shareDescription(product.shortDescription);
  const url = `${ORIGIN}/c/${product.slug}`;
  const localImage = product.images?.[0];
  const imagePath = localImage && existsSync(join(DIST, localImage.replace(/^\//, '')))
    ? localImage
    : FALLBACK_IMAGE;
  const image = `${ORIGIN}${imagePath}`;

  let html = setTitle(template, title);
  html = setMeta(html, 'name', 'description', description);
  html = setCanonical(html, url);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'property', 'og:image:width', IMAGE_SIZE);
  html = setMeta(html, 'property', 'og:image:height', IMAGE_SIZE);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  html = setMeta(html, 'name', 'twitter:image', image);
  return html;
}

async function main() {
  const templatePath = join(DIST, 'index.html');
  if (!existsSync(templatePath)) {
    throw new Error('dist/index.html not found — run `vite build` before this script.');
  }
  const template = await readFile(templatePath, 'utf8');

  // Same two sources productStore hydrates from, in the same order.
  const [seed, generated] = await Promise.all([
    readFile(join(ROOT, 'src/data/products.json'), 'utf8').then(JSON.parse),
    readFile(join(ROOT, 'src/data/biopeptideCompounds.generated.json'), 'utf8').then(JSON.parse),
  ]);

  const bySlug = new Map();
  for (const product of [...seed, ...generated]) {
    if (!product?.slug || !product?.name) continue;
    // First writer wins, matching the store's hand-authored-catalog-first merge.
    if (!bySlug.has(product.slug)) bySlug.set(product.slug, product);
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const [slug, product] of bySlug) {
    await writeFile(join(OUT_DIR, `${slug}.html`), buildShareHtml(template, product), 'utf8');
  }

  console.log(`[share-routes] wrote ${bySlug.size} compound share pages to dist/c/`);
}

main().catch((error) => {
  console.error(`[share-routes] ${error.message}`);
  process.exit(1);
});
