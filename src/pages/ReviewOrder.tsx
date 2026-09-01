/**
 * ReviewOrder — the completed-order review form, opened from the ask email
 * (`/review?t=<lookup_token>`).
 *
 * No account needed: authorization is the order's own 256-bit token (019), the
 * same secret the invoice email already carries. Both RPCs (089) re-check
 * eligibility server-side, so a stale link cannot open a form the order does
 * not qualify for.
 *
 * SCOPE IS THE POINT: this asks about FULFILMENT — packing, transit time,
 * documentation, communication. It never asks what the material did, because
 * published third-party text describing an effect would be an intended-use
 * claim on a research-supply catalog. The prompt says so in plain words.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/Button';
import { StarRating } from '../components/ui/StarRating';

type Prompt =
  | { state: 'loading' }
  | { state: 'ready'; orderNumber: string; name: string }
  | { state: 'done' }
  | { state: 'blocked'; message: string };

const COMMENT_MAX = 1000;

const BLOCKED_COPY: Record<string, string> = {
  not_found: 'This review link is not valid. Check the link in your email, or reply to it and we will send a new one.',
  not_eligible: 'This order is not ready for a review yet — the form opens a few days after delivery.',
  already_reviewed: 'Thank you — this order has already been reviewed.',
  bad_rating: 'Choose a rating from one to five stars.',
  comment_too_long: `Please keep the comment under ${COMMENT_MAX} characters.`,
};

function blockedCopy(reason: string | undefined): string {
  return BLOCKED_COPY[reason ?? ''] ?? 'Something went wrong. Please reply to the email and we will sort it out.';
}

export function ReviewOrder() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [prompt, setPrompt] = useState<Prompt>({ state: 'loading' });
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token || !supabase) {
        if (!cancelled) setPrompt({ state: 'blocked', message: blockedCopy('not_found') });
        return;
      }
      const { data, error: rpcError } = await supabase.rpc('order_review_prompt', { p_token: token });
      if (cancelled) return;
      if (rpcError) {
        setPrompt({ state: 'blocked', message: blockedCopy(undefined) });
        return;
      }
      const res = data as { ok?: boolean; reason?: string; orderNumber?: string; name?: string } | null;
      if (!res?.ok) {
        setPrompt({ state: 'blocked', message: blockedCopy(res?.reason) });
        return;
      }
      setPrompt({ state: 'ready', orderNumber: res.orderNumber ?? '', name: res.name ?? '' });
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  async function submit() {
    if (!supabase || rating < 1) { setError('Choose a rating from one to five stars.'); return; }
    setSubmitting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('submit_order_review', {
      p_token: token,
      p_rating: rating,
      p_comment: comment.trim() || undefined,
    });
    setSubmitting(false);
    if (rpcError) { setError(blockedCopy(undefined)); return; }
    const res = data as { ok?: boolean; reason?: string } | null;
    if (!res?.ok) { setError(blockedCopy(res?.reason)); return; }
    setPrompt({ state: 'done' });
  }

  return (
    <main className="mx-auto w-full max-w-[560px] px-[var(--space-5)] py-[var(--space-10)]">
      <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">Order feedback</p>

      {prompt.state === 'loading' && (
        <p className="text-[13px] text-ink/50">Loading…</p>
      )}

      {prompt.state === 'blocked' && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13.5px] leading-relaxed text-ink/70">{prompt.message}</p>
        </div>
      )}

      {prompt.state === 'done' && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <h1 className="mb-[var(--space-2)] text-[17px] font-medium text-ink">Thank you.</h1>
          <p className="text-[13.5px] leading-relaxed text-ink/65">
            Your feedback was received and is read before it is published.
          </p>
        </div>
      )}

      {prompt.state === 'ready' && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <h1 className="mb-[var(--space-2)] text-[17px] font-medium text-ink">
            How did {prompt.orderNumber ? `order ${prompt.orderNumber}` : 'your order'} arrive?
          </h1>
          <p className="mb-[var(--space-5)] text-[13px] leading-relaxed text-ink/60">
            We are asking about the order itself — packing, transit time, documentation and communication.
            Please do not include anything about use of the material; reviews describing use are not published.
          </p>

          <div className="mb-[var(--space-5)]">
            <span className="mb-[var(--space-2)] block text-[10px] uppercase tracking-[0.22em] text-ink/45">
              Fulfilment rating
            </span>
            <StarRating value={rating} onChange={setRating} />
          </div>

          <label className="block">
            <span className="mb-[var(--space-2)] block text-[10px] uppercase tracking-[0.22em] text-ink/45">
              Comment (optional)
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
              rows={5}
              maxLength={COMMENT_MAX}
              placeholder="Packaging, transit time, paperwork, anything we should fix."
              className="w-full rounded-field border border-ink/12 bg-base-700 px-3 py-2 text-[13px] text-ink placeholder-ink/30 focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15"
            />
            <span className="mt-1 block text-right font-mono text-[10px] text-ink/35">
              {comment.length}/{COMMENT_MAX}
            </span>
          </label>

          {error && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

          <div className="mt-[var(--space-5)]">
            <Button type="button" variant="primary" size="sm" disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Sending…' : 'Send feedback'}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
