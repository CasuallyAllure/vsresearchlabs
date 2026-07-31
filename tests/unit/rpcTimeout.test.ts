/**
 * rpcTimeout — the hard upper bound shared by the admin composer and the
 * member-facing claim page.
 *
 * The bug it exists for shipped once already: `supabase.rpc()` awaits
 * `auth.getSession()` BEFORE it reaches `fetch`, and `fetch` itself has no
 * default timeout, so a stalled session read hangs the promise before a request
 * is even made. Nothing resolves, nothing rejects, and the caller's `busy` flag
 * stays true forever — a button pinned on "Working…" with no error and no
 * result. The tests below pin the three properties that make that impossible:
 * a hang REJECTS, the message is the caller's own, and the timer is cleared on
 * every path so a settled call leaves nothing pending.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RPC_TIMEOUT_MS, RPC_TIMEOUT_SECONDS, rpcWithTimeout, withTimeout } from '../../src/lib/rpcTimeout';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('withTimeout', () => {
  test('resolves with the work’s value when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 'too slow')).resolves.toBe('ok');
  });

  test('a rejection from the work passes straight through, unwrapped', async () => {
    const boom = new Error('rpc exploded');
    await expect(withTimeout(Promise.reject(boom), 'too slow')).rejects.toBe(boom);
  });

  test('work that never settles REJECTS with the caller’s message — the hang this guards', async () => {
    const forever = new Promise<string>(() => {});
    const raced = withTimeout(forever, 'Loading built carts did not respond.');
    const assertion = expect(raced).rejects.toThrow('Loading built carts did not respond.');
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
    await assertion;
  });

  test('the bound is finite but generous, and the second form matches it', () => {
    expect(RPC_TIMEOUT_MS).toBeGreaterThan(0);
    expect(RPC_TIMEOUT_SECONDS).toBe(RPC_TIMEOUT_MS / 1000);
  });

  test('a settled call leaves no pending timer behind', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve(1), 'too slow');
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    clear.mockRestore();
  });

  test('a REJECTED call also clears its timer — `finally`, not the happy path', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 'too slow')).rejects.toThrow('x');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('accepts a thenable, not just a real Promise — supabase-js rpc() is one', async () => {
    // `rpc()` returns a query builder that only becomes a promise when awaited.
    // Typing or racing this as a strict Promise would reject the one caller the
    // helper was extracted for.
    // A loose thenable, exactly like the query builder: `then` takes one
    // callback and returns nothing. TS cannot express that as PromiseLike, which
    // is precisely why the helper's parameter must not be a strict Promise.
    const thenable = {
      then: (res: (v: string) => void) => { res('from a thenable'); },
    } as unknown as PromiseLike<string>;
    await expect(withTimeout(thenable, 'too slow')).resolves.toBe('from a thenable');
  });
});

describe('rpcWithTimeout', () => {
  test('calls the named RPC with the given args and returns its result', async () => {
    const rpc = vi.fn(async () => ({ data: { rows: [] }, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    const result = await rpcWithTimeout(client, 'admin_prepared_carts', { p_user_id: 'u1' }, 'too slow');

    expect(rpc).toHaveBeenCalledWith('admin_prepared_carts', { p_user_id: 'u1' });
    expect(result).toEqual({ data: { rows: [] }, error: null });
  });

  test('an RPC that never settles rejects with the caller’s message', async () => {
    const client = { rpc: () => new Promise(() => {}) } as unknown as SupabaseClient;
    const raced = rpcWithTimeout(client, 'claim_prepared_cart', { p_token: 'x' }, 'The cart didn’t open.');
    const assertion = expect(raced).rejects.toThrow('The cart didn’t open.');
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
    await assertion;
  });
});
