/**
 * CustomerInvite — shared "invite this guest" composer for the admin CRM.
 *
 * Why a sheet instead of a bare <a href="mailto:">: the admin runs the
 * console on an iPhone (often installed to the home screen), where a raw
 * mailto link can silently no-op — the same iOS behavior class that killed
 * window.confirm (see feedback: mobile-no-native-dialogs). The sheet keeps
 * everything in-app: preview + edit the message, then "Open in Mail" (mailto
 * from the CURRENT draft) or "Copy" as the always-works fallback.
 *
 * Points passed in must mirror migration 044's accrual —
 * floor(invoice_amount_cents/100) per PAID order, summed — so the number
 * promised in the email equals what the ledger will credit after signup.
 */

import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { siteConfig } from '../../config';

export interface InviteTarget {
  display_name: string;
  contact: string;
}

export function composeInvite(target: InviteTarget, points: number): { subject: string; body: string } {
  const firstName = target.display_name.trim().split(/\s+/)[0] || 'there';
  const signupUrl = `${window.location.origin}/account?mode=signup`;
  const subject = `${points.toLocaleString()} reward points are waiting for you at ${siteConfig.brand.name}`;
  const body =
    `Hi ${firstName},\n\n` +
    `Thank you for your orders with ${siteConfig.brand.name}. Based on what you've already spent with us, ` +
    `you've earned ${points.toLocaleString()} reward points (every $1 = 1 point) — they just need an account to live in.\n\n` +
    `Create your free account with this email address and we'll credit the full ${points.toLocaleString()} points to it:\n` +
    `${signupUrl}\n\n` +
    `Points are redeemable toward future orders, and members also get order history, tracking, and receipts in one place.\n\n` +
    `— ${siteConfig.brand.name}`;
  return { subject, body };
}

interface InviteSheetProps {
  target: InviteTarget;
  points: number;
  onClose: () => void;
}

type CopyState = 'idle' | 'copied' | 'failed';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: hidden-textarea fallback.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function InviteSheet({ target, points, onClose }: InviteSheetProps) {
  const initial = composeInvite(target, points);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [copied, setCopied] = useState<CopyState>('idle');

  const mailto = `mailto:${encodeURIComponent(target.contact)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  async function handleCopy() {
    const ok = await copyText(`To: ${target.contact}\nSubject: ${subject}\n\n${body}`);
    setCopied(ok ? 'copied' : 'failed');
    window.setTimeout(() => setCopied('idle'), 2000);
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" aria-label={`Invite ${target.display_name}`} className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto flex max-h-[86vh] w-full max-w-[440px] flex-col overflow-y-auto research-surface-solid p-[var(--space-5)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-1)]">Invite to sign up</p>
          <p className="mb-[var(--space-4)] font-mono text-[11px] tracking-[0.04em] text-holo-light/70">
            {target.display_name} · {points.toLocaleString()} pts to credit
          </p>

          <label className="mb-0.5 block text-[10px] uppercase tracking-[0.22em] text-ink/45">To</label>
          <p className="mb-[var(--space-3)] break-all font-mono text-[12px] text-ink/85">{target.contact}</p>

          <label className="mb-0.5 block text-[10px] uppercase tracking-[0.22em] text-ink/45">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mb-[var(--space-3)] w-full rounded-sm border border-ink/10 bg-base-700 px-[var(--space-3)] py-[var(--space-2)] text-[12.5px] text-ink focus:border-ink/40 focus:outline-none"
          />

          <label className="mb-0.5 block text-[10px] uppercase tracking-[0.22em] text-ink/45">Message — edit before sending</label>
          <textarea
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="mb-[var(--space-4)] w-full resize-y rounded-sm border border-ink/10 bg-base-700 px-[var(--space-3)] py-[var(--space-2)] text-[12.5px] leading-relaxed text-ink focus:border-ink/40 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
              {copied === 'copied' ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy text'}
            </Button>
            <a
              href={mailto}
              className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-ink/30 bg-ink/[0.10] px-[var(--space-5)] text-[10px] font-medium uppercase tracking-[0.22em] text-ink transition-colors hover:border-ink/40 hover:bg-ink/[0.15]"
            >
              Open in Mail
            </a>
          </div>
          <p className="mt-[var(--space-3)] text-[10.5px] leading-relaxed text-ink/45">
            If "Open in Mail" does nothing on this device, use "Copy text" and paste into any email app.
          </p>
        </div>
      </div>
    </>
  );
}
