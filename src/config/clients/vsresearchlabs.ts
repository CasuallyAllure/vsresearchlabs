/**
 * VS Research Labs — the original branded implementation.
 *
 * Every value here is the exact string the site rendered before the
 * white-label extraction; changing one changes the live site. New clients
 * copy templates/client-config.example.ts instead of editing this file.
 */

import type { SiteConfig } from '../types';

export const vsResearchLabsConfig: SiteConfig = {
  brand: {
    name: 'VS Research Labs',
    shortCode: 'VSR',
    // The "VS" lives in the monogram mark, so the visible text reads
    // "Research Labs" while the accessible name stays the full brand name.
    wordmark: 'Research Labs',
    tagline: 'BioPeptide Sciences · Nootropics · Skin-Care',
    legalEntity: 'Velari Systems Research Labs',
    operationsLine: 'Northern California Biopeptide Sciences',
    stampCaption: 'Research-Grade · Bay Area · California',
  },

  seo: {
    defaultTitle: 'VS Research Labs — Research Peptides & Laboratory Supplies',
  },

  contact: {
    inquiryEmail: 'inquire@vsresearchlabs.com',
    officialHost: 'vsresearchlabs.com',
  },

  compliance: {
    footerLine: 'For Research Use Only — Not for human or veterinary consumption',
    navLines: ['For research use only', 'Not for human use'],
    stampLine: 'For Research Use Only · Not For Human Consumption',
    gateLine: 'For Research Use Only · Not For Human Use',
    documentLine:
      'All products are sold for laboratory research use only and are not for human consumption.',
    shortLine: 'For Research Purposes Only',
  },

  order: {
    intakeChannel: 'VSR-WEB-PORTAL',
    processingNode: 'VSR-HQ-INTAKE',
    trackingPlaceholder: 'VSR-ORD-… or your email',
  },

  storage: {
    productsKey: 'vsresearchlabs.products.v4',
    cartKey: 'vsresearchlabs.cart.v1',
    themeKey: 'vsr.theme', // must match the boot script in index.html
    // v2: acceptance is a structured JSON record (timestamp + declared
    // industry) instead of a bare ISO string. The key bump re-prompts every
    // visitor once so the industry declaration gets on record.
    disclaimerKey: 'vsrl_disclaimer_accepted_v2',
  },
};
