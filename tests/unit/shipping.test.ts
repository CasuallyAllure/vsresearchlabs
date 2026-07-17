/**
 * Unit tests for src/lib/shipping.ts — the client-side shipping display mirror.
 *
 * This module is display-only (the cart's shipping row + membership nudge);
 * place-order recomputes the real charge server-side. The tests here pin the
 * owner's rule ("every signed-in member ships free; guests pay one flat fee")
 * and the exact GUEST_SHIPPING_CENTS constant, which must stay in sync with
 * the identically-named constant in supabase/functions/place-order/index.ts.
 */
import { describe, expect, test } from 'vitest';
import { GUEST_SHIPPING_CENTS, shippingCentsFor } from '../../src/lib/shipping';

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
