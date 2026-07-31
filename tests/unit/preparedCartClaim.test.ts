// @vitest-environment happy-dom
/**
 * preparedCartClaim — the pure half of redeeming a prepared-cart link.
 *
 * Two groups of claims are worth a test each for different reasons:
 *
 *   • TOKEN HANDLING is a security property. The token is a credential
 *     delivered to an inbox, and the fragment is the only part of a URL that is
 *     never sent to a server and never leaks through `Referer`. So: it comes
 *     out of the fragment, the fragment is GONE afterwards, the rewrite is a
 *     REPLACE (a push would leave the tokenised URL one Back press away), and
 *     nothing throws when storage or history is unavailable.
 *
 *   • THE RPC BOUNDARY is a correctness property. `claim_prepared_cart` is
 *     SECURITY DEFINER and returns jsonb; an unrecognised body must become a
 *     stated failure, never a cheerful empty success — "0 items added" with no
 *     explanation is the failure mode this page exists to eliminate.
 *
 * The copy assertions are deliberately about MEANING, not wording: they pin
 * that a wrong-account failure names the account you are signed in as, and that
 * a merge into a non-empty cart says so. Both are things a member cannot work
 * out for themselves.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CLAIM_TOKEN_STORAGE_KEY,
  claimFailureCopy,
  claimOutcomeMessage,
  clearStoredClaimToken,
  couponFailureMessage,
  normalizeClaimResult,
  parseClaimToken,
  scrubClaimToken,
  takeClaimToken,
} from '../../src/lib/preparedCartClaim';

const TOKEN = 'a1b2c3'.repeat(10) + 'dead';

/** A window stand-in with exactly the surface the module touches. */
function fakeWindow(opts: {
  hash?: string;
  pathname?: string;
  search?: string;
  stored?: string | null;
  storageThrows?: boolean;
  historyThrows?: boolean;
  noHistory?: boolean;
} = {}) {
  const store = new Map<string, string>();
  if (opts.stored) store.set(CLAIM_TOKEN_STORAGE_KEY, opts.stored);

  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    if (opts.historyThrows) throw new Error('replaceState blocked');
    win.location.href = url;
  });
  const pushState = vi.fn();

  const win = {
    location: {
      hash: opts.hash ?? '',
      pathname: opts.pathname ?? '/account/prepared',
      search: opts.search ?? '',
      href: `${opts.pathname ?? '/account/prepared'}${opts.search ?? ''}${opts.hash ?? ''}`,
    },
    history: opts.noHistory ? undefined : { replaceState, pushState },
    sessionStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error('storage disabled');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.storageThrows) throw new Error('storage disabled');
        store.set(k, v);
      },
      removeItem: (k: string) => {
        if (opts.storageThrows) throw new Error('storage disabled');
        store.delete(k);
      },
    },
  } as unknown as Window & { location: { href: string } };

  return { win, store, replaceState, pushState };
}

describe('parseClaimToken', () => {
  test('reads the token out of a fragment, with or without the leading #', () => {
    expect(parseClaimToken(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(parseClaimToken(`t=${TOKEN}`)).toBe(TOKEN);
  });

  test('finds the token alongside other fragment keys', () => {
    expect(parseClaimToken(`#foo=1&t=${TOKEN}&bar=2`)).toBe(TOKEN);
  });

  test('returns null for an empty fragment, a fragment with no t, and an empty t', () => {
    expect(parseClaimToken('')).toBeNull();
    expect(parseClaimToken('#')).toBeNull();
    expect(parseClaimToken('#other=1')).toBeNull();
    expect(parseClaimToken('#t=')).toBeNull();
    expect(parseClaimToken('#t=   ')).toBeNull();
  });
});

describe('takeClaimToken — the token must not stay in the URL', () => {
  test('captures the token and REMOVES the fragment from the address bar', () => {
    const { win, replaceState } = fakeWindow({ hash: `#t=${TOKEN}` });

    expect(takeClaimToken(win)).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/account/prepared');
    expect(win.location.href).not.toContain(TOKEN);
    expect(win.location.href).not.toContain('#t=');
  });

  test('REPLACES rather than pushes — a pushed entry leaves the token one Back press away', () => {
    const { win, replaceState, pushState } = fakeWindow({ hash: `#t=${TOKEN}` });
    takeClaimToken(win);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
  });

  test('preserves an existing query string while dropping the fragment', () => {
    const { win, replaceState } = fakeWindow({ hash: `#t=${TOKEN}`, search: '?ref=email' });
    takeClaimToken(win);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/account/prepared?ref=email');
  });

  test('parks the token in sessionStorage so it survives the sign-in round trip', () => {
    const { win, store } = fakeWindow({ hash: `#t=${TOKEN}` });
    takeClaimToken(win);
    expect(store.get(CLAIM_TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  test('a second visit with no fragment recovers the stored token', () => {
    const { win, replaceState } = fakeWindow({ hash: '', stored: TOKEN });
    expect(takeClaimToken(win)).toBe(TOKEN);
    // Nothing to scrub — the URL never carried it this time.
    expect(replaceState).not.toHaveBeenCalled();
  });

  test('returns null when there is no fragment and nothing stored', () => {
    const { win } = fakeWindow({ hash: '' });
    expect(takeClaimToken(win)).toBeNull();
  });

  test('a fresh fragment overwrites a stale stored token', () => {
    const { win, store } = fakeWindow({ hash: `#t=${TOKEN}`, stored: 'older-token' });
    expect(takeClaimToken(win)).toBe(TOKEN);
    expect(store.get(CLAIM_TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  test('storage being unavailable still yields the token — the claim works in THIS document', () => {
    const { win, replaceState } = fakeWindow({ hash: `#t=${TOKEN}`, storageThrows: true });
    expect(takeClaimToken(win)).toBe(TOKEN);
    // And the URL is still scrubbed: storing is best-effort, hiding is not.
    expect(replaceState).toHaveBeenCalled();
  });

  test('storage being unavailable with no fragment is null, not a crash', () => {
    const { win } = fakeWindow({ hash: '', storageThrows: true });
    expect(takeClaimToken(win)).toBeNull();
  });

  test('a history rewrite that throws does not lose the token', () => {
    // The token is stored BEFORE the URL is rewritten precisely so a webview
    // that refuses replaceState can only fail to HIDE it, never to capture it.
    const { win, store } = fakeWindow({ hash: `#t=${TOKEN}`, historyThrows: true });
    expect(takeClaimToken(win)).toBe(TOKEN);
    expect(store.get(CLAIM_TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  test('a window with no history object is tolerated', () => {
    const { win } = fakeWindow({ hash: `#t=${TOKEN}`, noHistory: true });
    expect(takeClaimToken(win)).toBe(TOKEN);
  });
});

describe('scrubClaimToken / clearStoredClaimToken', () => {
  test('scrub rewrites the URL to path + query only', () => {
    const { win, replaceState } = fakeWindow({ hash: '#t=x', search: '?a=1' });
    scrubClaimToken(win);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/account/prepared?a=1');
  });

  test('clearing removes the stored token so it cannot surprise a later visit', () => {
    const { win, store } = fakeWindow({ stored: TOKEN });
    clearStoredClaimToken(win);
    expect(store.has(CLAIM_TOKEN_STORAGE_KEY)).toBe(false);
  });

  test('clearing is silent when storage is unavailable', () => {
    const { win } = fakeWindow({ storageThrows: true });
    expect(() => clearStoredClaimToken(win)).not.toThrow();
  });
});

describe('normalizeClaimResult — never trust the response shape', () => {
  test('accepts a well-formed success and keeps every dose', () => {
    const result = normalizeClaimResult({
      ok: true,
      cart_id: 'cart-1',
      coupon_code: 'SPRING20',
      note: 'For the Tuesday run',
      expires_at: '2026-08-13T00:00:00Z',
      first_claim: true,
      lines: [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: 'VSR-LE-MIX', dose: '', quantity: 1 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      cartId: 'cart-1',
      couponCode: 'SPRING20',
      note: 'For the Tuesday run',
      expiresAt: '2026-08-13T00:00:00Z',
      firstClaim: true,
      lines: [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: 'VSR-LE-MIX', dose: '', quantity: 1 },
      ],
    });
  });

  test('blank coupon and note collapse to null rather than empty strings', () => {
    const result = normalizeClaimResult({ ok: true, cart_id: 'c', coupon_code: '   ', note: '', lines: [] });
    expect(result).toMatchObject({ ok: true, couponCode: null, note: null });
  });

  test.each([
    ['a null body', null],
    ['a string body', 'nope'],
    ['a number body', 7],
  ])('%s is `unavailable`, not an empty success', (_label, body) => {
    expect(normalizeClaimResult(body)).toEqual({ ok: false, reason: 'unavailable' });
  });

  test.each(['not_found', 'revoked', 'expired', 'not_signed_in'])(
    'the known failure reason %s is passed through',
    (reason) => {
      expect(normalizeClaimResult({ ok: false, reason })).toEqual({ ok: false, reason });
    },
  );

  test('an unknown reason string degrades to `unavailable` rather than rendering raw', () => {
    expect(normalizeClaimResult({ ok: false, reason: 'kaboom' })).toEqual({ ok: false, reason: 'unavailable' });
    expect(normalizeClaimResult({ ok: false })).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('`already_claimed` is NOT a reason — a re-open must never be refused', () => {
    // The cart this fills is device-local (localStorage), so opening the mail on
    // a phone and buying on a laptop is the normal path. If the server ever
    // starts sending this again it degrades to `unavailable` — visibly wrong —
    // rather than quietly becoming a dead end that looks like a broken link.
    expect(normalizeClaimResult({ ok: false, reason: 'already_claimed' }))
      .toEqual({ ok: false, reason: 'unavailable' });
  });

  test('first_claim rides through, and an absent one reads as a re-open', () => {
    expect(normalizeClaimResult({ ok: true, cart_id: 'c', first_claim: true, lines: [] }))
      .toMatchObject({ firstClaim: true });
    // Never a false "first time": absent means we do not know, so say the
    // quieter thing.
    expect(normalizeClaimResult({ ok: true, cart_id: 'c', lines: [] })).toMatchObject({ firstClaim: false });
  });

  test('malformed lines are dropped, and a dose-less line is NOT invented', () => {
    const result = normalizeClaimResult({
      ok: true,
      cart_id: 'c',
      lines: [
        { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 },
        { sku: '', dose: '5mg', quantity: 1 },          // no sku
        { sku: 'VSR-X', dose: '5mg', quantity: 0 },      // non-positive
        { sku: 'VSR-Y', dose: '5mg', quantity: 1.5 },    // non-integer
        { sku: 'VSR-Z', dose: '5mg' },                   // no quantity
        'not-an-object',
        null,
      ],
    });
    expect(result).toMatchObject({ ok: true, lines: [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }] });
  });

  test('a non-array lines field becomes an empty list instead of throwing', () => {
    expect(normalizeClaimResult({ ok: true, cart_id: 'c', lines: 'nope' })).toMatchObject({ ok: true, lines: [] });
  });

  test('a missing cart_id and expires_at degrade rather than crash', () => {
    expect(normalizeClaimResult({ ok: true })).toMatchObject({ ok: true, cartId: '', expiresAt: null, lines: [] });
  });
});

describe('claimFailureCopy — every failure is a sentence, never a blank screen', () => {
  test.each(['not_found', 'revoked', 'expired', 'no_token', 'not_signed_in', 'unavailable'] as const)(
    '%s has a headline and a detail',
    (reason) => {
      const copy = claimFailureCopy(reason);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    },
  );

  test('the wrong-account case NAMES the account you are actually signed in as', () => {
    // The likeliest real confusion by a distance: the member has two mailboxes,
    // or a partner's browser is signed in. Nothing else on screen tells them.
    const copy = claimFailureCopy('not_found', 'other@example.com');
    expect(copy.detail).toContain('other@example.com');
    expect(copy.detail).toMatch(/sign out and sign back in/i);
  });

  test('the wrong-account case still reads sensibly with no email to name', () => {
    const copy = claimFailureCopy('not_found', null);
    expect(copy.detail).toMatch(/only opens for the account it was built for/i);
    expect(copy.detail).not.toContain('undefined');
  });

  test('a wrong-account failure does NOT claim the link is real — the server never said so', () => {
    // `not_found` covers both "no such token" and "someone else's token", by
    // design. Copy that asserted the link exists would leak what the RPC hid.
    const copy = claimFailureCopy('not_found', 'other@example.com');
    expect(copy.detail).not.toMatch(/this link (is|was) valid/i);
    expect(copy.detail).not.toMatch(/belongs to (another|a different) (account|member|customer)/i);
  });

  test('expired and revoked both offer a route to a replacement link', () => {
    expect(claimFailureCopy('expired').action).toBe('contact');
    expect(claimFailureCopy('revoked').action).toBe('contact');
  });

  test('arriving with no token explains that the important part of the URL is missing', () => {
    const copy = claimFailureCopy('no_token');
    expect(copy.action).toBe('shop');
    expect(copy.detail).toMatch(/full link from your email/i);
  });

  test('an unavailable backend says it is our fault, not the member’s', () => {
    expect(claimFailureCopy('unavailable').detail).toMatch(/on our side, not yours/i);
  });
});

describe('claimOutcomeMessage', () => {
  const base = {
    addedUnits: 3, addedLines: 2, unchangedLines: 0, replacedLines: 0,
    skipped: [] as string[], mergedIntoExistingCart: false,
  };

  test('states what went in', () => {
    expect(claimOutcomeMessage(base)).toMatch(/Added 3 items across 2 lines to your cart\./);
  });

  test('singulars read correctly', () => {
    expect(claimOutcomeMessage({ ...base, addedUnits: 1, addedLines: 1 })).toMatch(/1 item across 1 line/);
  });

  test('a merge with UNRELATED items SAYS SO — a silent merge makes the total lie', () => {
    const msg = claimOutcomeMessage({ ...base, mergedIntoExistingCart: true });
    expect(msg).toMatch(/cart you already had/i);
    expect(msg).toMatch(/existing items are still there/i);
  });

  test('a re-open where every line is already right says NOTHING CHANGED, not "added"', () => {
    // Same device, link opened twice. Claiming a fresh add here would be a lie
    // the totals immediately contradict.
    const msg = claimOutcomeMessage({ ...base, unchangedLines: 2 });
    expect(msg).toMatch(/already in your cart/i);
    expect(msg).toMatch(/never doubles anything/i);
    expect(msg).not.toMatch(/^Added/);
  });

  test('a re-open does not also claim a merge — those items ARE this cart', () => {
    // mergedIntoExistingCart is computed from items that are NOT part of the
    // prepared cart, so a converged re-open must not read as a merge.
    const msg = claimOutcomeMessage({ ...base, unchangedLines: 2, mergedIntoExistingCart: false });
    expect(msg).not.toMatch(/cart you already had/i);
  });

  test('a re-open still mentions unrelated items — they are still in the total', () => {
    const msg = claimOutcomeMessage({ ...base, unchangedLines: 2, mergedIntoExistingCart: true });
    expect(msg).toMatch(/already in your cart/i);
    expect(msg).toMatch(/other items you had in your cart are still there/i);
  });

  test('a partially-converged re-open still reads as an add, not "nothing changed"', () => {
    const msg = claimOutcomeMessage({ ...base, unchangedLines: 1 });
    expect(msg).toMatch(/^Added/);
    expect(msg).not.toMatch(/already in your cart/i);
  });

  test('a REPLACED quantity is named — it was the member’s own number', () => {
    // Setting rather than adding is what makes re-opens converge, but it does
    // overwrite a choice they made, so it is said out loud.
    const msg = claimOutcomeMessage({ ...base, replacedLines: 1 });
    expect(msg).toMatch(/1 line was already in your cart at a different quantity/i);
    expect(msg).toMatch(/set to the prepared amount/i);
    expect(msg).toMatch(/change it back any time/i);
  });

  test('several replaced quantities are pluralised', () => {
    const msg = claimOutcomeMessage({ ...base, replacedLines: 2 });
    expect(msg).toMatch(/2 lines were already in your cart at a different quantity and have been set/i);
  });

  test('skipped lines are named, never silently dropped', () => {
    const msg = claimOutcomeMessage({ ...base, skipped: ['VSR-RS-BPC · 20mg'] });
    expect(msg).toContain('VSR-RS-BPC · 20mg');
    expect(msg).toMatch(/no longer available/i);
  });

  test('several skipped lines are pluralised', () => {
    const msg = claimOutcomeMessage({ ...base, skipped: ['A · 1mg', 'B · 2mg'] });
    expect(msg).toMatch(/2 items \(A · 1mg, B · 2mg\) are no longer available and were left out\./);
  });

  test('a replacement and a skip are both reported in one message', () => {
    const msg = claimOutcomeMessage({ ...base, replacedLines: 1, skipped: ['A · 1mg'] });
    expect(msg).toMatch(/set to the prepared amount/i);
    expect(msg).toMatch(/no longer available/i);
  });

  test('nothing addable at all is stated plainly with a route to a replacement', () => {
    const msg = claimOutcomeMessage({ ...base, addedUnits: 0, addedLines: 0, skipped: ['A · 1mg'] });
    expect(msg).toMatch(/None of the items in this cart are available any more/i);
    expect(msg).toMatch(/get in touch/i);
  });

  test('an empty cart is stated rather than dressed up as a success', () => {
    expect(claimOutcomeMessage({ ...base, addedUnits: 0, addedLines: 0 }))
      .toMatch(/This cart is empty/i);
  });
});

describe('couponFailureMessage', () => {
  test('names the code, repeats the server’s reason, and warns against checking out', () => {
    // Silence here costs the member money: they would pay the undiscounted
    // price for a cart that was quoted with the code applied.
    const msg = couponFailureMessage('SPRING20', 'This code has expired.');
    expect(msg).toContain('SPRING20');
    expect(msg).toContain('This code has expired.');
    expect(msg).toMatch(/don’t check out at this price/i);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
