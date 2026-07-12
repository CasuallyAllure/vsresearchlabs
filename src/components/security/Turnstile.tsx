/**
 * Turnstile — Cloudflare bot-protection widget.
 *
 * Renders the managed challenge and hands the resulting token up via onToken.
 * The token rides along in the form payload; the edge function verifies it
 * server-side (gated on TURNSTILE_SECRET) before creating an order / inquiry /
 * contact message. The site key is public by design.
 *
 * Requires CSP allowances for https://challenges.cloudflare.com (script + frame).
 */

import { useEffect, useRef } from 'react';

const SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '0x4AAAAAADljF3YJFPSh1sz2';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileAPI {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface Props {
  /** Called with the verification token, or null when it expires/errors. */
  onToken: (token: string | null) => void;
  className?: string;
}

export function Turnstile({ onToken, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;
    loadTurnstile()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          theme: 'light',
          // Fill the host column instead of Cloudflare's fixed 300px "normal"
          // size — the cart drawer's checkout column is ~297px on a 375px phone.
          size: 'flexible',
          callback: (token: string) => cb.current(token),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
    };
  }, []);

  return <div ref={ref} className={className} />;
}
