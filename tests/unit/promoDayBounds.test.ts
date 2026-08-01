/**
 * Unit tests for src/lib/promoDayBounds.ts — the date-input ⇄ EXCLUSIVE
 * boundary conversion used by the admin BOGO controls.
 *
 * Pins the two things that would silently move a promo boundary:
 *   - the stored bound is EXCLUSIVE, so the day shown is the LAST LIVE day
 *     (Aug 3 for a bound of Aug 4 00:00 store-local), never the bound's own
 *     calendar day;
 *   - the offset is resolved per instant from the IANA database, so a summer
 *     (PDT, −7) and a winter (PST, −8) boundary both land on real store
 *     midnight, and the admin's own device timezone never participates.
 *
 * The seeded launch value from migration 084 is asserted literally, so a
 * regression here fails against the exact instant the database holds.
 */
import { describe, expect, test } from 'vitest';

import { storeDayInputValue, storeDayToExclusiveEndIso } from '../../src/lib/promoDayBounds';

/** The instant migration 084 seeds: 2026-08-04 00:00 America/Los_Angeles. */
const LAUNCH_BOUND_ISO = '2026-08-04T07:00:00.000Z';

describe('storeDayToExclusiveEndIso', () => {
  test('maps the last live day to midnight store-local the following day', () => {
    // Arrange — the owner picks "the promo runs through Monday Aug 3".
    const lastLiveDay = '2026-08-03';

    // Act
    const iso = storeDayToExclusiveEndIso(lastLiveDay);

    // Assert — PDT (UTC−7) in August.
    expect(iso).toBe(LAUNCH_BOUND_ISO);
  });

  test('resolves the winter offset (PST) rather than assuming the summer one', () => {
    expect(storeDayToExclusiveEndIso('2026-01-04')).toBe('2026-01-05T08:00:00.000Z');
  });

  test('rolls over the month boundary', () => {
    expect(storeDayToExclusiveEndIso('2026-08-31')).toBe('2026-09-01T07:00:00.000Z');
  });

  test('rolls over the year boundary', () => {
    expect(storeDayToExclusiveEndIso('2026-12-31')).toBe('2027-01-01T08:00:00.000Z');
  });

  test('lands on real midnight across a spring-forward transition', () => {
    // 2026-03-08 is the US spring-forward day; midnight that day is still PST.
    expect(storeDayToExclusiveEndIso('2026-03-07')).toBe('2026-03-08T08:00:00.000Z');
  });

  test('lands on real midnight across a fall-back transition', () => {
    // 2026-11-01 is the US fall-back day; midnight that day is still PDT.
    expect(storeDayToExclusiveEndIso('2026-10-31')).toBe('2026-11-01T07:00:00.000Z');
  });

  test('returns null for an empty value, so clearing the field clears the date', () => {
    expect(storeDayToExclusiveEndIso('')).toBeNull();
  });

  test('returns null for a malformed value', () => {
    expect(storeDayToExclusiveEndIso('08/03/2026')).toBeNull();
  });

  test('returns null for an out-of-range month or day', () => {
    expect(storeDayToExclusiveEndIso('2026-13-01')).toBeNull();
    expect(storeDayToExclusiveEndIso('2026-08-00')).toBeNull();
    expect(storeDayToExclusiveEndIso('2026-08-32')).toBeNull();
  });
});

describe('storeDayInputValue', () => {
  test('shows the LAST LIVE day, not the exclusive bound day', () => {
    expect(storeDayInputValue(LAUNCH_BOUND_ISO)).toBe('2026-08-03');
  });

  test('round-trips a day through both directions unchanged', () => {
    const day = '2026-08-03';
    expect(storeDayInputValue(storeDayToExclusiveEndIso(day) as string)).toBe(day);
  });

  test('reads a mid-day bound as the day it falls on', () => {
    // A bound that is not midnight still names its own store-local day.
    expect(storeDayInputValue('2026-08-03T19:30:00.000Z')).toBe('2026-08-03');
  });

  test('returns empty string when there is no end date', () => {
    expect(storeDayInputValue(null)).toBe('');
  });

  test('returns empty string for an unparseable timestamp', () => {
    expect(storeDayInputValue('not-a-date')).toBe('');
  });
});
