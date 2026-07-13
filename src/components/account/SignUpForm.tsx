/**
 * SignUpForm — the back face of the auth card (the "fill-out").
 *
 * Collects the full customer profile: name, email, password, phone, and a
 * shipping address. On success with email-confirmation enabled it swaps to a
 * "check your inbox" panel; otherwise the auth state flips the user straight
 * into their account.
 */

import { useState } from 'react';
import { Field } from '../ui/Field';
import { PasswordField } from './PasswordField';
import { Button } from '../ui/Button';
import type { SignUpInput, SignUpResult } from '../../lib/customerAuth';

interface SignUpFormProps {
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  onSwitchToSignIn: () => void;
}

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Submit =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'confirm'; email: string }
  | { kind: 'error'; message: string };

export function SignUpForm({ signUp, onSwitchToSignIn }: SignUpFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('United States');
  const [submit, setSubmit] = useState<Submit>({ kind: 'idle' });
  const [touched, setTouched] = useState(false);

  const errors = {
    fullName: fullName.trim().length === 0 ? 'Your full name is required.' : null,
    email: !EMAIL_RE.test(email.trim()) ? 'A valid email is required.' : null,
    password: password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : null,
    addressLine1: addressLine1.trim().length === 0 ? 'Street address is required.' : null,
    city: city.trim().length === 0 ? 'City is required.' : null,
    state: stateRegion.trim().length === 0 ? 'State / region is required.' : null,
    postalCode: postalCode.trim().length === 0 ? 'Postal code is required.' : null,
    country: country.trim().length === 0 ? 'Country is required.' : null,
  };
  const formInvalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (formInvalid || submit.kind === 'submitting') return;

    setSubmit({ kind: 'submitting' });
    const result = await signUp({
      fullName, email, password, phone,
      addressLine1, addressLine2, city, state: stateRegion, postalCode, country,
    });

    if (!result.ok) {
      setSubmit({ kind: 'error', message: result.error ?? 'Could not create account.' });
      return;
    }
    if (result.needsConfirmation) {
      setSubmit({ kind: 'confirm', email: email.trim() });
    }
    // else: auth state flips the user in; this form unmounts.
  }

  // ── Confirmation panel ──────────────────────────────────────────────────
  if (submit.kind === 'confirm') {
    return (
      <div className="text-center py-[var(--space-4)]">
        <div className="mx-auto mb-[var(--space-5)] flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-status-successMuted)] text-[var(--color-status-success)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 6h16v12H4z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="font-serif text-[1.5rem] text-ink mb-[var(--space-2)]">Check your inbox</h3>
        <p className="text-[13.5px] leading-relaxed text-ink/70 mb-[var(--space-6)]">
          We sent a confirmation link to{' '}
          <strong className="text-ink">{submit.email}</strong>. Click it to
          activate your account, then come back and sign in.
        </p>
        <button
          type="button"
          onClick={onSwitchToSignIn}
          className="text-[12px] uppercase tracking-[0.2em] text-teal hover:text-teal-dark transition-colors"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  const submitting = submit.kind === 'submitting';
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-[var(--space-4)]">
      <Field
        id="signup-fullname"
        label="Full name"
        value={fullName}
        onChange={setFullName}
        onBlur={() => setTouched(true)}
        error={show('fullName')}
        required
        autoComplete="name"
        placeholder="First and last"
      />

      <Field
        id="signup-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        onBlur={() => setTouched(true)}
        error={show('email')}
        required
        autoComplete="email"
        placeholder="you@example.com"
      />

      <PasswordField
        id="signup-password"
        label="Password"
        value={password}
        onChange={setPassword}
        onBlur={() => setTouched(true)}
        error={show('password')}
        required
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD} characters`}
      />

      <Field
        id="signup-phone"
        label="Phone (optional)"
        type="tel"
        value={phone}
        onChange={setPhone}
        autoComplete="tel"
        placeholder="+1 555 000 0000"
      />

      <div className="pt-[var(--space-2)]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-3)]">
          Shipping address
        </p>
        <div className="space-y-[var(--space-4)]">
          <Field
            id="signup-address1"
            label="Address line 1"
            value={addressLine1}
            onChange={setAddressLine1}
            onBlur={() => setTouched(true)}
            error={show('addressLine1')}
            required
            autoComplete="address-line1"
            placeholder="Street address"
          />
          <Field
            id="signup-address2"
            label="Address line 2 (optional)"
            value={addressLine2}
            onChange={setAddressLine2}
            autoComplete="address-line2"
            placeholder="Apt, suite, unit"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
            <Field
              id="signup-city"
              label="City"
              value={city}
              onChange={setCity}
              onBlur={() => setTouched(true)}
              error={show('city')}
              required
              autoComplete="address-level2"
              placeholder="City"
            />
            <Field
              id="signup-state"
              label="State / region"
              value={stateRegion}
              onChange={setStateRegion}
              onBlur={() => setTouched(true)}
              error={show('state')}
              required
              autoComplete="address-level1"
              placeholder="State"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
            <Field
              id="signup-postal"
              label="Postal code"
              value={postalCode}
              onChange={setPostalCode}
              onBlur={() => setTouched(true)}
              error={show('postalCode')}
              required
              autoComplete="postal-code"
              placeholder="ZIP / postal"
            />
            <Field
              id="signup-country"
              label="Country"
              value={country}
              onChange={setCountry}
              onBlur={() => setTouched(true)}
              error={show('country')}
              required
              autoComplete="country-name"
              placeholder="Country"
            />
          </div>
        </div>
      </div>

      {submit.kind === 'error' && (
        <p role="alert" className="text-[12px] text-[color:var(--color-status-error)]">
          {submit.message}
        </p>
      )}

      <Button variant="primary" size="md" fullWidth type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create Account'}
      </Button>

      <div className="pt-[var(--space-2)] border-t border-ink/[0.08]">
        <p className="pt-[var(--space-4)] text-center text-[13px] text-ink/65">
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignIn}
            className="font-medium text-teal hover:text-teal-dark underline underline-offset-4 decoration-teal/30 hover:decoration-teal/60 transition-colors"
          >
            Sign In
          </button>
        </p>
      </div>
    </form>
  );
}
