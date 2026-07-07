/**
 * Active client config — the ONLY place that decides which brand this
 * build renders. To stand up a new client site, add a profile under
 * ./clients/ (copy templates/client-config.example.ts) and point the
 * export below at it. Everything importing `siteConfig` follows.
 */

import { vsResearchLabsConfig } from './clients/vsresearchlabs';

export type { SiteConfig } from './types';

export const siteConfig = vsResearchLabsConfig;
