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
const FEATURED_SLUG = 'selank-nasal-spray';
const FEATURED_DOSE = '5mg/10mL';

/** Hero render — the spray bottle on the same grey studio set as the vial
 *  photography, so the slide matches the rest of the carousel. */
const FEATURED_IMAGE = '/vials/selank-nasal-spray.webp';

const DESCRIPTION =
  'A ready-to-use nasal spray — 5 mg of Selank in a 10 mL sterile solution — newly added to the catalog for anxiolytic and cognitive-modulation research models.';

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
