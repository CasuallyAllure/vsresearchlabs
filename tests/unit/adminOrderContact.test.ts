/**
 * Buyer contact on the admin order composer (085).
 *
 * The field went from "must be an email" to "email, phone, or nothing" so the
 * owner can raise an order for someone standing in front of him. Blank is the
 * whole point of the change; anything TYPED still has to be reachable, because
 * a half-entered fragment is worse than no contact at all — it looks like a way
 * to reach the buyer and isn't.
 */
import { describe, expect, test } from 'vitest';

import { contactLooksReachable } from '../../src/pages/admin/AdminNewOrder';

describe('buyer contact validation', () => {
  test('accepts blank — the walk-in case the field exists to allow', () => {
    expect(contactLooksReachable('')).toBe(true);
    expect(contactLooksReachable('   ')).toBe(true);
  });

  test('accepts an email address', () => {
    expect(contactLooksReachable('buyer@example.com')).toBe(true);
  });

  test('accepts phone numbers in the shapes people actually type', () => {
    for (const phone of ['5551234567', '555-123-4567', '(555) 123-4567', '+1 555 123 4567']) {
      expect(contactLooksReachable(phone)).toBe(true);
    }
  });

  test('rejects a fragment that can reach nobody', () => {
    for (const junk of ['buyer@', '@example.com', 'call him', '12345']) {
      expect(contactLooksReachable(junk)).toBe(false);
    }
  });
});
