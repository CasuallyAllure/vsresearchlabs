/**
 * SignInForm — the front face of the auth card.
 *
 * Email + password, a "forgot password" affordance, the primary gold CTA,
 * and a guest path so visitors can keep browsing without an account (the
 * store is open to guests today; logins are additive).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../ui/Field';
import { PasswordField } from './PasswordField';
import { Button } from '../ui/Button';
import { Turnstile } from '../security/Turnstile';

interface SignInFormProps {
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<boolean>;
  error: string | null;
  onSwitchToSignUp: () => void;
}

export function SignInForm({ signIn, error, onSwitchToSignUp }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    await signIn(email, password, captchaToken);
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-[var(--space-5)]">
      <Field
        id="signin-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        placeholder="you@example.com"
        dense
      />

      <div>
        <PasswordField
          id="signin-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Enter password"
          dense
        />
        <div className="mt-[var(--space-2)] text-right">
          <Link
            to="/track"
            className="text-[12px] text-teal hover:text-teal-dark underline underline-offset-4 decoration-teal/30 hover:decoration-teal/60 transition-colors"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[12px] text-[color:var(--color-status-error)]">
          {error}
        </p>
      )}

      <Turnstile onToken={setCaptchaToken} />

      <Button variant="primary" size="md" fullWidth type="submit" disabled={!canSubmit}>
        {submitting ? 'Signing in…' : 'Sign In'}
      </Button>

      <div className="pt-[var(--space-2)] border-t border-ink/[0.08]">
        <p className="pt-[var(--space-4)] text-center text-[13px] text-ink/65">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignUp}
            className="font-medium text-teal hover:text-teal-dark underline underline-offset-4 decoration-teal/30 hover:decoration-teal/60 transition-colors"
          >
            Create Account
          </button>
        </p>
      </div>

      <p className="text-center">
        <Link
          to="/catalog"
          className="text-[12px] uppercase tracking-[0.2em] text-ink/45 hover:text-ink/70 transition-colors"
        >
          Continue as guest →
        </Link>
      </p>
    </form>
  );
}
