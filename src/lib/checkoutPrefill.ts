/**
 * checkoutPrefill — fill a signed-in member's saved details into a checkout form.
 *
 * Both cart surfaces read only `user` from useCustomerAuth and never touched
 * `profile`, so a member with a complete `customer_profiles` row still retyped
 * their name, organization and full shipping address on every single order.
 *
 * The rules, in the order they matter:
 *
 *   1. Prefill POPULATES state; it never bypasses state. Everything here writes
 *      through the form's own `useState` setters and nothing else, so "what is
 *      submitted is whatever is in the form at submit time" stays true by
 *      construction. Nothing in this module is reachable from a submit handler.
 *   2. Fill only empty fields, only once (see useCheckoutPrefill). The session
 *      resolves asynchronously, so the buyer may have started typing first, and
 *      clearing a field afterwards is a deliberate act we do not fight.
 *   3. Everything stays editable — no readOnly, no disabled, no toggle that
 *      hides the values behind a "use my saved address" affordance.
 *   4. A saved NON-US address is deliberately withheld, not prefilled. Both
 *      checkout payloads hard-code `ship_country: 'US'` (CartPage.tsx,
 *      CartDrawer.tsx) and both state inputs cap at 2-3 uppercase characters,
 *      so prefilling e.g. an Ontario address would post a Canadian street to a
 *      US-locked payload and silently mis-ship. We surface the country instead:
 *      `withheldCountry` is returned so the form can say so out loud. Giving
 *      checkout a real country field is a separate, larger change.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CustomerProfile } from './customerProfile';

/** Every form field this module knows how to offer a value for. */
export type CheckoutPrefillField =
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'organization'
  | 'street'
  | 'city'
  | 'state'
  | 'zip';

export type CheckoutPrefillFields = Record<CheckoutPrefillField, string>;

export interface CheckoutPrefillPlan {
  /** Values on offer. An empty string means "nothing to offer for this field". */
  fields: CheckoutPrefillFields;
  /** The saved country when it is NOT US — the address is withheld, not filled. */
  withheldCountry: string | null;
  /** True when at least one field carries a value worth writing. */
  hasValues: boolean;
}

const EMPTY_FIELDS: CheckoutPrefillFields = {
  name: '',
  firstName: '',
  lastName: '',
  organization: '',
  street: '',
  city: '',
  state: '',
  zip: '',
};

/** Spellings of the United States we accept as "the US-only payload is fine". */
const US_COUNTRY_NAMES = new Set([
  'US',
  'USA',
  'UNITED STATES',
  'UNITED STATES OF AMERICA',
]);

/**
 * Is this saved country shippable through a payload that hard-codes 'US'?
 *
 * An unset country counts as yes: it is the pre-existing state of most profile
 * rows and the form already assumes US. A country we do not recognize counts
 * as no — the safe direction is to withhold and say so.
 */
export function isUsShipTo(country: string | null | undefined): boolean {
  const normalized = (country ?? '').trim().replace(/\./g, '').toUpperCase();
  if (normalized.length === 0) return true;
  return US_COUNTRY_NAMES.has(normalized);
}

/** Split a stored full name into the drawer's first/last inputs, on the LAST space. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  const cut = trimmed.lastIndexOf(' ');
  if (cut < 0) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, cut), lastName: trimmed.slice(cut + 1) };
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * The prefill decision, pure. A null profile (guest, or a signed-in account
 * whose row hasn't materialized) offers nothing at all.
 */
export function checkoutPrefillPlan(profile: CustomerProfile | null | undefined): CheckoutPrefillPlan {
  if (!profile) {
    return { fields: EMPTY_FIELDS, withheldCountry: null, hasValues: false };
  }

  const name = text(profile.full_name);
  const { firstName, lastName } = splitFullName(name);
  const usShippable = isUsShipTo(profile.country);

  // Neither checkout form has a line-2 input, so the two lines fold into one.
  const street = [text(profile.address_line1), text(profile.address_line2)]
    .filter((part) => part.length > 0)
    .join(', ');

  const fields: CheckoutPrefillFields = {
    name,
    firstName,
    lastName,
    organization: text(profile.business_name),
    // Rule 4: a non-US address is withheld from a US-locked payload.
    street: usShippable ? street : '',
    city: usShippable ? text(profile.city) : '',
    state: usShippable ? text(profile.state) : '',
    zip: usShippable ? text(profile.postal_code) : '',
  };

  return {
    fields,
    withheldCountry: usShippable ? null : text(profile.country),
    hasValues: Object.values(fields).some((value) => value.length > 0),
  };
}

/**
 * Keep whatever the buyer has typed; otherwise take the saved value. Mirrors
 * contactWithAccountEmail (src/lib/useAccountEmailPrefill.ts) exactly.
 */
export function keepTypedValue(current: string, offered: string): string {
  return current.trim().length > 0 ? current : offered;
}

/** Form setters to write into, keyed by field. Absent keys are simply not written. */
export type CheckoutPrefillSetters = Partial<
  Record<CheckoutPrefillField, Dispatch<SetStateAction<string>>>
>;

export interface CheckoutPrefillStatus {
  /** True once a saved shipping address has actually been written in. */
  addressPrefilled: boolean;
  /** Set when a saved NON-US address was deliberately not prefilled. */
  withheldCountry: string | null;
}

/**
 * Prefill a checkout form from the signed-in member's saved profile.
 *
 * Anti-clobber is two independent guards:
 *   - a `useRef` that lets the write happen at most ONCE, on the first render
 *     where a profile carrying values is available (so a later profile reload,
 *     or any re-render, never re-asks); and
 *   - a per-field functional update (keepTypedValue) that defers to anything
 *     already typed, so even that single write cannot overwrite in-progress
 *     input or restore a field the buyer deliberately cleared.
 */
export function useCheckoutPrefill(
  profile: CustomerProfile | null | undefined,
  setters: CheckoutPrefillSetters,
): CheckoutPrefillStatus {
  const plan = useMemo(() => checkoutPrefillPlan(profile), [profile]);
  const applied = useRef(false);
  const [didApply, setDidApply] = useState(false);

  useEffect(() => {
    if (applied.current) return;
    if (!plan.hasValues) return;
    applied.current = true;

    // Object.entries only yields the keys this form actually passed.
    const entries = Object.entries(setters) as [
      CheckoutPrefillField,
      Dispatch<SetStateAction<string>>,
    ][];
    for (const [field, set] of entries) {
      const offered = plan.fields[field];
      if (offered.length === 0) continue;
      set((current) => keepTypedValue(current, offered));
    }
    setDidApply(true);
  }, [plan, setters]);

  return {
    addressPrefilled: didApply && plan.fields.street.length > 0,
    withheldCountry: plan.withheldCountry,
  };
}
