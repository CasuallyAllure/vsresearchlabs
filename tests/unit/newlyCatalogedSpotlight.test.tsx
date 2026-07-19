// @vitest-environment happy-dom
/**
 * The "newly cataloged" spotlight may not assert availability it cannot read.
 *
 * The load-bearing property: the "24 Hour Shipping" chip is a claim about
 * physical inventory, and it may only appear when the runtime override store
 * (`lib/productOverrides`) actually carries on-hand/inbound supply for that
 * exact (sku, dose). Every other state — sourced, untracked, unloaded,
 * failed-to-load — must degrade to no claim at all rather than a false one.
 *
 * The store is a Zustand singleton, so each test seeds `variantBySku` /
 * `bySku` in Arrange and resets between tests.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { NewlyCatalogedSpotlight } from '../../src/components/catalog/NewlyCatalogedSpotlight';
import { CatalogFeatureRow } from '../../src/components/catalog/CatalogFeatureRow';
import { BundleOfferTile } from '../../src/components/catalog/BundleOfferTile';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import { BUNDLE_FEATURED, BUNDLE_PROMO } from '../../src/lib/bundle';
import type { Product } from '../../src/types/product';

const GLOW_SKU = 'VSR-RS-GLOW';
const KLOW_SKU = 'VSR-RS-KLOW';

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

const GLOW = makeProduct('glow-blend-ghk', GLOW_SKU, 'GLOW Blend (TB-500 · BPC-157 · GHK)', '70mg');
const KLOW = makeProduct(
  'klow-blend',
  KLOW_SKU,
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
});

describe('NewlyCatalogedSpotlight availability', () => {
  test('states 24-hour dispatch only when the override store carries on-hand supply', () => {
    // Arrange
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 6 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    // Assert
    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('counts in-transit inbound units as 24-hour supply, same as the catalog', () => {
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 0, inbound_units: 4 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
  });

  test('omits the 24-hour claim for a compound with no on-hand or inbound supply', () => {
    // Arrange — tracked and orderable, but nothing on the shelf.
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 0, inbound_units: 0 })]);

    // Act
    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    // Assert — the compound still lists, but on the honest sourced tier.
    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
    expect(screen.getByText('Standard Shipping')).toBeTruthy();
    expect(screen.getByText('GLOW Blend')).toBeTruthy();
  });

  test('makes no dispatch claim at all for a compound with no per-dose row tracked', () => {
    // Arrange — KLOW is spotlighted, but only GLOW has inventory data.
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 3 })]);

    render(<NewlyCatalogedSpotlight products={[KLOW]} onInspect={vi.fn()} />);

    expect(screen.queryByText('24 Hour Shipping')).toBeNull();
    expect(screen.queryByText('Standard Shipping')).toBeNull();
  });

  test('drops a compound whose dose the catalog hides', () => {
    seedOverrides([
      makeVariant(GLOW_SKU, '70mg', { on_hand: 5 }),
      makeVariant(KLOW_SKU, '80mg', { hidden: true, on_hand: 5 }),
    ]);

    render(<NewlyCatalogedSpotlight products={[GLOW, KLOW]} onInspect={vi.fn()} />);

    expect(screen.getByText('GLOW Blend')).toBeTruthy();
    expect(screen.queryByText('KLOW Blend')).toBeNull();
  });

  test('renders nothing while the inventory source has not loaded cleanly', () => {
    // Arrange — the fetch resolved, but it failed.
    useProductOverrides.setState({
      bySku: {},
      variantBySku: { [GLOW_SKU]: { '70mg': makeVariant(GLOW_SKU, '70mg', { on_hand: 9 }) } },
      loaded: true,
      loading: false,
      error: 'network down',
    });

    const { container } = render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });

  test('renders nothing when none of the featured compounds are in the catalog', () => {
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 5 })]);

    const { container } = render(<NewlyCatalogedSpotlight products={[]} onInspect={vi.fn()} />);

    expect(container.textContent).toBe('');
  });
});

describe('NewlyCatalogedSpotlight interaction', () => {
  test('opens the intelligence overlay for the compound that was tapped', () => {
    // Arrange
    seedOverrides([
      makeVariant(GLOW_SKU, '70mg', { on_hand: 5 }),
      makeVariant(KLOW_SKU, '80mg', { on_hand: 5 }),
    ]);
    const onInspect = vi.fn();
    render(<NewlyCatalogedSpotlight products={[GLOW, KLOW]} onInspect={onInspect} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: `Inspect ${KLOW.name}` }));

    // Assert
    expect(onInspect).toHaveBeenCalledWith(KLOW.id);
  });

  test('offers no add-to-inquiry control, so no dose can be added without one', () => {
    seedOverrides([makeVariant(GLOW_SKU, '70mg', { on_hand: 5 })]);

    render(<NewlyCatalogedSpotlight products={[GLOW]} onInspect={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });
});

describe('CatalogFeatureRow', () => {
  test('exposes the mobile scroller as a labelled, keyboard-reachable region', () => {
    // Arrange / Act
    render(
      <CatalogFeatureRow label="Featured supply">
        <div>slide</div>
      </CatalogFeatureRow>,
    );

    // Assert
    const region = screen.getByRole('region', { name: 'Featured supply' });
    expect(region.getAttribute('tabindex')).toBe('0');
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
