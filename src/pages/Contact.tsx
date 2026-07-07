/**
 * Contact
 *
 * General-purpose contact intake form. Replaces the static info panel.
 * Submits via the `send-contact` Edge Function which:
 *   - validates the payload
 *   - persists to contact_messages (Supabase)
 *   - emails INQUIRY_TO_EMAIL with the full submission
 *   - emails the visitor a branded confirmation
 *
 * Mobile-first: stacked single-column inputs, generous tap targets,
 * sticky submit confirmation. Two warehouse locations + the inquiry
 * email are surfaced below the form so visitors who prefer direct
 * contact have an option.
 */

import { useState } from 'react';
import { siteConfig } from '../config';
import { supabase } from '../lib/supabase';
import { Turnstile } from '../components/security/Turnstile';
import { Button } from '../components/ui/Button';

type Topic = 'general' | 'procurement' | 'documentation' | 'partnership' | 'media' | 'other';

const TOPICS: Array<{ id: Topic; label: string; hint: string }> = [
  { id: 'general',       label: 'General Inquiry',           hint: 'Something else / not listed' },
  { id: 'procurement',   label: 'Procurement / Catalog',     hint: 'Catalog scoping, pricing, lead times' },
  { id: 'documentation', label: 'Documentation',             hint: 'COA / HPLC / Mass Spec request' },
  { id: 'partnership',   label: 'Partnership / Distribution',hint: 'Lab, distributor, or institutional partnership' },
  { id: 'media',         label: 'Media / Press',             hint: 'Press, podcast, or research feature' },
  { id: 'other',         label: 'Other',                     hint: 'Tell us in the message' },
];

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; referenceId: string }
  | { kind: 'error'; message: string };

export function Contact() {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [organization, setOrg]  = useState('');
  const [roleTitle, setRole]    = useState('');
  const [topic, setTopic]       = useState<Topic>('general');
  const [message, setMessage]   = useState('');
  const [referrer, setReferrer] = useState('');
  const [submit, setSubmit]     = useState<SubmitState>({ kind: 'idle' });
  const [tsToken, setTsToken]   = useState<string | null>(null);
  const [touched, setTouched]   = useState<{ name: boolean; email: boolean; message: boolean }>({
    name: false, email: false, message: false,
  });

  const nameEmpty    = name.trim().length === 0;
  const emailInvalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const messageShort = message.trim().length < 8;
  const showNameError    = touched.name    && nameEmpty;
  const showEmailError   = touched.email   && emailInvalid;
  const showMessageError = touched.message && messageShort;
  const formInvalid = nameEmpty || emailInvalid || messageShort || !tsToken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, message: true });
    if (formInvalid || submit.kind === 'submitting') return;

    if (!supabase) {
      setSubmit({ kind: 'error', message: 'Submission service is offline. Please email us directly.' });
      return;
    }

    setSubmit({ kind: 'submitting' });
    const { data, error } = await supabase.functions.invoke('send-contact', {
      body: {
        name:         name.trim(),
        email:        email.trim(),
        phone:        phone.trim() || undefined,
        organization: organization.trim() || undefined,
        role_title:   roleTitle.trim() || undefined,
        topic,
        message:      message.trim(),
        referrer:     referrer.trim() || undefined,
        turnstile_token: tsToken ?? undefined,
      },
    });

    if (error || !data?.success) {
      const msg = (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) ?? error?.message ?? 'Failed to send. Please try again.';
      setSubmit({ kind: 'error', message: msg });
      return;
    }
    setSubmit({ kind: 'success', referenceId: String(data.referenceId) });
  }

  // ── Success view ────────────────────────────────────────────────────────
  if (submit.kind === 'success') {
    return (
      <section className="pt-[var(--space-4)] pb-[var(--space-10)] max-w-[60ch]">
        <header className="mb-[var(--space-5)]">
          <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
            Message Filed
          </p>
          <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-3)]">
            <span className="font-light text-ink/85">Thanks, </span>
            <span className="font-light text-ink">we got it.</span>
          </h1>
        </header>

        <div className="research-surface-solid p-[var(--space-6)] mb-[var(--space-6)]">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink/40 mb-[var(--space-2)]">Reference</p>
          <p className="font-mono text-[18px] tabular-nums text-ink mb-[var(--space-4)]">{submit.referenceId}</p>
          <p className="holo-text-body text-[13px] leading-relaxed">
            A confirmation copy is on its way to <strong className="text-ink">{email}</strong>.
            Our team responds within one to two business days. If you have
            anything to add, simply reply to that email and it'll land on the
            same thread.
          </p>
        </div>

        <p className="holo-text-caption text-[10px] uppercase tracking-[0.25em] text-ink/40">
          For Research Purposes Only — Not for Human or Veterinary Use
        </p>
      </section>
    );
  }

  // ── Form view ───────────────────────────────────────────────────────────
  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-10)] max-w-[64ch] mx-auto">
      <header className="mb-[var(--space-5)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Open Inquiries
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink mb-[var(--space-4)]">
          <span className="font-light text-ink/85">Tell us </span>
          <span className="font-light text-ink">what you need.</span>
        </h1>
        <p className="holo-text-body text-[13px] sm:text-[14px] leading-relaxed max-w-[58ch]">
          A few questions about who you are and why you're reaching out — the
          more context up front, the better we can route your message. Itemized
          procurement requests still go through the inquiry cart on a product
          page; this form is for everything else.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-[var(--space-5)]">
        {/* Topic — radio-style segmented control */}
        <fieldset>
          <legend className="block text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-[var(--space-2)]">
            What is this about?
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TOPICS.map((t) => {
              const on = topic === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTopic(t.id)}
                  aria-pressed={on}
                  className={[
                    'text-left rounded-md border px-3 py-2.5 transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40',
                    on
                      ? 'border-ink/40 bg-ink/[0.06]'
                      : 'border-ink/15 hover:border-ink/30',
                  ].join(' ')}
                >
                  <p className={`text-[12.5px] font-medium ${on ? 'text-ink' : 'text-ink/85'}`}>{t.label}</p>
                  <p className="text-[10.5px] text-ink/45 mt-0.5">{t.hint}</p>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
          <Field
            id="contact-name"
            label="Your name"
            value={name}
            onChange={setName}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            error={showNameError ? 'Name is required.' : null}
            required
            autoComplete="name"
            placeholder="First and last"
          />
          <Field
            id="contact-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            error={showEmailError ? 'A valid email is required.' : null}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-4)]">
          <Field
            id="contact-phone"
            label="Phone (optional)"
            type="tel"
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
            placeholder="+1 555 000 0000"
          />
          <Field
            id="contact-role"
            label="Role / title (optional)"
            value={roleTitle}
            onChange={setRole}
            autoComplete="organization-title"
            placeholder="Research scientist, PI, procurement…"
          />
        </div>

        <Field
          id="contact-organization"
          label="Organization or lab (optional)"
          value={organization}
          onChange={setOrg}
          autoComplete="organization"
          placeholder="University, lab, or institution"
        />

        {/* Message */}
        <div>
          <label
            htmlFor="contact-message"
            className="block text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-[var(--space-2)]"
          >
            What's your inquiry? <span className="text-ink/40 normal-case tracking-normal">— required</span>
          </label>
          <textarea
            id="contact-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, message: true }))}
            rows={6}
            placeholder="A few sentences on what you're trying to do, the research context, and what you need from us. The more specific you are, the faster we can route the right person."
            aria-invalid={showMessageError || undefined}
            className={[
              'w-full px-[var(--space-4)] py-[var(--space-3)] bg-base-700 border rounded-sm text-[14px] text-ink placeholder-ink/30 focus:outline-none transition-colors resize-y',
              showMessageError ? 'border-red-500/60 focus:border-red-400' : 'border-ink/15 focus:border-ink/40',
            ].join(' ')}
          />
          {showMessageError && (
            <p role="alert" className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400">
              Please share a few sentences.
            </p>
          )}
        </div>

        <Field
          id="contact-referrer"
          label="How did you find us? (optional)"
          value={referrer}
          onChange={setReferrer}
          placeholder="Search, referral, conference, paper, etc."
        />

        {submit.kind === 'error' && (
          <p role="alert" className="text-[12px] text-red-400">
            {submit.message}
          </p>
        )}

        <Turnstile onToken={setTsToken} />

        <div className="pt-[var(--space-2)]">
          <Button
            variant="primary"
            size="lg"
            type="submit"
            disabled={formInvalid || submit.kind === 'submitting'}
            className="w-full sm:w-auto"
          >
            {submit.kind === 'submitting' ? 'Sending…' : 'Send message'}
          </Button>
        </div>
      </form>

      {/* Direct contact + warehouses */}
      <div className="mt-[var(--space-12)] pt-[var(--space-8)] border-t border-ink/[0.08]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-4)]">
          Or reach us directly
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-6)] text-[12.5px]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-1)]">Email</p>
            <a
              href={`mailto:${siteConfig.contact.inquiryEmail}`}
              className="text-ink underline underline-offset-4 decoration-ink/20 hover:decoration-ink/60 transition-colors"
            >
              {siteConfig.contact.inquiryEmail}
            </a>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-1)]">Operations</p>
            <p className="text-ink/85 leading-relaxed">
              {siteConfig.brand.name}<br />
              {siteConfig.brand.operationsLine}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/45 mb-[var(--space-1)]">Warehouses</p>
            <p className="text-ink/85 leading-relaxed">
              <span className="text-ink">Sacramento, California</span> · <span className="text-ink">Vallejo, California</span>
            </p>
          </div>
        </div>
      </div>

      <p className="holo-text-caption mt-[var(--space-10)] text-[10px] uppercase tracking-[0.25em] text-ink/40">
        For Research Purposes Only — Not for Human or Veterinary Use
      </p>
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string | null;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  type?: string;
}

function Field({
  id, label, value, onChange, onBlur, error, required, autoComplete, placeholder, type = 'text',
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] uppercase tracking-[0.22em] text-ink/55 mb-[var(--space-2)]"
      >
        {label}
        {required && <span className="text-ink/40 normal-case tracking-normal"> — required</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={!!error || undefined}
        className={[
          'w-full px-[var(--space-4)] py-[var(--space-3)] bg-base-700 border rounded-sm text-[14px] text-ink placeholder-ink/30 focus:outline-none transition-colors',
          error ? 'border-red-500/60 focus:border-red-400' : 'border-ink/15 focus:border-ink/40',
        ].join(' ')}
      />
      {error && (
        <p role="alert" className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
