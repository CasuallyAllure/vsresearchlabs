/**
 * Unit tests for src/lib/checkoutPrefill.ts — the PURE half.
 *
 * These pin the decision itself: what a saved profile offers each checkout
 * field, how the two address lines fold into the one street input both forms
 * actually have, and — the load-bearing one — that a saved NON-US address is
 * withheld rather than fed into a payload that hard-codes ship_country: 'US'.
 *
 * The React half (WHEN the write happens, and that it never fights the buyer)
 * is pinned in checkoutPrefill.hook.test.ts.
 */
import { describe, expect, test } from 'vitest';
import {
  checkoutPrefillPlan,
  isUsShipTo,
  keepTypedValue,
  splitFullName,
} from '../../src/lib/checkoutPrefill';
import type { CustomerProfile } from '../../src/lib/customerProfile';

function profileOf(patch: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    user_id: 'u1',
    full_name: 'Dana Okafor',
    phone: '+1 555 000 0000',
    address_line1: '1200 Research Parkway',
    address_line2: 'Suite 400',
    city: 'Sacramento',
    state: 'CA',
    postal_code: '95814',
    country: 'US',
    tier: 'member',
    status: 'active',
    free_shipping: false,
    account_type: 'business',
    business_name: 'Okafor Biolabs',
    marketing_opt_out: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

describe('checkoutPrefillPlan', () => {
  test('offers nothing at all for a guest (null profile)', () => {
    // Act
    const plan = checkoutPrefillPlan(null);

    // Assert — every field blank, so a guest form stays exactly as it is today.
    expect(plan.hasValues).toBe(false);
    expect(plan.withheldCountry).toBeNull();
    expect(Object.values(plan.fields).every((v) => v === '')).toBe(true);
  });

  test('offers nothing for an undefined profile (session still resolving)', () => {
    expect(checkoutPrefillPlan(undefined).hasValues).toBe(false);
  });

  test('maps a full US profile onto every checkout field', () => {
    // Act
    const plan = checkoutPrefillPlan(profileOf());

    // Assert
    expect(plan.fields).toEqual({
      name: 'Dana Okafor',
      firstName: 'Dana',
      lastName: 'Okafor',
      organization: 'Okafor Biolabs',
      street: '1200 Research Parkway, Suite 400',
      city: 'Sacramento',
      state: 'CA',
      zip: '95814',
    });
    expect(plan.withheldCountry).toBeNull();
    expect(plan.hasValues).toBe(true);
  });

  test('folds address_line2 in only when it is present', () => {
    expect(checkoutPrefillPlan(profileOf({ address_line2: null })).fields.street)
      .toBe('1200 Research Parkway');
    expect(checkoutPrefillPlan(profileOf({ address_line2: '   ' })).fields.street)
      .toBe('1200 Research Parkway');
  });

  test('a line2-only address does not emit a leading comma', () => {
    const plan = checkoutPrefillPlan(profileOf({ address_line1: null, address_line2: 'Suite 400' }));

    expect(plan.fields.street).toBe('Suite 400');
  });

  test('treats null and whitespace-only columns as absent, not as blanks to write', () => {
    // Arrange — a barely-filled profile: only a name.
    const plan = checkoutPrefillPlan(profileOf({
      business_name: null,
      address_line1: '  ',
      address_line2: null,
      city: null,
      state: '   ',
      postal_code: null,
    }));

    // Assert
    expect(plan.fields.name).toBe('Dana Okafor');
    expect(plan.fields.organization).toBe('');
    expect(plan.fields.street).toBe('');
    expect(plan.fields.city).toBe('');
    expect(plan.fields.state).toBe('');
    expect(plan.fields.zip).toBe('');
    expect(plan.hasValues).toBe(true);
  });

  test('an entirely empty profile row offers nothing', () => {
    const plan = checkoutPrefillPlan(profileOf({
      full_name: '',
      business_name: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
    }));

    expect(plan.hasValues).toBe(false);
  });

  test('trims stored whitespace rather than writing it into the form', () => {
    const plan = checkoutPrefillPlan(profileOf({ city: '  Sacramento  ', postal_code: ' 95814 ' }));

    expect(plan.fields.city).toBe('Sacramento');
    expect(plan.fields.zip).toBe('95814');
  });

  test('an unset country is treated as US — the form already assumed it', () => {
    const plan = checkoutPrefillPlan(profileOf({ country: null }));

    expect(plan.fields.street).toBe('1200 Research Parkway, Suite 400');
    expect(plan.withheldCountry).toBeNull();
  });

  // --- The ship_country trap -------------------------------------------------

  test('WITHHOLDS a non-US address instead of feeding it to a US-locked payload', () => {
    // Arrange — a Canadian profile. ship_country is hard-coded 'US' in both
    // checkout payloads, so prefilling this would silently mis-ship.
    const plan = checkoutPrefillPlan(profileOf({
      address_line1: '88 Bloor Street West',
      address_line2: null,
      city: 'Toronto',
      state: 'ON',
      postal_code: 'M5S 1M1',
      country: 'CA',
    }));

    // Assert — no address at all, and the country is surfaced for the UI to say so.
    expect(plan.fields.street).toBe('');
    expect(plan.fields.city).toBe('');
    expect(plan.fields.state).toBe('');
    expect(plan.fields.zip).toBe('');
    expect(plan.withheldCountry).toBe('CA');
  });

  test('a withheld non-US address still prefills the country-independent fields', () => {
    const plan = checkoutPrefillPlan(profileOf({ country: 'DE' }));

    expect(plan.fields.name).toBe('Dana Okafor');
    expect(plan.fields.organization).toBe('Okafor Biolabs');
    expect(plan.fields.street).toBe('');
    expect(plan.hasValues).toBe(true);
  });
});

describe('isUsShipTo', () => {
  test.each(['US', 'us', ' USA ', 'U.S.', 'U.S.A.', 'United States', 'UNITED STATES OF AMERICA'])(
    'accepts %j as the US',
    (country) => {
      expect(isUsShipTo(country)).toBe(true);
    },
  );

  test.each([null, undefined, '', '   '])('treats %j (unset) as the US', (country) => {
    expect(isUsShipTo(country)).toBe(true);
  });

  test.each(['CA', 'Canada', 'GB', 'Mexico', 'AU'])('rejects %j', (country) => {
    expect(isUsShipTo(country)).toBe(false);
  });
});

describe('splitFullName', () => {
  test('splits on the last space so compound given names survive', () => {
    expect(splitFullName('Ana Maria Okafor')).toEqual({ firstName: 'Ana Maria', lastName: 'Okafor' });
  });

  test('a single-token name becomes the first name with no last name', () => {
    expect(splitFullName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
  });

  test('collapses runaway whitespace before splitting', () => {
    expect(splitFullName('  Dana   Okafor  ')).toEqual({ firstName: 'Dana', lastName: 'Okafor' });
  });

  test('an empty name yields two empty fields', () => {
    expect(splitFullName('   ')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('keepTypedValue', () => {
  test('takes the saved value into an empty field', () => {
    expect(keepTypedValue('', 'Sacramento')).toBe('Sacramento');
  });

  test('takes the saved value into a whitespace-only field', () => {
    expect(keepTypedValue('   ', 'Sacramento')).toBe('Sacramento');
  });

  test('keeps what the buyer typed, verbatim', () => {
    expect(keepTypedValue('Davis', 'Sacramento')).toBe('Davis');
  });
});
