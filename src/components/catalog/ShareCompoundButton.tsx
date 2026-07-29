/**
 * ShareCompoundButton — the compound overlay's share affordance.
 *
 * Sits in the overlay chrome strip next to close. Uses the platform share
 * sheet when the browser offers one (mobile), and otherwise copies the
 * canonical /c/<slug> URL to the clipboard with a short inline confirmation.
 *
 * Deliberately quiet: same 40px ghost circle as the carousel/close controls,
 * gold only for the moment the confirmation is showing.
 */

import { useEffect, useRef, useState } from 'react';
import type { Product } from '../../types';
import { compoundShareUrl, shareDescription, shareTitle } from '../../lib/compoundShare';

/** How long the inline confirmation stays up. */
const CONFIRM_MS = 1900;

type Status = 'idle' | 'copied' | 'failed';

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  );
}

/** Clipboard write with a selection-based fallback for non-secure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or non-secure origin — fall through to the legacy path.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

export function ShareCompoundButton({ product }: { product: Product }) {
  const [status, setStatus] = useState<Status>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function flash(next: Status) {
    setStatus(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), CONFIRM_MS);
  }

  async function handleShare() {
    const url = compoundShareUrl(product);

    // Platform share sheet first where it exists (iOS / Android / some
    // desktop browsers). A dismissed sheet is not a failure — the user
    // chose not to share, so say nothing.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: shareTitle(product), text: shareDescription(product), url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Anything else (share unsupported for this payload, permission
        // policy) falls through to the clipboard path below.
      }
    }

    flash((await copyToClipboard(url)) ? 'copied' : 'failed');
  }

  const label = status === 'copied' ? 'Link copied' : status === 'failed' ? 'Copy failed' : null;

  return (
    // The confirmation is absolutely positioned: letting it take layout space
    // would shove the chrome strip's controls sideways the moment it appears.
    <div className="relative flex items-center">
      <style>{`
        @keyframes cio-share-confirm {
          from { opacity: 0; transform: translateX(4px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cio-share-confirm { animation: none !important; }
        }
      `}</style>
      {label && (
        <span
          className="cio-share-confirm pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 font-mono text-[10px] uppercase tracking-[0.16em] whitespace-nowrap"
          style={{
            color: status === 'failed' ? 'var(--color-content-tertiary)' : 'var(--color-accent-gold-dark)',
            animation: 'cio-share-confirm 200ms ease-out',
          }}
          role="status"
        >
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={handleShare}
        aria-label={`Share ${product.name} — copy link`}
        className="h-10 w-10 flex items-center justify-center rounded-full border border-ink/15 text-ink/60 transition-colors hover:text-ink hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
        style={status === 'copied' ? { color: 'var(--color-accent-gold-dark)', borderColor: 'color-mix(in srgb, var(--color-accent-gold-dark), transparent 55%)' } : undefined}
      >
        <ShareIcon />
      </button>
    </div>
  );
}
