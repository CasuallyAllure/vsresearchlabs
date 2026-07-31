/**
 * rpcTimeout — a hard upper bound on one Supabase RPC.
 *
 * Extracted from src/pages/admin/members/usePreparedCart.ts when the member
 * facing claim page needed the same guarantee. It is the SAME bug on both
 * sides, so it is the same code on both sides:
 *
 * supabase-js folds network failures into `{ error }` rather than rejecting, so
 * the resolved-error path is well covered — but NOTHING in the stack bounds how
 * long the call may take. `fetch` has no default timeout, and supabase-js awaits
 * `auth.getSession()` BEFORE it ever reaches `fetch`, so a stalled session read
 * hangs the promise before a request is even made. Either one leaves a button
 * pinned on "Working…" with no error and no result — a shipped production bug
 * on the admin side, and a worse one on a page whose whole job is to tell a
 * member what happened.
 *
 * A plain race rather than `.abortSignal()`: the signal is only handed to
 * `fetch`, so it cannot reach the half of the hang that happens before `fetch`
 * is called. Aborting the client would not roll the server back either, which
 * is why callers' timeout copy says the write may still have landed.
 *
 * The MESSAGE is the caller's, not this module's — the admin panel and the
 * member page owe their readers different sentences, and a shared helper has no
 * business choosing between them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Upper bound on any one prepared-cart RPC. Generous — building a cart writes a
 * row per line plus an audit entry — but finite, which is the whole point.
 */
export const RPC_TIMEOUT_MS = 15_000;

/** `RPC_TIMEOUT_MS` in whole seconds, for callers composing their own copy. */
export const RPC_TIMEOUT_SECONDS = RPC_TIMEOUT_MS / 1000;

/**
 * Bound ANY promise, rejecting with `new Error(timeoutMessage)` if it has not
 * settled within `RPC_TIMEOUT_MS`. The timer is always cleared, including on the
 * happy path, so a resolved call cannot leave a pending handle behind.
 *
 * Generic because not every unbounded call in this stack is a bare `rpc()` —
 * `checkCoupon` wraps one, and an unbounded coupon check would hang the claim
 * page just as effectively as an unbounded claim would.
 */
// `PromiseLike`, not `Promise`: supabase-js's `rpc()` returns a thenable query
// builder that only becomes a real promise when awaited. Typing this as
// `Promise` would reject the one caller it was extracted for.
export async function withTimeout<T>(work: PromiseLike<T>, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), RPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** `withTimeout` around one Supabase RPC — the shape both callers actually use. */
export async function rpcWithTimeout(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  timeoutMessage: string,
): Promise<{ data: unknown; error: unknown }> {
  return withTimeout(client.rpc(fn, args), timeoutMessage);
}
