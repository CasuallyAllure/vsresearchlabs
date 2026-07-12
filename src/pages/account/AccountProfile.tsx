/**
 * AccountProfile — /account/profile
 *
 * Edit the customer-editable subset of the profile (name, phone, shipping
 * address) via the existing `updateMyProfile` + `reloadProfile` seam. Guarded
 * columns (tier, status, account_type, business_name) are display-only here —
 * they change only through the admin RPC, and the 043 trigger pins them
 * server-side regardless of what a client sends.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AccountLayout } from './AccountLayout';
import { useCustomerAuth } from '../../lib/customerAuth';
import { updateMyProfile, type CustomerProfilePatch } from '../../lib/customerProfile';
import { Field } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

interface FormValues {
  full_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

function ProfileForm() {
  const { user, profile, reloadProfile } = useCustomerAuth();

  const initial: FormValues = useMemo(
    () => ({
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      address_line1: profile?.address_line1 ?? '',
      address_line2: profile?.address_line2 ?? '',
      city: profile?.city ?? '',
      state: profile?.state ?? '',
      postal_code: profile?.postal_code ?? '',
      country: profile?.country ?? '',
    }),
    [profile],
  );

  const [values, setValues] = useState<FormValues>(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  // AccountLayout only renders children when user && profile exist.
  if (!user || !profile) return null;

  const set = (key: keyof FormValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (save.kind === 'saved' || save.kind === 'error') setSave({ kind: 'idle' });
  };

  const nameError =
    values.full_name.trim().length === 0 ? 'Your name is required.' : null;
  const dirty = (Object.keys(values) as (keyof FormValues)[]).some(
    (k) => values[k] !== initial[k],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameError || save.kind === 'saving') return;

    const patch: CustomerProfilePatch = {
      full_name: values.full_name.trim(),
      phone: values.phone.trim() || null,
      address_line1: values.address_line1.trim() || null,
      address_line2: values.address_line2.trim() || null,
      city: values.city.trim() || null,
      state: values.state.trim() || null,
      postal_code: values.postal_code.trim() || null,
      country: values.country.trim() || null,
    };

    setSave({ kind: 'saving' });
    try {
      await updateMyProfile(user.id, patch);
      await reloadProfile();
      setSave({ kind: 'saved' });
    } catch (error: unknown) {
      setSave({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to update profile.',
      });
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="research-surface-solid p-[var(--space-5)]">
      <h2 className="holo-text-caption mb-[var(--space-4)] text-[10px] uppercase tracking-[0.3em] text-ink/50">
        Contact &amp; shipping details
      </h2>

      <div className="grid grid-cols-1 gap-[var(--space-3)]">
        <Field
          id="profile-name"
          label="Full name"
          value={values.full_name}
          onChange={set('full_name')}
          error={save.kind !== 'idle' ? nameError : null}
          required
          autoComplete="name"
        />
        <Field
          id="profile-phone"
          label="Phone"
          value={values.phone}
          onChange={set('phone')}
          autoComplete="tel"
          type="tel"
        />
        <Field
          id="profile-address1"
          label="Address line 1"
          value={values.address_line1}
          onChange={set('address_line1')}
          autoComplete="address-line1"
        />
        <Field
          id="profile-address2"
          label="Address line 2"
          value={values.address_line2}
          onChange={set('address_line2')}
          autoComplete="address-line2"
        />
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-[1fr_100px_140px]">
          <Field
            id="profile-city"
            label="City"
            value={values.city}
            onChange={set('city')}
            autoComplete="address-level2"
          />
          <Field
            id="profile-state"
            label="State"
            value={values.state}
            onChange={set('state')}
            autoComplete="address-level1"
          />
          <Field
            id="profile-zip"
            label="Postal code"
            value={values.postal_code}
            onChange={set('postal_code')}
            autoComplete="postal-code"
          />
        </div>
        <Field
          id="profile-country"
          label="Country"
          value={values.country}
          onChange={set('country')}
          autoComplete="country-name"
        />
      </div>

      <div
        className="mt-[var(--space-4)] flex flex-col-reverse items-stretch gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
      >
        <p className="holo-text-caption text-[10px] tracking-[0.12em] text-ink/45">
          {save.kind === 'saved' && 'Saved. Future invoices use these details.'}
          {save.kind === 'error' && (
            <span className="holo-text-warning">{save.message}</span>
          )}
          {(save.kind === 'idle' || save.kind === 'saving') &&
            'Email changes aren’t supported yet — contact us if yours changed.'}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!dirty || save.kind === 'saving' || Boolean(nameError)}
        >
          {save.kind === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

export function AccountProfile() {
  return (
    <AccountLayout>
      <ProfileForm />
    </AccountLayout>
  );
}

export default AccountProfile;
