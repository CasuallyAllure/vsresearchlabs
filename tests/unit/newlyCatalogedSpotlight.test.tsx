// @vitest-environment happy-dom
/**
 * The "newly cataloged" spotlight may not assert availability — or add a
 * priced line — it cannot back up.
 *
 * The load-bearing properties:
 *   - The "24 Hour Shipping" chip is a claim about physical inventory, and it
 *     may only appear when the runtime override store (`lib/productOverrides`)
 *     actually carries on-hand/inbound supply for that exact (sku, dose).
 *     Every other state — sourced, untracked, unloaded, failed-to-load — must
 *     degrade to no claim at all rather than a false one.
 *   - No price is ever displayed on this slide.
 *   - "Add to inquiry" only adds a real, positively-priced GLOW line.
 *
 * The store is a Zustand singleton, so each test seeds `variantBySku` /
 * `bySku` in Arrange and resets between tests.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { NewlyCatalogedSpotlight } from '../../src/components/catalog/NewlyCatalogedSpotlight';
import { FeaturedSupplyCarousel } from '../../src/components/catalog/FeaturedSupplyCarousel';
import { BundleOfferTile } from '../../src/components/catalog/BundleOfferTile';
import { useCart } from '../../src/hooks/useCart';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { BUNDLE_FEATURED, BUNDLE_PROMO } from '../../src/lib/bundle';
import type { Product } from '../../src/types/product';

const GLOW_SKU = 'VSR-RS-GLWC';
const GLOW_DOSE = '70mg';

function makeProduct(slug: string, sku: string, name: string, dose: string): Product {
  return {
    id: `rs-${slug}`,
    slug,
    name,
    category: 'biopeptide-research-supplies',
    shortDescription: 'Research-grade lyophilized blend.',
    longDescription: 'Research-grade lyophilized blend.',
    images: [`/vials/${slug}.webp`],
    specs: [],
    sku,
    variants: [{ dose }],
    priceCents: null,
    stock: null,
    tags: [],
    featured: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  } as unknown as Product;
}

const GLOW = makeProduct('glow-blend-cu', GLOW_SKU, 'GLOW Blend (BPC-157 · GHK-Cu · TB-500)', GLOW_DOSE);
const KLOW = makeProduct(
  'klow-blend',
  'VSR-RS-KLOW',
  'KLOW Blend (GHK-Cu · TB-500 · BPC-157 · KPV)',
  '80mg',
);

function makeVariant(sku: string, dose: string, patch: Partial<VariantOverride> = {}): VariantOverride {
  return {
    sku,
    dose,
    on_hand: 0,
    inbound_units: 0,
    price_cents: 12000,
    lead_days: 7,
    hidden: false,
    ...patch,
  };
}

/** Seed a cleanly-loaded override store with the given per-dose rows. */
function seedOverrides(rows: VariantOverride[]) {
  const variantBySku: Record<string, Record<string, VariantOverride>> = {};
  for (const row of rows) (variantBySku[row.sku] ??= {})[row.dose] = row;
  useProductOverrides.setState({ bySku: {}, variantBySku, loaded: true, loading: false, error: null });
}

afterEach(() => {
  cleanup();
  useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: false, loading: false, error: null });
  useCart.setState({ items: [], coupons: [] });
});

describe('NewlyCatalogedSpotlight availability', () => {
  test('states 24-hour dispatch only when the override store carries on-hand supply', () => {
    // Arrange
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 6 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    // Assert
    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('counts in-transit inbound units as 24-hour supply, same as the catalog', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 0, inbound_units: 4 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('omits the 24-hour claim for a compound with no on-hand or inbound supply', () => {
    // Arrange — tracked and orderable, but nothing on the shelf.
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 0, inbound_units: 0 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    // Assert — the compound still lists, but on the honest sourced tier.
    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
    expect(screen.getByText('Standard Shipping')).toBeTruthy();
    expect(screen.getByText('GLOW Blend')).toBeTruthy();
  });

  test('drops the slide when the featured dose the catalog hides', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { hidden: true, on_hand: 5 })]);

    const { container } = render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });

  test('renders nothing while the inventory source has not loaded cleanly', () => {
    // Arrange — the fetch resolved, but it failed.
    useProductOverrides.setState({
      bySku: {},
      variantBySku: { [GLOW_SKU]: { [GLOW_DOSE]: makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 9 }) } },
      loaded: true,
      loading: false,
      error: 'network down',
    });

    const { container } = render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });

  test('renders nothing when the featured compound is not in the catalog', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5 })]);

    const { container } = render(<NewlyCatalogedSpotlight products={[]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });
});

describe('NewlyCatalogedSpotlight — GLOW hero slide', () => {
  test('renders the GLOW hero with its constituents and no KLOW row', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW, KLOW]} onInspect={vi.fn()} />);

    expect(screen.getByText('GLOW Blend')).toBeTruthy();
    expect(screen.getByText('BPC-157 · GHK-Cu · TB-500')).toBeTruthy();
    expect(screen.queryByText('KLOW Blend')).toBeNull();
  });

  test('never displays a price on the GLOW slide', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5, price_cents: 24500 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(screen.queryByText(/\$/)).toBeNull();
  });

  test('opens the intelligence overlay when the hero image is tapped', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5 })]);
    const onInspect = vi.fn();

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole('button', { name: `Inspect ${GLOW.name}` }));

    expect(onInspect).toHaveBeenCalledWith(GLOW.id);
  });

  test('clicking "Add to inquiry" adds the GLOW 70mg variant to the cart at a real price', () => {
    // Arrange — a genuine per-dose price, so the add is $0-safe.
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5, price_cents: 24500 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Add GLOW Blend (BPC-157 · GHK-Cu · TB-500) 70mg to inquiry' }));

    // Assert — cart holds one line, priced, not $0.
    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].product.priceCents).toBe(24500);
    expect(screen.getByText('✓ Added')).toBeTruthy();
  });

  test('falls back to inspect (never adds a $0 line) when no dose price resolves', () => {
    // Arrange — a dose string that doesn't parse as an "Nmg" magnitude (so
    // lib/pricing's formula fallback can't manufacture a placeholder price
    // either) and no product.priceCents — effectiveTierPriceCents resolves
    // null. No override row is seeded for this sku, so isVariantPublic
    // defaults to visible (an untouched SKU), letting the slide render with
    // an unpriced dose to exercise the guard.
    const glowNoPrice = makeProduct(
      'glow-blend-cu',
      GLOW_SKU,
      'GLOW Blend (BPC-157 · GHK-Cu · TB-500)',
      'sample vial',
    );
    const onInspect = vi.fn();
    useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: true, loading: false, error: null });

    render(<NewlyCatalogedSpotlight products={[glowNoPrice]} onInspect={onInspect} />);

    // Act
    fireEvent.click(
      screen.getByRole('button', { name: 'Add GLOW Blend (BPC-157 · GHK-Cu · TB-500) sample vial to inquiry' }),
    );

    // Assert — no cart line was added; the button routed to inspect instead.
    expect(useCart.getState().items).toHaveLength(0);
    expect(onInspect).toHaveBeenCalledWith(glowNoPrice.id);
  });
});

describe('FeaturedSupplyCarousel', () => {
  test('renders one dot per non-null slide and none for a null child', () => {
    render(
      <FeaturedSupplyCarousel label="Featured supply" slideLabels={['One', 'Two']}>
        <div>slide one</div>
        <div>slide two</div>
        {null}
      </FeaturedSupplyCarousel>,
    );

    const dots = screen.getAllByRole('button', { name: /Go to slide/ });
    expect(dots).toHaveLength(2);
  });

  test('marks the active dot with aria-current', () => {
    render(
      <FeaturedSupplyCarousel label="Featured supply" slideLabels={['One', 'Two']}>
        <div>slide one</div>
        <div>slide two</div>
      </FeaturedSupplyCarousel>,
    );

    const dots = screen.getAllByRole('button', { name: /Go to slide/ });
    expect(dots[0].getAttribute('aria-current')).toBe('true');
    expect(dots[1].getAttribute('aria-current')).toBeNull();
  });

  test('renders no dots and no pause control for a single surviving slide', () => {
    render(
      <FeaturedSupplyCarousel label="Featured supply">
        <div>only slide</div>
        {null}
      </FeaturedSupplyCarousel>,
    );

    expect(screen.queryAllByRole('button', { name: /Go to slide/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /slideshow/ })).toBeNull();
  });

  test('renders nothing when every child is null', () => {
    const { container } = render(
      <FeaturedSupplyCarousel label="Featured supply">
        {null}
        {false}
      </FeaturedSupplyCarousel>,
    );

    expect(container.textContent).toBe('');
  });

  test('exposes a labelled carousel region', () => {
    render(
      <FeaturedSupplyCarousel label="Featured supply">
        <div>slide one</div>
        <div>slide two</div>
      </FeaturedSupplyCarousel>,
    );

    expect(screen.getByRole('region', { name: 'Featured supply' })).toBeTruthy();
  });

  test('offers an explicit pause/play toggle for the auto-advancing slides', () => {
    render(
      <FeaturedSupplyCarousel label="Featured supply">
        <div>slide one</div>
        <div>slide two</div>
      </FeaturedSupplyCarousel>,
    );

    const pauseButton = screen.getByRole('button', { name: 'Pause automatic slideshow' });
    fireEvent.click(pauseButton);
    expect(screen.getByRole('button', { name: 'Play automatic slideshow' })).toBeTruthy();
  });
});

describe('BundleOfferTile labelling', () => {
  test('states its "Paired supply" label once, as a heading', () => {
    // Arrange — real prices for the merchandised pair so the tile renders.
    seedOverrides([
      makeVariant(BUNDLE_PROMO.skuA, BUNDLE_FEATURED.doseA, { price_cents: 11000 }),
      makeVariant(BUNDLE_PROMO.skuB, BUNDLE_FEATURED.doseB, { price_cents: 22000 }),
    ]);

    const { container } = render(<BundleOfferTile />);

    // Act
    const labels = container.textContent?.match(/Paired supply/g) ?? [];

    // Assert
    expect(labels).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Paired supply' })).toBeTruthy();
  });
});
