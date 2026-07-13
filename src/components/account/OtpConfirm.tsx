/**
 * OtpConfirm — the "enter your 6-digit code" step.
 *
 * Rendered as a STANDALONE card (not a flip face) so it can never overlap the
 * sign-in form: the flip card's two faces + iOS backface-visibility bled through
 * when this panel was shorter than the sign-in face. Own card, no bleed.
 *
 * The code is emailed by Supabase Auth (Confirm-signup template using
 * `{{ .Token }}`). verifyOtp confirms the account; on success the auth state
 * flips the user straight in and this unmounts. Resend gets its own captcha
 * token because Supabase requires one when CAPTCHA protection is enabled.
 */

import { useState } from 'react';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../ui/Field';
import { Button } from '../ui/Button';
import { Turnstile } from '../security/Turnstile';
import type { OtpResult } from '../../lib/customerAuth';

interface OtpConfirmProps {
  email: string;
  verifyOtp: (email: string, token: string) => Promise<OtpResult>;
  resendOtp: (email: string, captchaToken?: string | null) => Promise<OtpResult>;
  onBack: () => void;
}

export function OtpConfirm({ email, verifyOtp, resendOtp, onBack }: OtpConfirmProps) {
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Supabase's email OTP length is configurable (6–10 digits) — accept whatever
  // the project is set to rather than hardcoding one length.
  const ready = code.length >= 6 && !verifying;

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setVerifying(true);
    setError(null);
    const r = await verifyOtp(email, code);
    setVerifying(false);
    if (!r.ok) {
      setError(r.error ?? 'That code didn’t work. Check it and try again.');
      return;
    }
    // Success → auth state flips the user in; this unmounts.
  }

  async function handleResend() {
    setResent(false);
    setError(null);
    const r = await resendOtp(email, captchaToken);
    if (!r.ok) {
      setError(r.error ?? 'Could not resend the code. Try again shortly.');
      return;
    }
    setResent(true);
  }

  return (
    <form onSubmit={handleVerify} noValidate className="text-center">
      <h3 className="font-serif text-[1.6rem] leading-tight text-ink mb-[var(--space-2)]">
        Enter your code
      </h3>
      <p className="text-[13.5px] leading-relaxed text-ink/65 mb-[var(--space-6)]">
        We emailed a code to{' '}
        <strong className="text-ink break-words">{email}</strong>. Enter it below.
      </p>

      <label htmlFor="signup-otp" className="sr-only">Confirmation code</label>
      <input
        id="signup-otp"
        className={[FIELD_SURFACE, FIELD_DEFAULT, 'text-center font-mono text-[22px] tracking-[0.4em] pl-[0.4em]'].join(' ')}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={10}
        placeholder="Enter code"
        aria-invalid={error ? true : undefined}
        autoFocus
      />

      {error && (
        <p role="alert" className="mt-[var(--space-3)] text-[12px] text-[color:var(--color-status-error)]">
          {error}
        </p>
      )}
      {resent && !error && (
        <p role="status" className="mt-[var(--space-3)] text-[12px] text-[color:var(--color-status-success)]">
          A new code is on its way.
        </p>
      )}

      <div className="mt-[var(--space-6)]">
        <Button variant="primary" size="md" fullWidth type="submit" disabled={!ready}>
          {verifying ? 'Verifying…' : 'Verify & continue'}
        </Button>
      </div>

      {/* Hidden token source for the resend action; only surfaces a challenge
          when CAPTCHA protection is enabled on the project. */}
      <div className="mt-[var(--space-4)] flex justify-center">
        <Turnstile onToken={setCaptchaToken} />
      </div>

      <p className="mt-[var(--space-4)] text-[12.5px] text-ink/60">
        Didn’t get it?{' '}
        <button
          type="button"
          onClick={handleResend}
          className="font-medium text-teal hover:text-teal-dark underline underline-offset-4 decoration-teal/30 hover:decoration-teal/60 transition-colors"
        >
          Resend code
        </button>
      </p>
      <p className="mt-[var(--space-3)]">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] uppercase tracking-[0.2em] text-ink/45 hover:text-ink/70 transition-colors"
        >
          ← Back to sign in
        </button>
      </p>
    </form>
  );
}
