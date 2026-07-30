/**
 * accountQueryCache — a small stale-while-revalidate cache for the reads
 * the WS-1 blueprint calls out as genuinely duplicated across portal pages:
 * rewards (AccountDashboard's summary card + the full /account/rewards
 * page) and orders (AccountDashboard's recent-orders card, the full
 * /account/orders history, and one order's /account/orders/:orderNumber
 * detail). Every one of those re-fetched from scratch on every mount —
 * this module lets a page reuse another page's still-fresh read instead of
 * showing a loading flash for data the portal already has.
 *
 * Design: a module-level Map keyed by a caller-built string, namespaced
 * with the signed-in user's id so entries can never leak across an in-tab
 * sign-out/sign-in as a different customer. A cache hit renders
 * immediately; once an entry is older than STALE_MS the hook fires one
 * background re-fetch and swaps in the fresh result. This is a transport
 * optimization only — never a second source of truth: every read still
 * goes through the same server-truth wrappers in accountData.ts, and a
 * mutation path (e.g. redeeming a reward) calls the hook's own `refresh()`
 * to force an immediate, staleness-bypassing re-fetch rather than waiting
 * out the window.
 *
 * Revalidation-failure semantics: a REVALIDATION (a background stale
 * re-fetch, or an explicit `refresh()`) that comes back with an error keeps
 * the last-good `data` and surfaces the new `error` alongside it — a
 * customer's real reward balance or order list must never flip to
 * "unavailable"/empty because a background refresh had a transient hiccup;
 * that would be the cache asserting a fact the database never stated. A
 * COLD fetch (no prior entry for the key) has no good data to protect, so
 * its result is exposed as-is: `data: null` alongside the error, which is
 * the honest "we don't know yet" state. Every caller of this hook renders
 * that distinction as: `data === null` → the fetch has never succeeded, use
 * `error` for a full failure state; `data !== null` → render it, and treat
 * a present `error` as "last-known-good, refresh failed" rather than
 * blanking the view.
 *
 * A fetcher rejecting (rather than resolving `{data, error}` in-band) is
 * not reachable today — every accountData.ts wrapper resolves — but every
 * call site below still catches it defensively: an uncaught rejection here
 * would strand a page in a permanent loading spinner or leave `refresh()`
 * unable to ever clear its own loading state.
 *
 * Deliberately hand-rolled rather than a dependency (react-query/SWR): the
 * portal's whole caching surface is 3 read shapes behind 1 hook — comfortably
 * covered without a new runtime dependency.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface CacheEntry<T> {
  data: T | null;
  error: string | null;
  timestamp: number;
}

/** How long a cached entry is served before a background refetch fires. */
const STALE_MS = 30_000;

const cache = new Map<string, CacheEntry<unknown>>();

/** Drop a single cached entry — for a mutation the cache can't see itself. */
export function invalidateAccountQuery(key: string): void {
  cache.delete(key);
}

/** Drop the whole cache. Exposed for tests; production code relies on
 *  refresh()/invalidateAccountQuery() plus user-scoped keys instead. */
export function clearAccountQueryCache(): void {
  cache.clear();
}

export function ordersCacheKey(userId: string): string {
  return `orders:${userId}`;
}

export function orderDetailCacheKey(userId: string, orderNumber: string): string {
  return `order:${userId}:${orderNumber}`;
}

export function rewardsCacheKey(userId: string): string {
  return `rewards:${userId}`;
}

export interface AccountQueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Force an immediate re-fetch, bypassing the staleness window. */
  refresh: () => Promise<void>;
}

type Fetcher<T> = () => Promise<{ data: T; error: string | null }>;

/**
 * Run `fetcher` and cache the result. `previous` — the entry this call is
 * REVALIDATING, if any — is what makes an in-band error preserve last-good
 * data instead of overwriting it with the fetcher's own error-branch
 * payload: a cold read (no `previous`) has nothing to protect, so its
 * result (even an error alongside `null`) is the honest outcome.
 */
async function fetchAndCache<T>(
  key: string,
  fetcher: Fetcher<T>,
  previous?: CacheEntry<T>,
): Promise<CacheEntry<T>> {
  const result = await fetcher();
  const entry: CacheEntry<T> = result.error
    ? { data: previous?.data ?? null, error: result.error, timestamp: Date.now() }
    : { data: result.data, error: result.error, timestamp: Date.now() };
  cache.set(key, entry);
  return entry;
}

/** Same preserve-last-good-data contract as `fetchAndCache`'s error branch,
 *  for the defensive case where `fetcher()` rejects instead of resolving. */
function failureEntry<T>(previous: CacheEntry<T> | undefined, err: unknown): CacheEntry<T> {
  return {
    data: previous?.data ?? null,
    error: err instanceof Error ? err.message : 'Something went wrong. Try again.',
    timestamp: Date.now(),
  };
}

/**
 * Stale-while-revalidate read. `key === null` means "not ready yet" (e.g.
 * no signed-in user) — returns an idle result and fetches nothing.
 */
export function useAccountQuery<T>(key: string | null, fetcher: Fetcher<T>): AccountQueryResult<T> {
  const initial = key ? (cache.get(key) as CacheEntry<T> | undefined) : undefined;
  const [data, setData] = useState<T | null>(initial?.data ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [loading, setLoading] = useState(!initial && !!key);

  // Always the latest fetcher closure, without re-running the effect below
  // on every render — only a `key` change should trigger a re-fetch. Synced
  // in its own no-deps effect (not during render) so it's current by the
  // time the [key] effect below runs in the same commit.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const entry = cache.get(key) as CacheEntry<T> | undefined;

    function apply(next: CacheEntry<T>) {
      if (cancelled) return;
      setData(next.data);
      setError(next.error);
      setLoading(false);
    }

    if (!entry) {
      // Cold key: never show a previous key's data under the new key.
      setData(null);
      setError(null);
      setLoading(true);
      fetchAndCache(key, fetcherRef.current)
        .then(apply)
        .catch((err: unknown) => apply(failureEntry(undefined, err)));
      return () => {
        cancelled = true;
      };
    }

    apply(entry);
    if (Date.now() - entry.timestamp > STALE_MS) {
      fetchAndCache(key, fetcherRef.current, entry)
        .then(apply)
        .catch((err: unknown) => apply(failureEntry(entry, err)));
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  const refresh = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    const previous = cache.get(key) as CacheEntry<T> | undefined;
    let entry: CacheEntry<T>;
    try {
      entry = await fetchAndCache(key, fetcherRef.current, previous);
    } catch (err) {
      entry = failureEntry(previous, err);
    }
    setData(entry.data);
    setError(entry.error);
    setLoading(false);
  }, [key]);

  return { data, error, loading, refresh };
}
