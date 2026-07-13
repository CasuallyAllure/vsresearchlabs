/**
 * AccountProfile — /account/profile
 *
 * Shows the current profile as a clean read-only display first (full name,
 * phone, email, address) with an "Edit" action that reveals the pre-filled
 * form. Saving (or cancelling) returns to the display view. Uses the
 * existing `updateMyProfile` write path + guarded-column rules (name/phone/
 * address only) — email is display-only, sourced from the auth user, not the
 * profile row.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AccountLayout } from './AccountLayout';
import { useCustomerAuth } from '../../lib/customerAuth';
import { updateMyProfile, type CustomerProfilePatch, type CustomerProfile } from '../../lib/customerProfile';
import { Field } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

type ViewMode = 'display' | 'edit';

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

function valuesFromProfile(profile: CustomerProfile): FormValues {
  return {
    full_name: profile.full_name ?? '',
    phone: profile.phone ?? '',
    address_line1: profile.address_line1 ?? '',
    address_line2: profile.address_line2 ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    postal_code: profile.postal_code ?? '',
    country: profile.country ?? '',
  };
}

function DisplayRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-[0.2em] text-ink/45 mb-[var(--space-1)]">{label}</dt>
      <dd className="text-[13.5px] leading-relaxed text-ink">{value}</dd>
    </div>
  );
}

function ProfileDisplay({
  profile,
  email,
  onEdit,
}: {
  profile: CustomerProfile;
  email: string | undefined;
  onEdit: () => void;
}) {
  const hasAddress = !!profile.address_line1;

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)]">
        <h2 className="holo-text-caption text-[10px] uppercase tracking-[0.3em] text-ink/50">
          Contact &amp; shipping details
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2">
        <DisplayRow label="Full name" value={profile.full_name || '—'} />
        <DisplayRow label="Email" value={email ?? '—'} />
        <DisplayRow label="Phone" value={profile.phone || '—'} />
        <DisplayRow
          label="Shipping address"
          value={
            hasAddress ? (
              <address className="not-italic">
                {profile.address_line1}
                {profile.address_line2 ? <>, {profile.address_line2}</> : null}
                <br />
                {[profile.city, profile.state, profile.postal_code].filter(Boolean).join(', ')}
                <br />
                {profile.country}
              </address>
            ) : (
              <span className="text-ink/50">No shipping address on file yet.</span>
            )
          }
        />
      </dl>
    </div>
  );
}

function ProfileEditForm({
  profile,
  onSaved,
  onCancel,
}: {
  profile: CustomerProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { user, reloadProfile } = useCustomerAuth();
  const initial = useMemo(() => valuesFromProfile(profile), [profile]);
  const [values, setValues] = useState<FormValues>(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const set = (key: keyof FormValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (save.kind === 'error') setSave({ kind: 'idle' });
  };

  const nameError = values.full_name.trim().length === 0 ? 'Your name is required.' : null;
  const dirty = (Object.keys(values) as (keyof FormValues)[]).some((k) => values[k] !== initial[k]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || nameError || save.kind === 'saving') return;

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
      onSaved();
    } catch (error: unknown) {
      setSave({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update profile.',
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
          {save.kind === 'error' && <span className="holo-text-warning">{save.message}</span>}
          {save.kind !== 'error' && 'Email changes aren’t supported yet — contact us if yours changed.'}
        </p>
        <div className="flex gap-[var(--space-2)]">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={save.kind === 'saving'}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!dirty || save.kind === 'saving' || Boolean(nameError)}>
            {save.kind === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ProfileSection() {
  const { user, profile } = useCustomerAuth();
  const [mode, setMode] = useState<ViewMode>('display');

  // AccountLayout only renders children when user && profile exist.
  if (!user || !profile) return null;

  if (mode === 'edit') {
    return (
      <ProfileEditForm
        profile={profile}
        onSaved={() => setMode('display')}
        onCancel={() => setMode('display')}
      />
    );
  }

  return <ProfileDisplay profile={profile} email={user.email} onEdit={() => setMode('edit')} />;
}

export function AccountProfile() {
  return (
    <AccountLayout>
      <ProfileSection />
    </AccountLayout>
  );
}

export default AccountProfile;
