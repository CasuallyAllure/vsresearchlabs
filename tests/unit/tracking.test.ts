/**
 * Pins src/lib/tracking.ts — carrier deep-links + order-status presentation.
 *
 * Everything here is a pure function over (carrier, tracking number, status)
 * strings, so no mocking is needed. The tests pin:
 *   • carrierLabel        — display names, unknown passthrough, null fallback
 *   • carrierRequiresTracking — hand_delivered is the only exemption
 *   • carrierTrackingUrl  — one deep-link per carrier, encoding/trim, the
 *                           Google-search fallback, and the null cases
 *   • statusPresentation  — label/step/tone per status incl. the passthrough
 *                           default for statuses the client doesn't know
 */
import { describe, expect, test } from 'vitest';

import {
  CARRIERS,
  STATUS_STEPS,
  carrierLabel,
  carrierRequiresTracking,
  carrierTrackingUrl,
  statusPresentation,
} from '../../src/lib/tracking';

describe('carrierLabel', () => {
  test('maps each known carrier value to its display label', () => {
    expect(carrierLabel('usps')).toBe('USPS');
    expect(carrierLabel('ups')).toBe('UPS');
    expect(carrierLabel('fedex')).toBe('FedEx');
    expect(carrierLabel('dhl')).toBe('DHL');
    expect(carrierLabel('hand_delivered')).toBe('Hand delivered');
  });

  test('is case-insensitive on the stored carrier value', () => {
    expect(carrierLabel('USPS')).toBe('USPS');
    expect(carrierLabel('FedEx')).toBe('FedEx');
  });

  test('passes an unknown carrier string through untouched', () => {
    expect(carrierLabel('pony-express')).toBe('pony-express');
  });

  test('falls back to the generic "Carrier" for null/undefined/empty', () => {
    expect(carrierLabel(null)).toBe('Carrier');
    expect(carrierLabel(undefined)).toBe('Carrier');
    expect(carrierLabel('')).toBe('Carrier');
  });
});

describe('carrierRequiresTracking', () => {
  test('every shippable carrier requires a tracking number', () => {
    expect(carrierRequiresTracking('usps')).toBe(true);
    expect(carrierRequiresTracking('ups')).toBe(true);
    expect(carrierRequiresTracking('fedex')).toBe(true);
    expect(carrierRequiresTracking('dhl')).toBe(true);
  });

  test('hand_delivered is exempt, case-insensitively', () => {
    expect(carrierRequiresTracking('hand_delivered')).toBe(false);
    expect(carrierRequiresTracking('HAND_DELIVERED')).toBe(false);
  });

  test('a missing carrier still "requires" tracking (UI shows the field)', () => {
    expect(carrierRequiresTracking(null)).toBe(true);
    expect(carrierRequiresTracking(undefined)).toBe(true);
  });
});

describe('carrierTrackingUrl', () => {
  test('returns null when there is no tracking number, regardless of carrier', () => {
    expect(carrierTrackingUrl('usps', null)).toBeNull();
    expect(carrierTrackingUrl('usps', undefined)).toBeNull();
    expect(carrierTrackingUrl('usps', '')).toBeNull();
  });

  test('builds the USPS deep-link', () => {
    expect(carrierTrackingUrl('usps', '9400111899223100000000'))
      .toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223100000000');
  });

  test('builds the UPS deep-link', () => {
    expect(carrierTrackingUrl('ups', '1Z999AA10123456784'))
      .toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
  });

  test('builds the FedEx deep-link', () => {
    expect(carrierTrackingUrl('fedex', '123456789012'))
      .toBe('https://www.fedex.com/fedextrack/?trknbr=123456789012');
  });

  test('builds the DHL deep-link', () => {
    expect(carrierTrackingUrl('dhl', '1234567890'))
      .toBe('https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=1234567890');
  });

  test('hand_delivered has no external tracking page', () => {
    expect(carrierTrackingUrl('hand_delivered', 'anything')).toBeNull();
  });

  test('unknown carrier falls back to a Google search of the number', () => {
    expect(carrierTrackingUrl('pony-express', 'ABC123'))
      .toBe('https://www.google.com/search?q=ABC123+tracking');
  });

  test('missing carrier with a number also falls to the Google search', () => {
    expect(carrierTrackingUrl(null, 'ABC123'))
      .toBe('https://www.google.com/search?q=ABC123+tracking');
  });

  test('trims and URL-encodes the tracking number', () => {
    expect(carrierTrackingUrl('usps', '  94 001&11  '))
      .toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=94%20001%2611');
  });

  test('carrier matching is case-insensitive', () => {
    expect(carrierTrackingUrl('UPS', '1Z1')).toBe('https://www.ups.com/track?tracknum=1Z1');
  });
});

describe('statusPresentation', () => {
  test('received → step 0, neutral', () => {
    const p = statusPresentation('received');

    expect(p.label).toBe('Order received');
    expect(p.step).toBe(0);
    expect(p.tone).toBe('neutral');
    expect(p.detail).not.toBe('');
  });

  test('awaiting_payment → step 1, neutral', () => {
    const p = statusPresentation('awaiting_payment');

    expect(p.label).toBe('Awaiting payment');
    expect(p.step).toBe(1);
    expect(p.tone).toBe('neutral');
  });

  test('payment_verifying → step 2, progress', () => {
    const p = statusPresentation('payment_verifying');

    expect(p.label).toBe('Verifying payment');
    expect(p.step).toBe(2);
    expect(p.tone).toBe('progress');
  });

  test('processing → step 3, progress', () => {
    const p = statusPresentation('processing');

    expect(p.label).toBe('Processing');
    expect(p.step).toBe(3);
    expect(p.tone).toBe('progress');
  });

  test('shipped → step 4, progress', () => {
    const p = statusPresentation('shipped');

    expect(p.label).toBe('Shipped');
    expect(p.step).toBe(4);
    expect(p.tone).toBe('progress');
  });

  test('delivered → step 5, done', () => {
    const p = statusPresentation('delivered');

    expect(p.label).toBe('Delivered');
    expect(p.step).toBe(5);
    expect(p.tone).toBe('done');
  });

  test('cancelled → step 0, stopped', () => {
    const p = statusPresentation('cancelled');

    expect(p.label).toBe('Cancelled');
    expect(p.step).toBe(0);
    expect(p.tone).toBe('stopped');
  });

  test('unknown status passes through as its own label with a neutral tone', () => {
    expect(statusPresentation('teleported')).toEqual({
      label: 'teleported',
      detail: '',
      step: 0,
      tone: 'neutral',
    });
  });
});

describe('constants', () => {
  test('CARRIERS lists every carrier the label map knows, hand_delivered last', () => {
    expect(CARRIERS.map((c) => c.value)).toEqual(['usps', 'ups', 'fedex', 'dhl', 'hand_delivered']);
  });

  test('STATUS_STEPS has 6 slots so payment_verifying gets its own bar segment', () => {
    expect(STATUS_STEPS).toHaveLength(6);
    expect(STATUS_STEPS[2]).toBe('Verifying');
  });
});
