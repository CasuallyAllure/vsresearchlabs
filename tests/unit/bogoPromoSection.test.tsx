// @vitest-environment happy-dom
/**
 * Unit tests for the admin BOGO controls (src/pages/admin/BogoPromoSection).
 *
 * The properties under test are the ones the owner's launch day depends on:
 *
 *   - the kill switch is a ONE-TAP-PLUS-CONFIRM write: it goes through the
 *     `set_bogo_promo` RPC (never a direct promo_settings write) and needs no
 *     separate Save;
 *   - it carries the SAVED end date and exclusions through untouched, so
 *     killing the promo can never also commit half-finished edits sitting in
 *     the fields below;
 *   - confirmation runs through the injected in-app modal, never
 *     window.confirm (which silently no-ops on the owner's iPhone);
 *   - the badge reports what the STOREFRONT is doing — live / off / expired —
 *     off the server's clock;
 *   - the seeded exclusions are listed by name, so they can be confirmed;
 *   - an RPC failure is surfaced, never swallowed.
 *
 * The supabase seam is mocked (tests/setup.ts forbids live network) and the
 * promo store is seeded directly, so no fetch is involved.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.supabase;
  },
}));

import { BogoPromoSection } from '../../src/pages/admin/BogoPromoSection';
import { usePromoSettings } from '../../src/lib/promoSettings';

/** The launch window migration 084 seeds: through the end of Mon 2026-08-03. */
const ENDS_AT = '2026-08-04T07:00:00.000Z';
/** Two of the nine seeded carve-outs: one generated compound, one equipment. */
const SEEDED_EXCLUSIONS = ['VSR-RS-GSK', 'VSR-LE-BAL-220'];

interface SeedOptions {
  enabled?: boolean;
  endsAt?: string | null;
  excluded?: string[];
  /** The server's instant, in ms. Defaults to inside the launch window. */
  serverNow?: number;
}

function seedStore({
  enabled = true,
  endsAt = ENDS_AT,
  excluded = SEEDED_EXCLUSIONS,
  serverNow = Date.parse('2026-08-02T18:00:00.000Z'),
}: SeedOptions = {}) {
  usePromoSettings.setState({
    b2g1Enabled: false,
    b2g1EndsAt: null,
    b2g1ExcludedSkus: [],
    bogoEnabled: enabled,
    bogoEndsAt: endsAt,
    bogoExcludedSkus: excluded,
    serverNowMs: serverNow,
    fetchedAtMs: performance.now(),
    loaded: true,
    loading: false,
  });
}

/** A supabase double: an `rpc` recorder plus the read chain `reload()` uses. */
function mockSeam(rpcResult: { error: unknown } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 1,
      b2g1_enabled: false,
      b2g1_ends_at: null,
      b2g1_excluded_skus: [],
      bogo_enabled: false,
      bogo_ends_at: ENDS_AT,
      bogo_excluded_skus: SEEDED_EXCLUSIONS,
      server_now: '2026-08-02T18:00:05.000Z',
    },
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  seam.supabase = { rpc, from };
  return { rpc, from };
}

/** Auto-accepting stand-in for the admin ConfirmModal. */
function autoConfirm() {
  return vi.fn((_message: string, onConfirm: () => void) => onConfirm());
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  seedStore();
  mockSeam();
});

describe('BogoPromoSection — kill switch', () => {
  test('turns the promo off through the set_bogo_promo RPC on one confirm', async () => {
    // Arrange
    const { rpc } = mockSeam();
    const confirm = autoConfirm();
    render(<BogoPromoSection confirm={confirm} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /turn bogo off now/i }));

    // Assert
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('set_bogo_promo', {
      p_enabled: false,
      p_ends_at: ENDS_AT,
      p_excluded_skus: SEEDED_EXCLUSIONS,
    });
  });

  test('asks the in-app modal first and writes nothing until it is accepted', () => {
    // Arrange — a confirm that never calls back, i.e. the modal is still open.
    const { rpc } = mockSeam();
    const confirm = vi.fn();
    render(<BogoPromoSection confirm={confirm} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /turn bogo off now/i }));

    // Assert
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][2]).toBe(true); // danger styling
    expect(rpc).not.toHaveBeenCalled();
  });

  test('carries the SAVED exclusions, not unsaved draft edits', async () => {
    // Arrange
    const { rpc } = mockSeam();
    const confirm = autoConfirm();
    render(<BogoPromoSection confirm={confirm} />);
    // A draft edit the owner has NOT saved.
    fireEvent.click(screen.getByTitle(/Korean Glutathione/i));

    // Act
    fireEvent.click(screen.getByRole('button', { name: /turn bogo off now/i }));

    // Assert — the write still carries the saved list.
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1].p_excluded_skus).toEqual(SEEDED_EXCLUSIONS);
  });

  test('turns the promo back on without a confirmation step', async () => {
    // Arrange
    seedStore({ enabled: false });
    const { rpc } = mockSeam();
    const confirm = vi.fn();
    render(<BogoPromoSection confirm={confirm} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /turn bogo on/i }));

    // Assert
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0][1].p_enabled).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('surfaces an RPC failure instead of swallowing it', async () => {
    // Arrange
    mockSeam({ error: { message: 'Unauthorized: admin role required' } });
    render(<BogoPromoSection confirm={autoConfirm()} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: /turn bogo off now/i }));

    // Assert
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Unauthorized: admin role required');
  });
});

describe('BogoPromoSection — state readout', () => {
  test('reads LIVE inside the window', () => {
    render(<BogoPromoSection confirm={autoConfirm()} />);
    expect(screen.getByText('live')).toBeTruthy();
  });

  test('reads EXPIRED once the server clock is past the boundary', () => {
    seedStore({ serverNow: Date.parse('2026-08-05T00:00:00.000Z') });
    render(<BogoPromoSection confirm={autoConfirm()} />);
    expect(screen.getByText('expired')).toBeTruthy();
  });

  test('reads OFF when the switch is off, whatever the end date says', () => {
    seedStore({ enabled: false });
    render(<BogoPromoSection confirm={autoConfirm()} />);
    expect(screen.getByText('off')).toBeTruthy();
  });

  test('names the last live day in store time, not the exclusive bound', () => {
    render(<BogoPromoSection confirm={autoConfirm()} />);
    // The bound is Aug 4 00:00 Pacific; the promo's last day is Aug 3.
    expect(screen.getByDisplayValue('2026-08-03')).toBeTruthy();
  });
});

describe('BogoPromoSection — exclusions', () => {
  test('lists the seeded exclusions by name so they can be confirmed', () => {
    render(<BogoPromoSection confirm={autoConfirm()} />);
    // The chip carries both the product name and its sku.
    expect(screen.getByTitle(/Korean Glutathione/i)).toBeTruthy();
    expect(screen.getByTitle(/Analytical Balance/i)).toBeTruthy();
  });

  test('saving exclusions writes them through the RPC with the switch untouched', async () => {
    // Arrange
    const { rpc } = mockSeam();
    render(<BogoPromoSection confirm={autoConfirm()} />);
    fireEvent.click(screen.getByTitle(/Korean Glutathione/i)); // un-exclude

    // Act
    fireEvent.click(screen.getByRole('button', { name: /save date \+ exclusions/i }));

    // Assert
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('set_bogo_promo', {
      p_enabled: true,
      p_ends_at: ENDS_AT,
      p_excluded_skus: ['VSR-LE-BAL-220'],
    });
  });
});
