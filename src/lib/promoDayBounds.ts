/**
 * promoDayBounds — translating between a date <input> ("YYYY-MM-DD") and the
 * EXCLUSIVE end-of-day instant a promo boundary is stored as, resolved in the
 * STORE'S timezone rather than the admin's device timezone.
 *
 * Why this exists instead of reusing the B2G1 panel's local 23:59:59 helper:
 *
 *   - Migration 084 stores the BOGO boundary as an EXCLUSIVE instant —
 *     "through the end of Monday" is written as Tuesday 00:00:00 store-local,
 *     because every liveness gate tests `ends_at > now()`. Rendering that
 *     instant with a naive date formatter shows the owner "Aug 4" for a promo
 *     whose last live day is Aug 3.
 *   - The window is defined in America/Los_Angeles. An admin editing from a
 *     different timezone (or a laptop with the wrong one set) must not silently
 *     move the boundary by hours.
 *
 * Both directions are pure and DST-safe: the offset is resolved per instant
 * from the IANA database via Intl, never assumed.
 */

import { STORE_TIME_ZONE } from './promoSettings';

/** One pass of Intl for the store zone. Constructing a DateTimeFormat is the
 *  expensive part, so it is built once. */
const STORE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: STORE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface ZonedFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock fields the store's timezone shows at instant `utcMs`. */
function zonedFields(utcMs: number): ZonedFields {
  const parts = STORE_PARTS.formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The store zone's UTC offset in ms AT that instant (negative west of UTC). */
function storeOffsetMs(utcMs: number): number {
  const f = zonedFields(utcMs);
  const wallAsUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant of 00:00:00 store-local on the given calendar day.
 *
 * Two passes: the offset is first sampled at the naive instant, then
 * re-sampled at the candidate it produces, because a DST transition between
 * the two changes the answer by an hour. Out-of-range day values normalize
 * (day 32 rolls into the next month), which is what makes "the day after" a
 * one-line call at the caller.
 */
function storeMidnightUtcMs(year: number, month: number, day: number): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  const candidate = naive - storeOffsetMs(naive);
  return naive - storeOffsetMs(candidate);
}

/**
 * The date-input value ("YYYY-MM-DD") for the LAST DAY the promo runs, given
 * the stored EXCLUSIVE boundary. Empty string when there is no boundary or it
 * cannot be parsed — a date <input> renders that as blank.
 *
 * The last live day is the one containing the final millisecond before the
 * bound, so the boundary is stepped back 1ms before being read in store time.
 */
export function storeDayInputValue(endsAtIso: string | null): string {
  if (!endsAtIso) return '';
  const bound = Date.parse(endsAtIso);
  if (!Number.isFinite(bound)) return '';
  const f = zonedFields(bound - 1);
  const month = String(f.month).padStart(2, '0');
  const day = String(f.day).padStart(2, '0');
  return `${f.year}-${month}-${day}`;
}

/**
 * The inverse: a date-input value naming the LAST DAY the promo runs becomes
 * the EXCLUSIVE boundary instant — 00:00:00 store-local on the following day.
 * Returns null for an empty or unparseable value, which clears the end date.
 */
export function storeDayToExclusiveEndIso(dateStr: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(storeMidnightUtcMs(year, month, day + 1)).toISOString();
}
