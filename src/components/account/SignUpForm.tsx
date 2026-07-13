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
import { Turnstile } from '../security/Turnstile';
import type { SignUpInput, SignUpResult } from '../../lib/customerAuth';

interface SignUpFormProps {
  signUp: (input: SignUpInput, captchaToken?: string | null) => Promise<SignUpResult>;
  /** Called with the email when Supabase requires code confirmation — the
   *  parent swaps the whole card to the standalone OtpConfirm step. */
  onNeedsConfirmation: (email: string) => void;
  onSwitchToSignIn: () => void;
}

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Submit =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export function SignUpForm({ signUp, onNeedsConfirmation, onSwitchToSignIn }: SignUpFormProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const errors = {
    firstName: firstName.trim().length === 0 ? 'First name is required.' : null,
    lastName: lastName.trim().length === 0 ? 'Last name is required.' : null,
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

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    setSubmit({ kind: 'submitting' });
    const result = await signUp({
      fullName, email, password, phone,
      addressLine1, addressLine2, city, state: stateRegion, postalCode, country,
    }, captchaToken);

    if (!result.ok) {
      setSubmit({ kind: 'error', message: result.error ?? 'Could not create account.' });
      return;
    }
    if (result.needsConfirmation) {
      // Hand off to the standalone OtpConfirm card (avoids the flip-face bleed).
      onNeedsConfirmation(email.trim());
      return;
    }
    // else: auth state flips the user in; this form unmounts.
  }

  // ── Form ────────────────────────────────────────────────────────────────
  const submitting = submit.kind === 'submitting';
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-[var(--space-2-5)]">
      <div className="grid grid-cols-2 gap-[var(--space-2-5)]">
        <Field
          id="signup-firstname"
          label="First name"
          value={firstName}
          onChange={setFirstName}
          onBlur={() => setTouched(true)}
          error={show('firstName')}
          required
          autoComplete="given-name"
          placeholder="First"
          dense
        />
        <Field
          id="signup-lastname"
          label="Last name"
          value={lastName}
          onChange={setLastName}
          onBlur={() => setTouched(true)}
          error={show('lastName')}
          required
          autoComplete="family-name"
          placeholder="Last"
          dense
        />
      </div>

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
        dense
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
        dense
      />

      <Field
        id="signup-phone"
        label="Phone (optional)"
        type="tel"
        value={phone}
        onChange={setPhone}
        autoComplete="tel"
        placeholder="+1 555 000 0000"
        dense
      />

      <div className="mt-[var(--space-1)] pt-[var(--space-3)] border-t border-ink/[0.06]">
        <p className="text-[9.5px] uppercase tracking-[0.28em] text-ink/35 mb-[var(--space-2-5)]">
          Shipping address
        </p>
        <div className="space-y-[var(--space-2-5)]">
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
            dense
          />
          <Field
            id="signup-address2"
            label="Address line 2 (optional)"
            value={addressLine2}
            onChange={setAddressLine2}
            autoComplete="address-line2"
            placeholder="Apt, suite, unit"
            dense
          />
          <div className="grid grid-cols-2 gap-[var(--space-2-5)]">
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
              dense
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
              dense
            />
          </div>
          <div className="grid grid-cols-2 gap-[var(--space-2-5)]">
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
              dense
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
              dense
            />
          </div>
        </div>
      </div>

      {submit.kind === 'error' && (
        <p role="alert" className="text-[12px] text-[color:var(--color-status-error)]">
          {submit.message}
        </p>
      )}

      <Turnstile onToken={setCaptchaToken} />

      <Button variant="primary" size="md" fullWidth type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create Account'}
      </Button>

      <div className="pt-[var(--space-1)] border-t border-ink/[0.08]">
        <p className="pt-[var(--space-3)] text-center text-[13px] text-ink/65">
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
