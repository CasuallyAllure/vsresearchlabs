/**
 * compoundShare — the ONE slug ⇄ compound resolver behind shareable
 * compound deep links.
 *
 * The compound record is an overlay (CompoundIntelligenceOverlay), not a
 * route, so it has no URL of its own. This module gives it one:
 *
 *     /c/<slug>        e.g.  /c/bpc157-5mg
 *
 * Every surface that opens the overlay (catalog rows, supply-page tiles,
 * the landing hero spotlight, the bundle + inventory modals, the product
 * page dossier) shares this resolver, so a link built on one surface
 * resolves identically on every other one.
 *
 * Consumers:
 *   - useCompoundShareRoute  → pushes the URL while the overlay is open
 *   - ShareCompoundButton    → copies / shares the canonical URL
 *   - pages/CompoundShare    → resolves an incoming /c/<slug> back to a Product
 *   - scripts/buildCompoundShareRoutes.mjs → bakes per-slug Open Graph HTML
 *     (that script re-implements only `shareDescription`'s wording, because
 *     it runs in Node against the raw JSON — keep the two in sync)
 */

import type { Product } from '../types';
import { siteConfig } from '../config';

/** Route prefix. Registered in App.tsx as `/c/:slug`. */
export const COMPOUND_SHARE_PREFIX = '/c';

/** Canonical origin for links that leave the browser (share sheet, clipboard). */
export const SHARE_ORIGIN = `https://${siteConfig.contact.officialHost}`;

/** Matches any path under the compound-share prefix. */
export function isCompoundSharePath(pathname: string): boolean {
  return pathname === COMPOUND_SHARE_PREFIX || pathname.startsWith(`${COMPOUND_SHARE_PREFIX}/`);
}

/** Site-relative path for a compound's shareable record. */
export function compoundSharePath(product: Pick<Product, 'slug'>): string {
  return `${COMPOUND_SHARE_PREFIX}/${encodeURIComponent(product.slug)}`;
}

/**
 * Absolute, canonical URL for a compound's record.
 *
 * Always the production host rather than `window.location.origin`: a link
 * copied from a preview build or a localhost session must still be the link
 * that works when it is pasted somewhere else.
 */
export function compoundShareUrl(product: Pick<Product, 'slug'>): string {
  return `${SHARE_ORIGIN}${compoundSharePath(product)}`;
}

/** Longest description we put in a share sheet / meta tag before trimming. */
const DESCRIPTION_MAX = 165;

/**
 * Research-use-framed blurb for share sheets and Open Graph descriptions.
 * The compound's own catalog description, trimmed, with the RUO boundary
 * appended — never a therapeutic or outcome claim.
 */
export function shareDescription(product: Pick<Product, 'shortDescription'>): string {
  const raw = (product.shortDescription ?? '').trim();
  const trimmed = raw.length > DESCRIPTION_MAX
    ? `${raw.slice(0, DESCRIPTION_MAX).trimEnd().replace(/[,;:.]$/, '')}…`
    : raw;
  const boundary = siteConfig.compliance.fullLine;
  return trimmed ? `${trimmed} ${boundary}.` : `${boundary}.`;
}

/** Share-sheet / document title for a compound record. */
export function shareTitle(product: Pick<Product, 'name'>): string {
  return `${product.name} — ${siteConfig.brand.name}`;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve a URL segment back to a product.
 *
 * Tried in order: `slug` (what we mint), then `id` and `sku` so links that
 * were built by hand — or by an older surface that only had the id — still
 * land on the right record. Returns null for anything unknown; callers fall
 * back to the catalog rather than erroring.
 */
export function resolveCompoundSlug(
  products: readonly Product[],
  slug: string | undefined,
): Product | null {
  if (!slug) return null;
  const key = normalizeKey(slug);
  if (!key) return null;
  return (
    products.find((p) => normalizeKey(p.slug) === key) ??
    products.find((p) => normalizeKey(p.id) === key) ??
    products.find((p) => normalizeKey(p.sku) === key) ??
    null
  );
}
