// @vitest-environment happy-dom
/**
 * The single-product spotlight slides (GLOW via NewlyCatalogedSpotlight, and
 * any other product configured through the shared ProductSpotlightSlide) may
 * not assert availability or a price — or add a priced line — they cannot
 * back up.
 *
 * The load-bearing properties:
 *   - The "24 Hour Shipping" chip is a claim about physical inventory, and it
 *     may only appear when the runtime override store (`lib/productOverrides`)
 *     actually carries on-hand/inbound supply for that exact (sku, dose).
 *     Every other state — sourced, untracked, unloaded, failed-to-load — must
 *     degrade to no claim at all rather than a false one.
 *   - Price comes from `effectiveTierPriceCents` — never hardcoded — and only
 *     renders (and only enables a direct add) when it resolves to a real,
 *     positive number.
 *   - No fabricated compareAt/strikethrough price is ever shown on these
 *     single-product slides — only the genuine bundle tile shows one.
 *   - "Add to inquiry" only adds a real, positively-priced line.
 *   - The 'limited' badge mode is entirely data-driven off doseAvailability
 *     (+ on-hand for the low-stock case), never hardcoded.
 *
 * The store is a Zustand singleton, so each test seeds `variantBySku` /
 * `bySku` in Arrange and resets between tests.
 */
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

// The spotlight slide now renders a react-router <Link> ("Members" → /account),
// so every render needs a Router context, exactly as it has in the live app.
const render = (ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>, ...options });

import { NewlyCatalogedSpotlight } from '../../src/components/catalog/NewlyCatalogedSpotlight';
import { ProductSpotlightSlide } from '../../src/components/catalog/ProductSpotlightSlide';
import { FeaturedSupplyCarousel } from '../../src/components/catalog/FeaturedSupplyCarousel';
import { BundleOfferTile } from '../../src/components/catalog/BundleOfferTile';
import { useCart } from '../../src/hooks/useCart';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { BUNDLE_FEATURED, BUNDLE_PROMO } from '../../src/lib/bundle';
import type { Product } from '../../src/types/product';

const GLOW_SKU = 'VSR-RS-GLWC';
const GLOW_DOSE = '70mg';
const KG_SKU = 'VSR-RS-GSK';
const KG_DOSE = '1200mg';

function makeProduct(
  slug: string,
  sku: string,
  name: string,
  dose: string,
  priceCents: number | null = null,
): Product {
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
    priceCents,
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
const KOREAN_GLUTATHIONE = makeProduct('korean-glutathione', KG_SKU, 'Korean Glutathione', KG_DOSE);

// The compound NewlyCatalogedSpotlight currently features. Its dose carries no
// "mg" magnitude, so lib/pricing's formula fallback cannot manufacture a
// placeholder — the price has to come from product.priceCents, exactly as it
// does in the catalog.
const TZO_SKU = 'VSR-RS-TZO-025';
const TZO_DOSE = '500mcg';
const TZP_ORAL = makeProduct('tzp-oral-500mcg', TZO_SKU, 'TZP Oral', TZO_DOSE, 10_000);

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
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 6 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    // Assert
    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('counts in-transit inbound units as 24-hour supply, same as the catalog', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 0, inbound_units: 4 })]);

    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('omits the 24-hour claim for a compound with no on-hand or inbound supply', () => {
    // Arrange — tracked and orderable, but nothing on the shelf.
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 0, inbound_units: 0 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    // Assert — the compound still lists, but on the honest sourced tier.
    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
    expect(screen.getByText('Standard Shipping')).toBeTruthy();
    expect(screen.getByText('TZP Oral')).toBeTruthy();
  });

  test('drops the slide when the featured dose the catalog hides', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { hidden: true, on_hand: 5 })]);

    const { container } = render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });

  test('renders nothing while the inventory source has not loaded cleanly', () => {
    // Arrange — the fetch resolved, but it failed.
    useProductOverrides.setState({
      bySku: {},
      variantBySku: { [TZO_SKU]: { [TZO_DOSE]: makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 9 }) } },
      loaded: true,
      loading: false,
      error: 'network down',
    });

    const { container } = render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });

  test('renders nothing when the featured compound is not in the catalog', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 5 })]);

    const { container } = render(<NewlyCatalogedSpotlight products={[]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });
});

describe('NewlyCatalogedSpotlight — featured hero slide', () => {
  test('renders the featured hero and no other catalog row', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 5 })]);

    render(<NewlyCatalogedSpotlight products={[TZP_ORAL, KLOW]} onInspect={vi.fn()} />);

    expect(screen.getByText('TZP Oral')).toBeTruthy();
    expect(screen.queryByText('KLOW Blend')).toBeNull();
  });

  test('splits a blend name into title + constituents (GLOW, via the shared slide)', () => {
    seedOverrides([makeVariant(GLOW_SKU, GLOW_DOSE, { on_hand: 5 })]);

    render(
      <ProductSpotlightSlide
        products={[GLOW, KLOW]}
        slug="glow-blend-cu"
        dose={GLOW_DOSE}
        heroImage="/vials/glow-blend-pair.webp"
        eyebrow="Research blend"
        description="Test description."
        onInspect={vi.fn()}
      />,
    );

    expect(screen.getByText('GLOW Blend')).toBeTruthy();
    expect(screen.getByText('BPC-157 · GHK-Cu · TB-500 · 70mg')).toBeTruthy();
    expect(screen.queryByText('KLOW Blend')).toBeNull();
  });

  test('shows the GLOW slide price, resolved from effectiveTierPriceCents (never hardcoded)', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 5, price_cents: 24500 })]);

    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    // Assert — the live per-dose override price renders, and only once (no
    // fabricated compareAt/strikethrough companion price).
    expect(screen.getAllByText('$245')).toHaveLength(1);
  });

  test('hides the price when no dose price resolves', () => {
    // NewlyCatalogedSpotlight always configures dose="70mg" (which always
    // parses to a positive placeholder price), so this exercises the
    // shared ProductSpotlightSlide directly with a dose string that can't
    // resolve a price at all — no "mg" magnitude for the formula fallback,
    // and no product.priceCents.
    const glowNoPrice = makeProduct(
      'glow-blend-cu',
      TZO_SKU,
      'GLOW Blend (BPC-157 · GHK-Cu · TB-500)',
      'sample vial',
    );
    useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: true, loading: false, error: null });

    render(
      <ProductSpotlightSlide
        products={[glowNoPrice]}
        slug="glow-blend-cu"
        dose="sample vial"
        heroImage="/vials/glow-blend-pair.webp"
        eyebrow="Newly cataloged"
        description="Test description."
        onInspect={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^\$/)).toBeNull();
  });

  test('opens the intelligence overlay when the hero image is tapped', () => {
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 5 })]);
    const onInspect = vi.fn();

    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole('button', { name: `Inspect ${TZP_ORAL.name}` }));

    expect(onInspect).toHaveBeenCalledWith(TZP_ORAL.id);
  });

  test('clicking "Add to inquiry" adds the featured variant to the cart at a real price', () => {
    // Arrange — a genuine per-dose price, so the add is $0-safe.
    seedOverrides([makeVariant(TZO_SKU, TZO_DOSE, { on_hand: 5, price_cents: 24500 })]);

    render(<NewlyCatalogedSpotlight products={[TZP_ORAL]} onInspect={vi.fn()} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Add TZP Oral 500mcg to inquiry' }));

    // Assert — cart holds one line, priced, not $0, sku matches the feature.
    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].product.priceCents).toBe(24500);
    expect(items[0].product.sku).toBe(TZO_SKU);
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
      TZO_SKU,
      'GLOW Blend (BPC-157 · GHK-Cu · TB-500)',
      'sample vial',
    );
    const onInspect = vi.fn();
    useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: true, loading: false, error: null });

    render(
      <ProductSpotlightSlide
        products={[glowNoPrice]}
        slug="glow-blend-cu"
        dose="sample vial"
        heroImage="/vials/glow-blend-pair.webp"
        eyebrow="Newly cataloged"
        description="Test description."
        onInspect={onInspect}
      />,
    );

    // Act
    fireEvent.click(
      screen.getByRole('button', { name: 'Add GLOW Blend (BPC-157 · GHK-Cu · TB-500) sample vial to inquiry' }),
    );

    // Assert — no cart line was added; the button routed to inspect instead.
    expect(useCart.getState().items).toHaveLength(0);
    expect(onInspect).toHaveBeenCalledWith(glowNoPrice.id);
  });
});

describe('ProductSpotlightSlide — Korean Glutathione configuration', () => {
  const kgProps = {
    slug: 'korean-glutathione',
    dose: KG_DOSE,
    heroImage: '/vials/korean-glutathione-hero.webp',
    eyebrow: 'Antioxidant · Reduced form',
    description: 'Reduced-form L-glutathione, 1200 mg per vial.',
    badge: 'limited' as const,
  };

  test('renders the product name, dose, and price', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 20, price_cents: 8900 })]);

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(screen.getByText('Korean Glutathione')).toBeTruthy();
    expect(screen.getByText('1200mg')).toBeTruthy();
    expect(screen.getByText('$89')).toBeTruthy();
  });

  test('never shows a fabricated compareAt/strikethrough price', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 20, price_cents: 8900 })]);

    const { container } = render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(container.querySelector('.line-through')).toBeNull();
    // The two prices shown are the real normal price and the derived member
    // price (15% off, same rounding as checkout) — neither is a fabricated
    // strikethrough/compare-at. 8900 → 8900 − round(8900×0.15=1335) = 7565.
    expect(screen.getByText('$89')).toBeTruthy();
    expect(screen.getByText('$75.65')).toBeTruthy();
    expect(screen.getAllByText(/\$/)).toHaveLength(2);
  });

  test('limited badge: sourced (no on-hand/inbound supply) shows "Limited availability"', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 0, inbound_units: 0, price_cents: 8900 })]);

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(screen.getByText('Limited availability')).toBeTruthy();
    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
  });

  test('limited badge: in-stock with low on-hand still shows "Limited availability"', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 3, price_cents: 8900 })]);

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(screen.getByText('Limited availability')).toBeTruthy();
  });

  test('limited badge: in-stock with ample on-hand supply falls back to the normal 24hr badge', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 50, price_cents: 8900 })]);

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
    expect(screen.queryByText('Limited availability')).toBeNull();
  });

  test('limited badge: unknown (untracked SKU) renders no badge at all', () => {
    // No override rows exist for KG at all — a SKU untouched by any import.
    // isVariantPublic defaults to visible for an untouched SKU (so the slide
    // still renders), but doseAvailability resolves 'unknown' — the badge
    // must render nothing rather than fabricate a claim.
    useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: true, loading: false, error: null });

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(screen.getByText('Korean Glutathione')).toBeTruthy();
    expect(screen.queryByText('Limited availability')).toBeNull();
    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
    expect(screen.queryByText('Standard Shipping')).toBeNull();
  });

  test('clicking "Add to inquiry" adds the Korean Glutathione 1200mg variant at its real price', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 20, price_cents: 8900 })]);

    render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Korean Glutathione 1200mg to inquiry' }));

    const items = useCart.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].product.sku).toBe(KG_SKU);
    expect(items[0].product.priceCents).toBe(8900);
    expect(items[0].product.priceCents).toBeGreaterThan(0);
  });

  test('drops the slide when the featured dose the catalog hides', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { hidden: true, on_hand: 20, price_cents: 8900 })]);

    const { container } = render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(container.textContent).toBe('');
  });

  test('renders nothing when the featured compound is not in the catalog', () => {
    seedOverrides([makeVariant(KG_SKU, KG_DOSE, { on_hand: 20 })]);

    const { container } = render(
      <ProductSpotlightSlide products={[]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(container.textContent).toBe('');
  });

  test('renders nothing while the inventory source has not loaded cleanly', () => {
    useProductOverrides.setState({
      bySku: {},
      variantBySku: { [KG_SKU]: { [KG_DOSE]: makeVariant(KG_SKU, KG_DOSE, { on_hand: 20 }) } },
      loaded: true,
      loading: false,
      error: 'network down',
    });

    const { container } = render(
      <ProductSpotlightSlide products={[KOREAN_GLUTATHIONE]} onInspect={vi.fn()} {...kgProps} />,
    );

    expect(container.textContent).toBe('');
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
  test('states its "Paired supply" label once and opens a panel showing both compounds', () => {
    // Arrange — real prices for the merchandised pair so the tile renders.
    seedOverrides([
      makeVariant(BUNDLE_PROMO.skuA, BUNDLE_FEATURED.doseA, { price_cents: 11000 }),
      makeVariant(BUNDLE_PROMO.skuB, BUNDLE_FEATURED.doseB, { price_cents: 22000 }),
    ]);

    const { container } = render(<BundleOfferTile />);

    // The chip states the label exactly once. It's a styled span, not a
    // heading, because the slide's image is now a button (openable) and a
    // heading can't be nested inside a button.
    const labels = container.textContent?.match(/Paired supply/g) ?? [];
    expect(labels).toHaveLength(1);
    expect(screen.getByText('Paired supply')).toBeTruthy();

    // Not a dead picture, and never a single-compound dossier: clicking opens a
    // panel that makes clear you receive BOTH compounds — one vial of each,
    // each with its own full record.
    fireEvent.click(screen.getByRole('button', { name: /paired supply/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/one vial of each/i)).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: /view full record/i })).toHaveLength(2);
  });
});
