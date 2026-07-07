/**
 * Client config template — copy to src/config/clients/<client>.ts and fill in.
 *
 * Then point src/config/index.ts at your new profile:
 *   import { acmeLabsConfig } from './clients/acmelabs';
 *   export const siteConfig = acmeLabsConfig;
 *
 * This file covers the TypeScript-readable surface only. The full new-client
 * checklist (assets, index.html, env vars, Supabase, legal prose, catalog)
 * lives in docs/CLIENT_BOOTSTRAP_CHECKLIST.md.
 *
 * NEVER put secrets here — API keys, service-role keys, and payment handles
 * belong in env vars (.env locally, Cloudflare Pages / Supabase secrets in prod).
 */

import type { SiteConfig } from '../src/config/types';

export const exampleClientConfig: SiteConfig = {
  brand: {
    // Full brand name — accessible labels, page titles, document headers.
    name: 'Acme Labs',
    // Short code for tight UI (admin header on phones).
    shortCode: 'ACME',
    // Text rendered next to the logo mark (may omit part carried by the mark).
    wordmark: 'Acme Labs',
    // Category/positioning strip under the wordmark.
    tagline: 'Category One · Category Two · Category Three',
    // Entity in the footer copyright line — confirm with the client's counsel.
    legalEntity: 'Acme Labs LLC',
    // "Operations" line on the Contact page (region/positioning).
    operationsLine: 'Regional Positioning Line',
    // Micro caption on the document stamp.
    stampCaption: 'Grade · Region · Locale',
  },

  seo: {
    // <title> for the home route. Other routes get "Section — {brand.name}".
    defaultTitle: 'Acme Labs — What The Business Sells',
  },

  contact: {
    // Public inquiry mailbox (display only — edge functions use env vars).
    inquiryEmail: 'inquiries@acmelabs.example',
    // Official domain shown in anti-phishing copy on the account page.
    officialHost: 'acmelabs.example',
  },

  compliance: {
    // Review EVERY line with the client — regulatory language is per-business.
    // If a line doesn't apply, use neutral copy; components render them as-is.
    footerLine: 'Compliance or positioning line for the footer',
    navLines: ['Nav drawer caption line one', 'line two'],
    stampLine: 'Document stamp disclaimer line',
    gateLine: 'Entry disclaimer gate line',
    documentLine: 'Sentence printed on invoices/tracking documents.',
    shortLine: 'Short header tag',
  },

  order: {
    // Codes stamped on inquiry/order records (client-facing paperwork).
    intakeChannel: 'ACME-WEB-PORTAL',
    processingNode: 'ACME-HQ-INTAKE',
    // Hint matching the server's order-number format on /track.
    trackingPlaceholder: 'ACM-ORD-… or your email',
  },

  storage: {
    // Namespaced per client so two sites on one browser never collide.
    // FROZEN after launch — changing a value wipes returning visitors' state.
    productsKey: 'acmelabs.products.v1',
    cartKey: 'acmelabs.cart.v1',
    themeKey: 'acme.theme', // must match the boot script in index.html
    disclaimerKey: 'acme_disclaimer_accepted_v1',
  },
};
