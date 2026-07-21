/**
 * Unit tests for src/lib/promoSettings.ts — the storefront's read-only view of
 * the Buy-2-Get-1-Free promo governance (migration 055).
 *
 * Pins: the zustand store degrades to pessimistic DEFAULTS (promo OFF) when
 * supabase is unconfigured, the query errors, or no row exists — the
 * storefront must never over-promise a promo the server won't honor. The
 * selector helpers (isB2G1Active / b2g1EndsLabel / b2g1TooltipContent) mirror
 * the place-order gate: enabled + not expired + SKU not excluded.
 *
 * The supabase seam is mocked (tests/setup.ts forbids live network).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.supabase;
  },
}));

import {
  b2g1EndsLabel,
  b2g1TooltipContent,
  isB2G1Active,
  usePromoSettings,
} from '../../src/lib/promoSettings';

/** Wire the seam to a deterministic promo_settings query chain. */
function mockPromoQuery(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  seam.supabase = { from };
  return { from, select, eq, maybeSingle };
}

const FUTURE_ISO = new Date(Date.now() + 86_400_000).toISOString();
const PAST_ISO = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  seam.supabase = null;
  // The store is a module-level singleton — reset it between tests.
  usePromoSettings.setState({
    b2g1Enabled: false,
    b2g1EndsAt: null,
    b2g1ExcludedSkus: [],
    loaded: false,
    loading: false,
  });
});

describe('usePromoSettings.reload', () => {
  test('settles to pessimistic defaults (promo off) when supabase is not configured', async () => {
    // Arrange — seam stays null.

    // Act
    await usePromoSettings.getState().reload();

    // Assert
    const s = usePromoSettings.getState();
    expect(s.b2g1Enabled).toBe(false);
    expect(s.b2g1EndsAt).toBeNull();
    expect(s.b2g1ExcludedSkus).toEqual([]);
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
  });

  test('maps a settings row onto the store (enabled, ends-at, excluded SKUs)', async () => {
    // Arrange
    const { from, select, eq } = mockPromoQuery({
      data: {
        b2g1_enabled: true,
        b2g1_ends_at: '2026-07-20T12:00:00Z',
        b2g1_excluded_skus: ['reta-10', 'ghk-cu'],
      },
      error: null,
    });

    // Act
    await usePromoSettings.getState().reload();

    // Assert — the state mirrors the row and the query hit the right table.
    const s = usePromoSettings.getState();
    expect(s.b2g1Enabled).toBe(true);
    expect(s.b2g1EndsAt).toBe('2026-07-20T12:00:00Z');
    expect(s.b2g1ExcludedSkus).toEqual(['reta-10', 'ghk-cu']);
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
    expect(from).toHaveBeenCalledWith('promo_settings');
    expect(select).toHaveBeenCalledWith('b2g1_enabled, b2g1_ends_at, b2g1_excluded_skus');
    expect(eq).toHaveBeenCalledWith('id', 1);
  });

  test('coerces null-ish row fields (no end date, no exclusions) to safe values', async () => {
    // Arrange
    mockPromoQuery({
      data: { b2g1_enabled: true, b2g1_ends_at: null, b2g1_excluded_skus: null },
      error: null,
    });

    // Act
    await usePromoSettings.getState().reload();

    // Assert
    const s = usePromoSettings.getState();
    expect(s.b2g1Enabled).toBe(true);
    expect(s.b2g1EndsAt).toBeNull();
    expect(s.b2g1ExcludedSkus).toEqual([]);
  });

  test('falls back to defaults when the query errors', async () => {
    // Arrange
    mockPromoQuery({ data: null, error: { message: 'relation does not exist' } });

    // Act
    await usePromoSettings.getState().reload();

    // Assert — never over-promise on error.
    const s = usePromoSettings.getState();
    expect(s.b2g1Enabled).toBe(false);
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
  });

  test('falls back to defaults when no settings row exists', async () => {
    // Arrange
    mockPromoQuery({ data: null, error: null });

    // Act
    await usePromoSettings.getState().reload();

    // Assert
    expect(usePromoSettings.getState().b2g1Enabled).toBe(false);
    expect(usePromoSettings.getState().loaded).toBe(true);
  });
});

describe('usePromoSettings.load', () => {
  test('performs the fetch once when the store is fresh', async () => {
    // Arrange
    const { from } = mockPromoQuery({ data: { b2g1_enabled: true }, error: null });

    // Act
    await usePromoSettings.getState().load();

    // Assert
    expect(from).toHaveBeenCalledTimes(1);
    expect(usePromoSettings.getState().b2g1Enabled).toBe(true);
  });

  test('is a no-op when already loaded', async () => {
    // Arrange
    const { from } = mockPromoQuery({ data: { b2g1_enabled: true }, error: null });
    usePromoSettings.setState({ loaded: true });

    // Act
    await usePromoSettings.getState().load();

    // Assert
    expect(from).not.toHaveBeenCalled();
  });

  test('is a no-op while a load is already in flight', async () => {
    // Arrange
    const { from } = mockPromoQuery({ data: { b2g1_enabled: true }, error: null });
    usePromoSettings.setState({ loading: true });

    // Act
    await usePromoSettings.getState().load();

    // Assert
    expect(from).not.toHaveBeenCalled();
  });
});

describe('isB2G1Active', () => {
  test('returns false while the promo is disabled', () => {
    // Arrange — defaults: disabled.

    // Act / Assert
    expect(isB2G1Active('reta-10')).toBe(false);
  });

  test('returns true when enabled with no end date and no exclusions', () => {
    // Arrange
    usePromoSettings.setState({ b2g1Enabled: true });

    // Act / Assert
    expect(isB2G1Active('reta-10')).toBe(true);
    expect(isB2G1Active()).toBe(true);
  });

  test('returns false once the end date has passed', () => {
    // Arrange
    usePromoSettings.setState({ b2g1Enabled: true, b2g1EndsAt: PAST_ISO });

    // Act / Assert
    expect(isB2G1Active('reta-10')).toBe(false);
  });

  test('returns true while the end date is still in the future', () => {
    // Arrange
    usePromoSettings.setState({ b2g1Enabled: true, b2g1EndsAt: FUTURE_ISO });

    // Act / Assert
    expect(isB2G1Active('reta-10')).toBe(true);
  });

  test('returns false for an excluded SKU but true for others', () => {
    // Arrange
    usePromoSettings.setState({ b2g1Enabled: true, b2g1ExcludedSkus: ['reta-10'] });

    // Act / Assert
    expect(isB2G1Active('reta-10')).toBe(false);
    expect(isB2G1Active('ghk-cu')).toBe(true);
  });
});

describe('b2g1EndsLabel', () => {
  test('returns an empty string when there is no end date', () => {
    // Arrange — defaults: null end date.

    // Act / Assert
    expect(b2g1EndsLabel()).toBe('');
  });

  test('returns an empty string for an unparseable end date', () => {
    // Arrange
    usePromoSettings.setState({ b2g1EndsAt: 'not-a-date' });

    // Act / Assert
    expect(b2g1EndsLabel()).toBe('');
  });

  test('formats a valid end date as an "effective through Mon D" suffix', () => {
    // Arrange — midday UTC so the local calendar day matches in US zones + UTC.
    usePromoSettings.setState({ b2g1EndsAt: '2026-07-20T12:00:00Z' });

    // Act / Assert
    expect(b2g1EndsLabel()).toBe(' Effective through Jul 20.');
  });
});

describe('b2g1TooltipContent', () => {
  test('returns null when the promo is not active for the SKU', () => {
    // Arrange — disabled.

    // Act / Assert
    expect(b2g1TooltipContent('reta-10')).toBeNull();
  });

  test('returns the full term blurb with the end-date label when the term is live', () => {
    // Arrange — freeze "now" the day before the fixed end date. The tooltip
    // gates on Date.now(), so a bare hardcoded future fixture is a time bomb
    // that starts failing the morning it lapses (it did, on 2026-07-20).
    // The end date itself stays fixed so the "Jul 20" label stays exact.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
    try {
      usePromoSettings.setState({ b2g1Enabled: true, b2g1EndsAt: '2026-07-20T12:00:00Z' });

      // Act
      const tooltip = b2g1TooltipContent('ghk-cu');

      // Assert
      expect(tooltip).toBe(
        'Standard-shipping volume term: order 3 units of an item and the third is supplied at no charge, applied at checkout. Effective through Jul 20.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
