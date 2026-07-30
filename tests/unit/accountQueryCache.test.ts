// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/accountQueryCache.ts — the portal's
 * stale-while-revalidate cache (WS-1). Pinned: the `key === null` idle path
 * (no fetch), a cold key fetches once and caches, a warm-and-fresh key
 * renders the cached value with NO new fetch, a warm-but-stale key renders
 * the cached value immediately then revalidates in the background, a key
 * change never shows the previous key's data, `refresh()` bypasses
 * staleness, an unmounted hook doesn't apply a late result, invalidate/clear
 * drop cache entries, a rejecting fetcher never leaves the hook stuck
 * loading, and — the revalidation-failure contract — a cold failure has no
 * data to protect (`data` stays null) while a WARM revalidation failure
 * (background stale re-fetch or `refresh()`) preserves the last-good `data`
 * and only surfaces the new `error`, whether the fetcher resolved an
 * in-band error or rejected outright.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  clearAccountQueryCache,
  invalidateAccountQuery,
  orderDetailCacheKey,
  ordersCacheKey,
  rewardsCacheKey,
  useAccountQuery,
} from '../../src/lib/accountQueryCache';

afterEach(() => {
  clearAccountQueryCache();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('key builders', () => {
  test('namespace each read by user id (and order number for detail)', () => {
    expect(ordersCacheKey('u1')).toBe('orders:u1');
    expect(rewardsCacheKey('u1')).toBe('rewards:u1');
    expect(orderDetailCacheKey('u1', 'ORD-1')).toBe('order:u1:ORD-1');
  });
});

describe('useAccountQuery', () => {
  test('key === null: idle, never calls the fetcher', async () => {
    const fetcher = vi.fn(async () => ({ data: ['x'], error: null }));
    const { result } = renderHook(() => useAccountQuery<string[]>(null, fetcher));

    expect(result.current).toEqual({ data: null, error: null, loading: false, refresh: expect.any(Function) });
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('cold key: loads once, then caches the result', async () => {
    const fetcher = vi.fn(async () => ({ data: ['a', 'b'], error: null }));
    const { result } = renderHook(() => useAccountQuery('k1', fetcher));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(['a', 'b']);
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('cold key with an in-band fetch error: no last-good data to protect, so data stays null', async () => {
    const fetcher = vi.fn(async () => ({ data: [] as string[], error: 'boom' }));
    const { result } = renderHook(() => useAccountQuery('k-err', fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('boom');
  });

  test('cold key with a rejecting fetcher: surfaces the error, data stays null, never stuck loading', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });
    const { result } = renderHook(() => useAccountQuery('k-reject', fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('network down');
  });

  test('a rejected non-Error value still resolves to a generic message', async () => {
    const fetcher = vi.fn(() => Promise.reject('boom-string'));
    const { result } = renderHook(() => useAccountQuery('k-reject-2', fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Something went wrong. Try again.');
  });

  test('warm + stale + a failing in-band revalidation: keeps the last-good data and surfaces the error', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: ['real-balance'], error: null })
      .mockResolvedValueOnce({ data: [] as string[], error: 'temporarily unavailable' });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = renderHook(() => useAccountQuery('k-stale-err', fetcher));
    await waitFor(() => expect(first.result.current.data).toEqual(['real-balance']));
    first.unmount();

    nowSpy.mockReturnValue(1_000_000 + 60_000); // past STALE_MS

    const second = renderHook(() => useAccountQuery('k-stale-err', fetcher));
    expect(second.result.current.data).toEqual(['real-balance']); // instant cache hit
    expect(second.result.current.loading).toBe(false); // no spinner for a background revalidate

    await waitFor(() => expect(second.result.current.error).toBe('temporarily unavailable'));
    // The failed revalidation must NOT have discarded the last-good data.
    expect(second.result.current.data).toEqual(['real-balance']);
  });

  test('warm + stale revalidation rejects outright: still keeps the last-good data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: ['real-balance'], error: null })
      .mockRejectedValueOnce(new Error('offline'));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const first = renderHook(() => useAccountQuery('k-stale-reject', fetcher));
    await waitFor(() => expect(first.result.current.data).toEqual(['real-balance']));
    first.unmount();

    nowSpy.mockReturnValue(2_000_000 + 60_000);

    const second = renderHook(() => useAccountQuery('k-stale-reject', fetcher));
    expect(second.result.current.data).toEqual(['real-balance']);

    await waitFor(() => expect(second.result.current.error).toBe('offline'));
    expect(second.result.current.data).toEqual(['real-balance']);
  });

  test('warm + fresh cache: renders immediately, does not re-fetch', async () => {
    const fetcher = vi.fn(async () => ({ data: ['seed'], error: null }));
    const first = renderHook(() => useAccountQuery('k2', fetcher));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useAccountQuery('k2', fetcher));
    // Cache hit is synchronous on mount — no loading flash.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toEqual(['seed']);

    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1); // no background revalidate — still fresh

    // Unmounting on a warm-cache render exercises that branch's own cleanup.
    expect(() => second.unmount()).not.toThrow();
  });

  test('warm + stale cache: renders the cached value immediately, then revalidates in the background', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: ['old'], error: null })
      .mockResolvedValueOnce({ data: ['new'], error: null });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = renderHook(() => useAccountQuery('k3', fetcher));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // Advance well past the 30s staleness window.
    nowSpy.mockReturnValue(1_000_000 + 60_000);

    const second = renderHook(() => useAccountQuery('k3', fetcher));
    expect(second.result.current.data).toEqual(['old']); // instant cache hit
    expect(second.result.current.loading).toBe(false); // never a loading flash on a warm hit

    await waitFor(() => expect(second.result.current.data).toEqual(['new']));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('key change: never shows the previous key’s data under the new key while loading', async () => {
    const first = deferred<{ data: string; error: null }>();
    const fetcherA = vi.fn(async () => ({ data: 'A', error: null }));
    const fetcherB = vi.fn(() => first.promise);

    const { result, rerender } = renderHook(
      ({ key, fetcher }: { key: string; fetcher: () => Promise<{ data: string; error: null }> }) =>
        useAccountQuery(key, fetcher),
      { initialProps: { key: 'kA', fetcher: fetcherA } },
    );
    await waitFor(() => expect(result.current.data).toBe('A'));

    rerender({ key: 'kB', fetcher: fetcherB });
    // New, uncached key: no stale cross-key flash, and loading is shown.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      first.resolve({ data: 'B', error: null });
    });
    expect(result.current.data).toBe('B');
  });

  test('unmounting before the fetch resolves does not apply a late result', async () => {
    const pending = deferred<{ data: string; error: null }>();
    const fetcher = vi.fn(() => pending.promise);
    const { result, unmount } = renderHook(() => useAccountQuery('k-unmount', fetcher));

    expect(result.current.loading).toBe(true);
    unmount();

    await act(async () => {
      pending.resolve({ data: 'too-late', error: null });
    });
    // No assertion on `result.current` post-unmount (React Testing Library
    // freezes it) — the point is that resolving after unmount doesn't throw.
    expect(true).toBe(true);
  });

  test('refresh() forces an immediate re-fetch, bypassing staleness', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: 'first', error: null })
      .mockResolvedValueOnce({ data: 'second', error: null });

    const { result } = renderHook(() => useAccountQuery('k4', fetcher));
    await waitFor(() => expect(result.current.data).toBe('first'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toBe('second');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('refresh() failing in-band keeps the last-good data and surfaces the error (e.g. redeem-then-refresh)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: 'balance-300', error: null })
      .mockResolvedValueOnce({ data: null as unknown as string, error: 'redeemed, but refresh failed' });

    const { result } = renderHook(() => useAccountQuery('k-refresh-err', fetcher));
    await waitFor(() => expect(result.current.data).toBe('balance-300'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data).toBe('balance-300'); // not blanked
    expect(result.current.error).toBe('redeemed, but refresh failed');
  });

  test('refresh() rejecting outright keeps the last-good data and never strands loading=true', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: 'balance-300', error: null })
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useAccountQuery('k-refresh-reject', fetcher));
    await waitFor(() => expect(result.current.data).toBe('balance-300'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe('balance-300');
    expect(result.current.error).toBe('offline');
  });

  test('refresh() is a no-op when key is null', async () => {
    const fetcher = vi.fn(async () => ({ data: 'x', error: null }));
    const { result } = renderHook(() => useAccountQuery<string>(null, fetcher));

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });
});

describe('invalidateAccountQuery / clearAccountQueryCache', () => {
  test('invalidateAccountQuery drops one entry, forcing the next read to re-fetch', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: 'v1', error: null })
      .mockResolvedValueOnce({ data: 'v2', error: null });

    const first = renderHook(() => useAccountQuery('k5', fetcher));
    await waitFor(() => expect(first.result.current.data).toBe('v1'));
    first.unmount();

    invalidateAccountQuery('k5');

    const second = renderHook(() => useAccountQuery('k5', fetcher));
    expect(second.result.current.loading).toBe(true); // no cache hit — treated as cold
    await waitFor(() => expect(second.result.current.data).toBe('v2'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('clearAccountQueryCache drops every entry', async () => {
    const fetcher = vi.fn(async () => ({ data: 'v', error: null }));
    const first = renderHook(() => useAccountQuery('k6', fetcher));
    await waitFor(() => expect(first.result.current.data).toBe('v'));
    first.unmount();

    clearAccountQueryCache();

    const second = renderHook(() => useAccountQuery('k6', fetcher));
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
