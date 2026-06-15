/**
 * compoundVideo — resolve a citation video for a compound.
 *
 * Looks up the product's own `videoUrl` first (the future admin-set field),
 * then falls back to a small demo map keyed by slug. Returns undefined when
 * there's nothing to show, so the overlay's media slot stays hidden.
 *
 * Supports TikTok today (official embed → keeps the creator watermark +
 * handle, so it reads as a citation). Instagram Reels / YouTube Shorts can
 * be added to `parseEmbed` later with the same shape.
 */

import type { Product } from '../types';

/** Demo links until the admin field is wired. Keyed by product slug. */
const COMPOUND_VIDEOS: Record<string, string> = {
  'mots-c': 'https://www.tiktok.com/@kristisawicki/video/7615592662862712077',
};

/** The raw citation URL for a product, if any. */
export function getCompoundVideoUrl(product: Product): string | undefined {
  const own = (product as Product & { videoUrl?: string }).videoUrl;
  return own || COMPOUND_VIDEOS[product.slug];
}

export interface EmbedInfo {
  provider: 'tiktok';
  /** iframe src for the inline player. */
  embedSrc: string;
  /** Canonical URL to open on double-click / "watch" affordance. */
  watchUrl: string;
}

/** Parse a supported social URL into embed info. Returns null if unsupported. */
export function parseEmbed(url: string): EmbedInfo | null {
  const id = url.match(/\/video\/(\d+)/)?.[1];
  if (id) {
    return {
      provider: 'tiktok',
      embedSrc: `https://www.tiktok.com/embed/v2/${id}`,
      watchUrl: `https://www.tiktok.com/video/${id}`,
    };
  }
  return null;
}
