/**
 * RouteMeta — keeps document.title and the robots directive in sync with
 * the route.
 *
 * SPA navigations don't change <title> on their own, which hurts SEO,
 * history/bookmarks, and just looks unfinished. This maps the current path
 * to a descriptive, brand-suffixed title. Renders nothing.
 *
 * It also manages a single <meta name="robots"> tag. Routes listed in
 * NOINDEX_PATHS get `noindex, nofollow`; every other route has the tag
 * removed entirely (absent = indexable, which is the correct default —
 * emitting `index` explicitly would be noise).
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { siteConfig } from '../config';
import { isCompoundSharePath } from '../lib/compoundShare';

const BRAND = siteConfig.brand.name;

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, siteConfig.seo.defaultTitle],
  [/^\/research-supplies\/biopeptide/, `Biopeptide Research Supplies — ${BRAND}`],
  [/^\/research-supplies\/nootropics/, `Nootropics Research Supplies — ${BRAND}`],
  [/^\/research-supplies\/skincare/, `Dermatological Research Compounds — ${BRAND}`],
  [/^\/research-supplies/, `Research Supplies — ${BRAND}`],
  [/^\/laboratory-equipment/, `Laboratory Equipment — ${BRAND}`],
  [/^\/research\b/, `Research Library — ${BRAND}`],
  [/^\/catalog/, `Catalog — ${BRAND}`],
  [/^\/product\//, `Compound Intelligence — ${BRAND}`],
  [/^\/cart/, `Inquiry Cart — ${BRAND}`],
  [/^\/contact/, `Contact — ${BRAND}`],
  [/^\/track/, `Track Order — ${BRAND}`],
  [/^\/documentation/, `Documentation — ${BRAND}`],
  [/^\/privacy/, `Privacy Policy — ${BRAND}`],
  [/^\/terms/, `Terms of Sale — ${BRAND}`],
  [/^\/shipping/, `Shipping & Fulfilment — ${BRAND}`],
  [/^\/about/, `About — ${BRAND}`],
  [/^\/admin/, `Admin Console — ${BRAND}`],
];

/**
 * Routes kept out of search indexes. `/documentation` and its detail pages
 * publish illustrative placeholder records rather than issued quality
 * documents; they must not be surfaced as our quality credentials until
 * the real archive exists.
 */
const NOINDEX_PATHS: RegExp[] = [/^\/documentation(\/|$)/];

const ROBOTS_SELECTOR = 'meta[name="robots"]';

/** Adds, updates, or removes the single robots meta tag. */
function setRobots(content: string | null): void {
  const existing = document.head.querySelector(ROBOTS_SELECTOR);
  if (content === null) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.head.appendChild(document.createElement('meta'));
  tag.setAttribute('name', 'robots');
  tag.setAttribute('content', content);
}

export function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    // /c/<slug> records name themselves: the prerendered share HTML ships the
    // compound title, and the overlay keeps it in sync as the visitor swipes
    // through the catalog. Overwriting it here would clobber both.
    if (!isCompoundSharePath(pathname)) {
      const match = TITLES.find(([re]) => re.test(pathname));
      document.title = match ? match[1] : BRAND;
    }

    const isNoindex = NOINDEX_PATHS.some((re) => re.test(pathname));
    setRobots(isNoindex ? 'noindex, nofollow' : null);
  }, [pathname]);
  return null;
}
