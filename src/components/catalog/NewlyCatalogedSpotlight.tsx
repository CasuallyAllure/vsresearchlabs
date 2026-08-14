/**
 * NewlyCatalogedSpotlight — the "recently added to the catalog" hero slide
 * that sits alongside BundleOfferTile in the featured-supply carousel.
 *
 * Thin wrapper around <ProductSpotlightSlide>, configured for whatever the
 * newest catalog addition is. All layout, gating, pricing, and add-to-cart
 * behavior live in ProductSpotlightSlide so this and the other spotlight
 * slides share one implementation instead of forking it.
 *
 * To feature a different compound here, change the three constants below —
 * the slug's dose must be a real tracked variant or the slide renders
 * nothing (ProductSpotlightSlide hides on an unresolved dose).
 */

import type { Product } from '../../types';
import { ProductSpotlightSlide } from './ProductSpotlightSlide';

/** The single most-recently-cataloged compound this slide features. */
const FEATURED_SLUG = 'tzp-oral-500mcg';
const FEATURED_DOSE = '500mcg';

/** Hero render — the canister on the same grey studio set as the vial
 *  photography, so the slide matches the rest of the carousel. */
const FEATURED_IMAGE = '/vials/tzp-oral-500mcg.webp';

const DESCRIPTION =
  'Oral research units — 500 mcg per unit, 25 units per sealed canister — newly added to the catalog for incretin receptor research models.';

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
      heroImage={FEATURED_IMAGE}
      eyebrow="Newly cataloged"
      description={DESCRIPTION}
      badge="availability"
      onInspect={onInspect}
      className={className}
    />
  );
}
