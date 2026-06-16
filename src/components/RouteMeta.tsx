/**
 * RouteMeta — keeps document.title in sync with the route.
 *
 * SPA navigations don't change <title> on their own, which hurts SEO,
 * history/bookmarks, and just looks unfinished. This maps the current path
 * to a descriptive, brand-suffixed title. Renders nothing.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const BRAND = 'VS Research Labs';

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, `${BRAND} — Research Peptides & Laboratory Supplies`],
  [/^\/research-supplies\/biopeptide/, `Biopeptide Research Supplies — ${BRAND}`],
  [/^\/research-supplies\/nootropics/, `Nootropics Research Supplies — ${BRAND}`],
  [/^\/research-supplies\/skincare/, `Skincare Research Supplies — ${BRAND}`],
  [/^\/research-supplies/, `Research Supplies — ${BRAND}`],
  [/^\/laboratory-equipment/, `Laboratory Equipment — ${BRAND}`],
  [/^\/research\b/, `Research Library — ${BRAND}`],
  [/^\/catalog/, `Catalog — ${BRAND}`],
  [/^\/product\//, `Compound Intelligence — ${BRAND}`],
  [/^\/cart/, `Inquiry Cart — ${BRAND}`],
  [/^\/contact/, `Contact — ${BRAND}`],
  [/^\/track/, `Track Order — ${BRAND}`],
  [/^\/documentation/, `Documentation — ${BRAND}`],
  [/^\/admin/, `Admin Console — ${BRAND}`],
];

export function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const match = TITLES.find(([re]) => re.test(pathname));
    document.title = match ? match[1] : BRAND;
  }, [pathname]);
  return null;
}
