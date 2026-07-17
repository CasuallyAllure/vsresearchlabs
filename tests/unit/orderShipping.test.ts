/**
 * Unit tests for supabase/functions/place-order/orderShipping.ts — the server
 * shipping authority.
 *
 * This module is the authority place-order uses to compute the real charge
 * from the VERIFIED session (members free, guests flat fee). The tests pin
 * the owner's rule and the exact GUEST_SHIPPING_CENTS constant, plus a
 * mirror-parity guard against src/lib/shipping.ts — the client DISPLAY
 * mirror the module comments demand stays in sync.
 */
import { describe, expect, test } from 'vitest';
import {
  GUEST_SHIPPING_CENTS,
  shippingCentsFor,
} from '../../supabase/functions/place-order/orderShipping';
import {
  GUEST_SHIPPING_CENTS as CLIENT_GUEST_SHIPPING_CENTS,
  shippingCentsFor as clientShippingCentsFor,
} from '../../src/lib/shipping';

describe('GUEST_SHIPPING_CENTS', () => {
  test('is the flat $9.99 guest shipping fee', () => {
    expect(GUEST_SHIPPING_CENTS).toBe(999);
  });
});

describe('shippingCentsFor', () => {
  test('returns 0 for a signed-in member', () => {
    const result = shippingCentsFor(true);

    expect(result).toBe(0);
  });

  test('returns the flat guest fee for a non-member', () => {
    const result = shippingCentsFor(false);

    expect(result).toBe(GUEST_SHIPPING_CENTS);
  });
});

describe('mirror parity with src/lib/shipping.ts', () => {
  test('GUEST_SHIPPING_CENTS matches the client display mirror', () => {
    expect(GUEST_SHIPPING_CENTS).toBe(CLIENT_GUEST_SHIPPING_CENTS);
  });

  test('shippingCentsFor agrees with the client mirror for both inputs', () => {
    expect(shippingCentsFor(true)).toBe(clientShippingCentsFor(true));
    expect(shippingCentsFor(false)).toBe(clientShippingCentsFor(false));
  });
});
