/**
 * preparedCartDetail — the pure half of an opened prepared cart.
 *
 * Two things are being pinned here, and both are about NOT LYING TO THE OWNER:
 *
 *   1. Delivery is a three-state. `email_log` records that a mail went out and
 *      nothing about why one did not, so an unreadable ledger must come back
 *      `unknown` and never `not_emailed` — the second would tell the owner a
 *      client was never contacted on the strength of a query that never ran.
 *
 *   2. A `timestamptz` formats. `members/format.ts::shortDate` appends
 *      "T00:00:00" to whatever it is given, which turns every timestamp off
 *      admin_prepared_carts into the literal text "Invalid Date" — including
 *      `created_at`, the one field the owner asked for by name.
 *
 * Every instant below is fixed at 12:00Z so the calendar day is the same in
 * every timezone CI or a laptop might run in.
 */

import { describe, expect, test } from 'vitest';
import {
  deliveryByCart, expiryNote, opensNote, preparedCartPeriodKey, stampLabel,
  type PreparedCartEmailLogRow,
} from '../../src/lib/preparedCartDetail';

const NOON = '2026-08-12T12:00:00Z';

describe('preparedCartPeriodKey', () => {
  test('matches the key send-prepared-cart claims in email_log', () => {
    // handler.ts: `const periodKey = \`pc-${cartId}\``. If these two ever drift,
    // every cart silently reports "not emailed" for a mail that did go out.
    expect(preparedCartPeriodKey('cart-1')).toBe('pc-cart-1');
  });
});

describe('deliveryByCart', () => {
  const row = (over: Partial<PreparedCartEmailLogRow> = {}): PreparedCartEmailLogRow => ({
    period_key: 'pc-cart-1', sent_at: NOON, recipient: 'ada@example.com', ...over,
  });

  test('a cart with a log row is emailed, and carries when and to whom', () => {
    expect(deliveryByCart(['cart-1'], [row()]).get('cart-1'))
      .toEqual({ state: 'emailed', at: NOON, to: 'ada@example.com' });
  });

  test('a cart with no log row is not_emailed', () => {
    expect(deliveryByCart(['cart-1'], []).get('cart-1')).toEqual({ state: 'not_emailed' });
  });

  test('an unreadable ledger is unknown for EVERY cart, never not_emailed', () => {
    // The whole reason this is a three-state. `not_emailed` here would be an
    // assertion about a client's inbox derived from a failed query.
    const out = deliveryByCart(['cart-1', 'cart-2'], null);
    expect(out.get('cart-1')).toEqual({ state: 'unknown' });
    expect(out.get('cart-2')).toEqual({ state: 'unknown' });
  });

  test('no carts means no answers, whatever the ledger says', () => {
    expect(deliveryByCart([], [row()]).size).toBe(0);
    expect(deliveryByCart([], null).size).toBe(0);
  });

  test('only the cart that was mailed is marked emailed', () => {
    const out = deliveryByCart(['cart-1', 'cart-2'], [row({ period_key: 'pc-cart-2' })]);
    expect(out.get('cart-1')).toEqual({ state: 'not_emailed' });
    expect(out.get('cart-2')).toMatchObject({ state: 'emailed' });
  });

  test('two rows for one cart report the EARLIEST send', () => {
    // email_log's unique is per RECIPIENT, so a member whose address changed can
    // accumulate two rows for one cart. The question is when it first reached
    // them, and row order out of PostgREST is not guaranteed.
    const later = row({ sent_at: '2026-08-20T12:00:00Z', recipient: 'new@example.com' });
    const earlier = row({ sent_at: NOON, recipient: 'old@example.com' });
    for (const rows of [[later, earlier], [earlier, later]]) {
      expect(deliveryByCart(['cart-1'], rows).get('cart-1'))
        .toEqual({ state: 'emailed', at: NOON, to: 'old@example.com' });
    }
  });

  test('a log row with no recipient still counts as emailed', () => {
    expect(deliveryByCart(['cart-1'], [row({ recipient: null })]).get('cart-1'))
      .toEqual({ state: 'emailed', at: NOON, to: null });
  });
});

describe('stampLabel', () => {
  test('renders a timestamptz as a real date and time, not "Invalid Date"', () => {
    // The bug: shortDate('2026-08-12T12:00:00Z' + 'T00:00:00') is NaN.
    const out = stampLabel(NOON);
    expect(out).toMatch(/^Aug 12, 2026, /);
    expect(out).not.toMatch(/Invalid/);
  });

  test('keeps the time — two carts built the same afternoon must be tellable apart', () => {
    expect(stampLabel(NOON)).not.toBe(stampLabel('2026-08-12T20:00:00Z'));
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['unparseable text', 'not a date'],
  ])('renders an em dash for %s rather than a broken date', (_label, input) => {
    expect(stampLabel(input)).toBe('—');
  });
});

describe('expiryNote', () => {
  const now = new Date(NOON);

  test('a future expiry reads "Expires" and has not passed', () => {
    const note = expiryNote('2026-08-26T12:00:00Z', now);
    expect(note.passed).toBe(false);
    expect(note.label).toMatch(/^Expires Aug 26, 2026, /);
  });

  test('a past expiry reads "Expired" and has passed', () => {
    const note = expiryNote('2026-08-01T12:00:00Z', now);
    expect(note.passed).toBe(true);
    expect(note.label).toMatch(/^Expired Aug 1, 2026, /);
  });

  test('an expiry exactly now has passed — the window is closed, not closing', () => {
    expect(expiryNote(NOON, now).passed).toBe(true);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['unparseable text', 'whenever'],
  ])('%s is not treated as expired', (_label, input) => {
    const note = expiryNote(input, now);
    expect(note.passed).toBe(false);
    expect(note.label).toBe('Expires —');
  });
});

describe('opensNote', () => {
  test('reports the count and the most recent open', () => {
    const out = opensNote({ claim_count: 3, last_claimed_at: NOON, claimed_at: '2026-08-01T12:00:00Z' });
    expect(out).toMatch(/^opened 3× · last Aug 12, 2026, /);
  });

  test('falls back to the FIRST open when 082 recorded no last_claimed_at', () => {
    const out = opensNote({ claim_count: 1, last_claimed_at: null, claimed_at: NOON });
    expect(out).toMatch(/^opened 1× · last Aug 12, 2026, /);
  });

  test('reports a bare count when no timestamp survived at all', () => {
    expect(opensNote({ claim_count: 2, last_claimed_at: null, claimed_at: null })).toBe('opened 2×');
    expect(opensNote({ claim_count: 2 })).toBe('opened 2×');
  });

  test.each([
    ['zero', 0],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for a %s count so the caller renders nothing, not "0×"', (_label, count) => {
    // A cart built an hour ago and a cart ignored for a fortnight both read
    // zero; a printed zero invites the owner to read the second into the first.
    expect(opensNote({ claim_count: count })).toBeNull();
  });
});
