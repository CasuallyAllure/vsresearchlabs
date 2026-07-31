// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/checkoutPrefill.ts — the React hook half.
 *
 * The pure decision is pinned in checkoutPrefill.test.ts; these pin WHEN the
 * write happens: never for a guest, once on the first render where a profile
 * carrying values arrives (the session resolves asynchronously, so that is
 * usually NOT the first render), and never again afterwards.
 *
 * The two anti-clobber guards are asserted separately, because they defend
 * different failures: the ref stops a second write entirely, and the
 * functional updater stops the single write from overwriting a field the
 * buyer had already typed into or deliberately cleared.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useCheckoutPrefill } from '../../src/lib/checkoutPrefill';
import type { CustomerProfile } from '../../src/lib/customerProfile';

function profileOf(patch: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    user_id: 'u1',
    full_name: 'Dana Okafor',
    phone: null,
    address_line1: '1200 Research Parkway',
    address_line2: null,
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

function renderPrefill(initialProfile: CustomerProfile | null) {
  const setters = {
    name: vi.fn(),
    organization: vi.fn(),
    street: vi.fn(),
    city: vi.fn(),
    state: vi.fn(),
    zip: vi.fn(),
  };
  const rendered = renderHook(
    ({ profile }: { profile: CustomerProfile | null }) => useCheckoutPrefill(profile, setters),
    { initialProps: { profile: initialProfile } },
  );
  return { setters, ...rendered };
}

/** Run the functional updater a setter was called with against a field's value. */
function applyTo(setter: ReturnType<typeof vi.fn>, current: string): string {
  const updater = setter.mock.calls[0][0] as (c: string) => string;
  return updater(current);
}

describe('useCheckoutPrefill', () => {
  test('writes nothing for a guest (no profile)', () => {
    const { setters, result } = renderPrefill(null);

    expect(setters.name).not.toHaveBeenCalled();
    expect(setters.street).not.toHaveBeenCalled();
    expect(result.current.addressPrefilled).toBe(false);
    expect(result.current.withheldCountry).toBeNull();
  });

  test('writes every offered field exactly once for a signed-in member', () => {
    const { setters, result } = renderPrefill(profileOf());

    expect(setters.name).toHaveBeenCalledTimes(1);
    expect(setters.organization).toHaveBeenCalledTimes(1);
    expect(setters.street).toHaveBeenCalledTimes(1);
    expect(setters.city).toHaveBeenCalledTimes(1);
    expect(setters.state).toHaveBeenCalledTimes(1);
    expect(setters.zip).toHaveBeenCalledTimes(1);
    expect(applyTo(setters.name, '')).toBe('Dana Okafor');
    expect(applyTo(setters.city, '')).toBe('Sacramento');
    expect(result.current.addressPrefilled).toBe(true);
  });

  test('skips fields the profile has no value for', () => {
    const { setters } = renderPrefill(profileOf({ business_name: null, postal_code: null }));

    expect(setters.name).toHaveBeenCalledTimes(1);
    expect(setters.organization).not.toHaveBeenCalled();
    expect(setters.zip).not.toHaveBeenCalled();
  });

  test('applies when the profile arrives AFTER the first render', () => {
    // Arrange — the session is still resolving on mount.
    const { setters, rerender } = renderPrefill(null);
    expect(setters.street).not.toHaveBeenCalled();

    // Act — loadMyProfile resolves.
    rerender({ profile: profileOf() });

    // Assert
    expect(setters.street).toHaveBeenCalledTimes(1);
  });

  test('a LATE profile does not clobber what the buyer already typed', () => {
    // Arrange — profile arrives after the buyer started filling the form.
    const { setters, rerender } = renderPrefill(null);
    rerender({ profile: profileOf() });

    // Act — apply the write against a field the buyer had already typed into.
    // Assert — their text survives; only genuinely empty fields take the saved value.
    expect(applyTo(setters.street, '77 Other Lab Road')).toBe('77 Other Lab Road');
    expect(applyTo(setters.city, 'Davis')).toBe('Davis');
    expect(applyTo(setters.zip, '')).toBe('95814');
  });

  test('never re-asks after the first write — a profile reload cannot restore a cleared field', () => {
    // Arrange — prefill has already applied.
    const { setters, rerender } = renderPrefill(profileOf());
    expect(setters.city).toHaveBeenCalledTimes(1);

    // Act — reloadProfile() hands back a fresh object (and even a new address).
    rerender({ profile: profileOf({ city: 'Fresno' }) });

    // Assert — the buyer's field is not touched a second time.
    expect(setters.city).toHaveBeenCalledTimes(1);
  });

  test('does not re-write on an incidental re-render with the same profile', () => {
    const profile = profileOf();
    const { setters, rerender } = renderPrefill(profile);

    rerender({ profile });
    rerender({ profile });

    expect(setters.name).toHaveBeenCalledTimes(1);
  });

  test('a non-US profile writes the name but no address, and reports the country', () => {
    const { setters, result } = renderPrefill(profileOf({ country: 'CA', city: 'Toronto' }));

    expect(setters.name).toHaveBeenCalledTimes(1);
    expect(setters.street).not.toHaveBeenCalled();
    expect(setters.city).not.toHaveBeenCalled();
    expect(setters.zip).not.toHaveBeenCalled();
    expect(result.current.addressPrefilled).toBe(false);
    expect(result.current.withheldCountry).toBe('CA');
  });

  test('only writes the setters the form actually passed', () => {
    // Arrange — the drawer has no organization input.
    const setFirstName = vi.fn();
    const setLastName = vi.fn();
    renderHook(() => useCheckoutPrefill(profileOf(), { firstName: setFirstName, lastName: setLastName }));

    // Assert
    expect(setFirstName).toHaveBeenCalledTimes(1);
    expect(setLastName).toHaveBeenCalledTimes(1);
    const first = setFirstName.mock.calls[0][0] as (c: string) => string;
    const last = setLastName.mock.calls[0][0] as (c: string) => string;
    expect(first('')).toBe('Dana');
    expect(last('')).toBe('Okafor');
  });
});
