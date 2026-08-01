/**
 * The LAUNCH DAY BOGO promo WINDOW — timezone correctness and clock authority.
 *
 * The owner's window: launch Saturday 2026-08-01, running THROUGH the end of
 * Monday 2026-08-03 in the STORE's timezone (America/Los_Angeles). Migration
 * 084 stores that as an EXCLUSIVE upper bound at Tuesday 2026-08-04 00:00:00
 * store-local, which in August (PDT, UTC-7) is 2026-08-04T07:00:00Z.
 *
 * The trap this file exists to pin: treating the deadline as UTC would have
 * killed the promo at 5pm Monday LOCAL — customers would have watched their
 * discount vanish mid-session on the busiest evening of the promo.
 *
 * The second trap: letting the DEVICE clock decide. isBogoLiveFrom() takes the
 * server's instant explicitly and treats a missing one as NOT LIVE, so a
 * skewed device can neither grant nor deny the discount.
 */
import { describe, expect, test } from 'vitest';
import {
  bogoDeadlineLabel,
  estimateServerNow,
  isBogoLiveFrom,
  STORE_TIME_ZONE,
} from '../../src/lib/promoSettings';

/** Exactly what migration 084 stores: Tuesday 00:00:00 America/Los_Angeles. */
const ENDS_AT = '2026-08-04T07:00:00.000Z';
const ms = (iso: string) => Date.parse(iso);

describe('the stored boundary is Pacific midnight, not UTC midnight', () => {
  test('the bound is 07:00Z — i.e. PDT (UTC-7), not UTC', () => {
    const bound = new Date(ENDS_AT);
    expect(bound.toLocaleDateString('en-US', { timeZone: STORE_TIME_ZONE }))
      .toBe('8/4/2026');
    // Same instant rendered in store time is exactly midnight. hourCycle h23
    // (not hour12:false) — ICU renders midnight as "24:00:00" under the latter.
    expect(bound.toLocaleTimeString('en-US', { timeZone: STORE_TIME_ZONE, hourCycle: 'h23' }))
      .toBe('00:00:00');
  });

  test('a UTC-midnight bound would have ended the promo at 5pm Monday local', () => {
    // The bug we did NOT ship, pinned so nobody "simplifies" the literal later.
    const naiveUtcMidnight = new Date('2026-08-04T00:00:00.000Z');
    expect(naiveUtcMidnight.toLocaleTimeString('en-US', {
      timeZone: STORE_TIME_ZONE, hourCycle: 'h23',
    })).toBe('17:00:00');
    expect(naiveUtcMidnight.toLocaleDateString('en-US', { timeZone: STORE_TIME_ZONE }))
      .toBe('8/3/2026');
  });
});

describe('boundary behavior — store-local instants', () => {
  test('Monday 23:59:59 store time is LIVE', () => {
    // 23:59:59 PDT Monday = 06:59:59Z Tuesday.
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-04T06:59:59.000Z')))
      .toBe(true);
  });

  test('the final millisecond before the bound is LIVE', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms(ENDS_AT) - 1)).toBe(true);
  });

  test('Tuesday 00:00:00 store time is NOT live (exclusive bound)', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-04T07:00:00.000Z')))
      .toBe(false);
  });

  test('Tuesday 00:00:01 store time is NOT live', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-04T07:00:01.000Z')))
      .toBe(false);
  });

  test('Saturday launch day and Sunday are both live', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-01T18:00:00.000Z')))
      .toBe(true);
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-02T18:00:00.000Z')))
      .toBe(true);
  });

  test('the same instants expressed in UTC land on the correct side', () => {
    // 06:59:59Z Tue == 23:59:59 Mon PDT → live.
    // 07:00:00Z Tue == 00:00:00 Tue PDT → dead.
    // Expressed purely as UTC strings, with no local reasoning at all.
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, Date.UTC(2026, 7, 4, 6, 59, 59)))
      .toBe(true);
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, Date.UTC(2026, 7, 4, 7, 0, 0)))
      .toBe(false);
  });
});

describe('the manual switch overrides the window in both directions', () => {
  test('disabled kills the promo even well inside the window', () => {
    expect(isBogoLiveFrom(false, ENDS_AT, [], null, ms('2026-08-02T18:00:00.000Z')))
      .toBe(false);
  });

  test('enabled does NOT resurrect the promo after the window closed', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, ms('2026-08-05T18:00:00.000Z')))
      .toBe(false);
  });

  test('no end date at all → the switch alone governs', () => {
    expect(isBogoLiveFrom(true, null, [], null, ms('2030-01-01T00:00:00.000Z')))
      .toBe(true);
    expect(isBogoLiveFrom(false, null, [], null, ms('2026-08-01T00:00:00.000Z')))
      .toBe(false);
  });
});

describe('a wrong device clock cannot change the outcome', () => {
  // The server said "it is 23:59:00 Monday store time" when the page loaded.
  const SERVER_AT_FETCH = ms('2026-08-04T06:59:00.000Z');

  test('a device skewed HOURS FORWARD cannot kill a live promo', () => {
    // Device wall clock believes it is next week — irrelevant: only the
    // monotonic delta since fetch is used. 10 seconds have really elapsed.
    const serverNow = estimateServerNow(SERVER_AT_FETCH, 1_000, 11_000);
    expect(serverNow).toBe(SERVER_AT_FETCH + 10_000); // 23:59:10 Monday
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, serverNow)).toBe(true);
  });

  test('a device skewed HOURS BACKWARD cannot extend a dead promo', () => {
    // Page loaded after the promo closed; the device thinks it is last Friday.
    const afterClose = ms('2026-08-04T07:00:30.000Z');
    const serverNow = estimateServerNow(afterClose, 5_000, 6_000);
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, serverNow)).toBe(false);
  });

  test('crossing the boundary while the page sits open flips it to dead', () => {
    // Fetched at 23:59:00 Monday; 61 real seconds pass → 00:00:01 Tuesday.
    const serverNow = estimateServerNow(SERVER_AT_FETCH, 0, 61_000);
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, serverNow)).toBe(false);
  });

  test('a monotonic reading that goes BACKWARDS never rewinds the server clock', () => {
    // Defensive: clamped at 0 elapsed, so time can only move forward.
    expect(estimateServerNow(SERVER_AT_FETCH, 10_000, 5_000)).toBe(SERVER_AT_FETCH);
  });
});

describe('FAIL CLOSED when there is no server clock', () => {
  test('a null server instant is NOT live', () => {
    expect(isBogoLiveFrom(true, ENDS_AT, [], null, null)).toBe(false);
  });

  test('an omitted server instant is NOT live', () => {
    expect(isBogoLiveFrom(true, ENDS_AT)).toBe(false);
  });

  test('estimateServerNow returns null when nothing was ever fetched', () => {
    expect(estimateServerNow(null, null, 123)).toBeNull();
    expect(estimateServerNow(SERVER_AT_FETCH_NULLABLE, null, 123)).toBeNull();
    expect(estimateServerNow(null, 0, 123)).toBeNull();
  });

  test('no end date + no clock is still live — the clock only gates expiry', () => {
    // Nothing to compare against, so the switch alone decides. This is the one
    // case where a missing clock does not force "dead", and it is correct:
    // an unbounded promo has no boundary a clock could be wrong about.
    expect(isBogoLiveFrom(true, null, [], null, null)).toBe(true);
  });
});

const SERVER_AT_FETCH_NULLABLE: number | null = 1;

describe('the deadline label names the day plainly, in store time', () => {
  test('names Monday, August 3 — the last full day, not the exclusive bound', () => {
    expect(bogoDeadlineLabel(ENDS_AT)).toBe('Monday, August 3');
  });

  test('renders in STORE time regardless of the process timezone', () => {
    // The bound is Tuesday in UTC; the label must still say Monday, because
    // the store's last full day is Monday Pacific.
    expect(new Date(ENDS_AT).toISOString()).toContain('2026-08-04');
    expect(bogoDeadlineLabel(ENDS_AT)).toContain('Monday');
    expect(bogoDeadlineLabel(ENDS_AT)).not.toContain('Tuesday');
  });

  test('no end date → no deadline copy (never invent one)', () => {
    expect(bogoDeadlineLabel(null)).toBe('');
  });

  test('an unparseable end date yields no copy rather than "Invalid Date"', () => {
    expect(bogoDeadlineLabel('not-a-date')).toBe('');
  });
});

describe('excluded SKUs are independent of the window', () => {
  test('an excluded sku is dead even mid-window', () => {
    expect(isBogoLiveFrom(
      true, ENDS_AT, ['VSR-RS-GSK'], 'VSR-RS-GSK', ms('2026-08-02T18:00:00.000Z'),
    )).toBe(false);
  });

  test('a non-excluded sku is live mid-window', () => {
    expect(isBogoLiveFrom(
      true, ENDS_AT, ['VSR-RS-GSK'], 'VSR-RS-BPC', ms('2026-08-02T18:00:00.000Z'),
    )).toBe(true);
  });
});
