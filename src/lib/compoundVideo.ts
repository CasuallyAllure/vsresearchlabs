/**
 * compoundVideo — resolve a citation video for a compound.
 *
 * Looks up the product's own video fields first (the future admin-set
 * fields), then falls back to a small demo map keyed by slug. Returns
 * undefined when there's nothing to show, so the overlay's media slot
 * stays hidden.
 *
 * TikTok today (official embed → keeps the creator watermark + handle, so
 * it reads as a citation). Instagram Reels / YouTube Shorts can be added to
 * `parseEmbed` later with the same shape.
 */

import type { Product } from '../types';

export interface CompoundVideoMeta {
  url: string;
  /** Short headline for the poster (admin-editable later). */
  title?: string;
  /** 1–2 line "what this clip covers" blurb (admin-editable later). */
  description?: string;
}

/** Demo entries until the admin fields are wired. Keyed by product slug. */
const COMPOUND_VIDEOS: Record<string, CompoundVideoMeta> = {
  'mots-c': {
    url: 'https://www.tiktok.com/@kristisawicki/video/7615592662862712077',
    title: 'Firsthand MOTS-C account',
    description:
      'A creator shares their experience with MOTS-C and what the research suggests. Third-party clip, shown for reference.',
  },
};

/** The citation video for a product, if any. */
export function getCompoundVideo(product: Product): CompoundVideoMeta | undefined {
  const p = product as Product & {
    videoUrl?: string;
    videoTitle?: string;
    videoDescription?: string;
  };
  if (p.videoUrl) {
    return { url: p.videoUrl, title: p.videoTitle, description: p.videoDescription };
  }
  return COMPOUND_VIDEOS[product.slug];
}

export interface EmbedInfo {
  provider: 'tiktok';
  /** iframe src for the inline player. */
  embedSrc: string;
  /** Canonical URL to open on "watch". */
  watchUrl: string;
  /** Creator handle (e.g. "@kristisawicki") when present in the URL. */
  author?: string;
}

/** Parse a supported social URL into embed info. Returns null if unsupported. */
export function parseEmbed(url: string): EmbedInfo | null {
  const id = url.match(/\/video\/(\d+)/)?.[1];
  if (id) {
    const author = url.match(/@([\w.]+)/)?.[0];
    return {
      provider: 'tiktok',
      embedSrc: `https://www.tiktok.com/embed/v2/${id}`,
      watchUrl: url,
      author,
    };
  }
  return null;
}
