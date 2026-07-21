/**
 * NewlyCatalogedSpotlight — the "recently added to the catalog" hero slide
 * that sits alongside BundleOfferTile in the featured-supply carousel.
 *
 * Thin wrapper around <ProductSpotlightSlide>, configured for the GLOW Blend
 * (BPC-157 · GHK-Cu · TB-500, sku VSR-RS-GLWC). All layout, gating, pricing,
 * and add-to-cart behavior live in ProductSpotlightSlide so this and the
 * Korean Glutathione slide share one implementation instead of forking it.
 */

import type { Product } from '../../types';
import { ProductSpotlightSlide } from './ProductSpotlightSlide';

/** The single most-recently-cataloged compound this slide features. */
const FEATURED_SLUG = 'glow-blend-cu';
const FEATURED_DOSE = '70mg';

/** Hero render — the GLOW vial on the lab-glass set, matching the paired-
 *  supply slide's photographic treatment. */
const GLOW_IMAGE = '/vials/glow-blend-pair.webp';

const DESCRIPTION =
  'A single-vial research blend of three of the most-requested peptides — BPC-157, GHK-Cu, and TB-500 — newly added to the catalog for recovery and tissue-repair research models.';

interface NewlyCatalogedSpotlightProps {
  products: Product[];
  onInspect: (id: string) => void;
  /** Layout classes from the parent (width / snap / flex). */
  className?: string;
}

export function NewlyCatalogedSpotlight({
  products,
  onInspect,
  className = '',
}: NewlyCatalogedSpotlightProps) {
  return (
    <ProductSpotlightSlide
      products={products}
      slug={FEATURED_SLUG}
      dose={FEATURED_DOSE}
      heroImage={GLOW_IMAGE}
      eyebrow="Newly cataloged"
      description={DESCRIPTION}
      badge="availability"
      onInspect={onInspect}
      className={className}
    />
  );
}
