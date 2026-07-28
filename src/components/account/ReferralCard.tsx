/**
 * ReferralCard — the member's referral requisition code (migration 076).
 *
 * Fetches on demand only: a "Get referral code" button drives the idempotent
 * `get_my_referral_code()` RPC (issues on first call, returns the same code
 * thereafter), then shows the code with a copy control. Same quiet statement
 * register as RewardTracker — factual research-supply copy, no growth
 * language. The clipboard fallback mirrors the copyText pattern in
 * src/pages/admin/CustomerInvite.tsx (older WebViews lack navigator.clipboard).
 */

import { useState } from 'react';
import { Button } from '../ui/Button';
import { getMyReferralCode, type ReferralCodeResult } from '../../lib/accountData';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error' }
  | { kind: 'ok'; result: ReferralCodeResult };

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

export function ReferralCard() {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [copied, setCopied] = useState<CopyState>('idle');

  async function load() {
    setState({ kind: 'working' });
    const { data, error } = await getMyReferralCode();
    if (error || !data) {
      setState({ kind: 'error' });
      return;
    }
    setState({ kind: 'ok', result: data });
  }

  async function handleCopy(code: string) {
    const ok = await copyText(code);
    setCopied(ok ? 'copied' : 'failed');
    window.setTimeout(() => setCopied('idle'), 2000);
  }

  return (
    <section aria-label="Referral code" className="floating-module p-[var(--space-6)]">
      <div className="flex items-baseline justify-between gap-[var(--space-3)] border-b border-ink/[0.09] pb-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Referral code</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/30">Requisition</p>
      </div>

      <p className="mt-[var(--space-4)] text-[12.5px] leading-relaxed text-ink/55">
        Share this requisition code with a colleague&rsquo;s laboratory. Orders placed with it
        receive 10% off; referral activity is recorded to your account. The code applies on its
        own and does not combine with other discounts.
      </p>

      {state.kind === 'ok' ? (
        <>
          <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
            <p className="font-mono text-[1.35rem] font-light tabular-nums tracking-[0.06em] text-ink">
              {state.result.code}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleCopy(state.result.code)}
            >
              {copied === 'copied' ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy'}
            </Button>
          </div>
          <p className="mt-[var(--space-3)] font-mono text-[11px] tabular-nums text-ink/45">
            Recorded uses: {state.result.uses.toLocaleString()}
          </p>
        </>
      ) : state.kind === 'error' ? (
        <p className="mt-[var(--space-4)] text-[12.5px] leading-relaxed text-ink/55">
          Referral codes are unavailable right now.
        </p>
      ) : (
        <div className="mt-[var(--space-4)]">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={load}
            disabled={state.kind === 'working'}
          >
            {state.kind === 'working' ? 'Retrieving…' : 'Get referral code'}
          </Button>
        </div>
      )}
    </section>
  );
}

export default ReferralCard;
