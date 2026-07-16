/**
 * DisclaimerGate
 *
 * Glass / holographic age + research-use disclaimer that overlays the site
 * on first visit. Sits at z-9000 (above app content, below the BrandLoader
 * at z-9999 so the loader is never blocked by the gate).
 *
 * The buyer must:
 *   1. Confirm they are 21 or older
 *   2. Accept that purchases are research-only / not for human use
 *   3. Declare their industry (research lab / B2B / academic / …)
 * before the "Enter Site" button enables. Acceptance is persisted as a
 * structured record (timestamp + industry, see lib/researchAttestation) so
 * checkout can attach it to every order as a compliance audit trail.
 *
 * Behavior:
 *   - Body scroll locked while open
 *   - Focus is TRAPPED inside the dialog — Tab cannot reach the page behind,
 *     so the gate can't be walked past with a keyboard
 *   - Background blur + dim so the landing video module is hinted at
 *     behind the glass card
 *   - ESC does NOT close — this is a legal gate, not a dismissable dialog
 */

import { useEffect, useRef, useState } from 'react';
import { DnaVMark } from './DnaVMark';
import { useScrollLock } from '../../lib/useScrollLock';
import { siteConfig } from '../../config';
import { INDUSTRY_OPTIONS, readDisclaimerAcceptance, writeDisclaimerAcceptance } from '../../lib/researchAttestation';

// Card geometry. The gate is a normal centered modal — flex-centered in the
// viewport so it always lands in the middle of the screen on every device,
// scrolling internally on short screens.
const CARD_PADDING_TOP = 28;     // matches inline padding in card style
const MARK_SIZE = 64;            // DnaVMark size in the gate

export function DisclaimerGate() {
  // Show on first visit only — read storage during init (client-only SPA),
  // so there's no flash and no setState-in-effect. A valid STRUCTURED record
  // is required: the legacy v1 bare-timestamp value (different key) no longer
  // counts, so existing visitors re-attest once and declare an industry.
  const [open, setOpen] = useState(() => readDisclaimerAcceptance() === null);
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [industry, setIndustry] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  // Ref-counted lock — safe even when the intro modal stacks on top.
  useScrollLock(open);

  // Focus trap: while the gate is open, Tab cycles inside the card only.
  // Without this, keyboard focus walks straight out to the page behind the
  // scrim — a real bypass of the legal gate.
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const selector = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = card.querySelector<HTMLElement>(selector);
    first?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !cardRef.current) return;
      const nodes = Array.from(cardRef.current.querySelectorAll<HTMLElement>(selector));
      if (nodes.length === 0) return;
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !cardRef.current.contains(active)) {
        e.preventDefault();
        firstNode.focus();
      } else if (e.shiftKey && active === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  function accept() {
    if (!age || !terms || !industry) return;
    // Structured acceptance record — checkout attaches this to every order
    // so there's an audit trail that the buyer attested before purchasing.
    writeDisclaimerAcceptance(industry);
    setOpen(false);
    // Let downstream first-visit prompts (e.g. the member-access gate) hold
    // until the age/research disclaimer clears, so it's always shown first.
    try { window.dispatchEvent(new Event('vsr:disclaimer-accepted')); } catch { /* noop */ }
  }

  if (!open) return null;

  const ready = age && terms && industry !== '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dgate-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'rgba(26, 23, 20, 0.55)',
        backdropFilter: 'blur(10px) saturate(120%)',
        WebkitBackdropFilter: 'blur(10px) saturate(120%)',
        animation: 'vsrl-dgate-fade 220ms ease-out',
      }}
    >
      <style>{`
        @keyframes vsrl-dgate-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes vsrl-dgate-rise {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes vsrl-dgate-gleam {
          0%, 100% { transform: translateX(-30%); opacity: 0.35; }
          50%      { transform: translateX(30%);  opacity: 0.65; }
        }
      `}</style>

      <div
        ref={cardRef}
        style={{
          // Centered modal: the flex parent handles centering; the card just
          // caps its height to the viewport and scrolls internally if needed.
          position: 'relative',
          width: '100%',
          maxWidth: 460,
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: `${CARD_PADDING_TOP}px 26px 24px`,
          background:
            'linear-gradient(135deg, var(--color-surface-elevated) 0%, var(--color-surface-base) 100%)',
          border: '1px solid var(--color-border-default)',
          borderRadius: '16px',
          boxShadow:
            'var(--glass-highlight), 0 24px 60px rgba(0,0,0,0.40), 0 0 0 1px rgba(140,144,148,0.10)',
          backdropFilter: 'blur(16px) saturate(150%)',
          WebkitBackdropFilter: 'blur(16px) saturate(150%)',
          animation: 'vsrl-dgate-rise 340ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      >
        {/* Holographic moving gleam */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background:
              'linear-gradient(90deg, transparent, rgba(150,154,158,0.9), rgba(255,255,255,0.95), rgba(150,154,158,0.9), transparent)',
            animation: 'vsrl-dgate-gleam 3.6s ease-in-out infinite',
          }}
        />
        {/* Holographic color wash */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '16px',
            pointerEvents: 'none',
            background:
              'linear-gradient(135deg, rgba(150,154,158,0.16) 0%, transparent 40%, transparent 60%, rgba(140,144,148,0.12) 100%)',
            mixBlendMode: 'overlay',
          }}
        />

        {/* DNA logo — live mark (vector-crisp at any size). Sits at the
            top of the card content, so the card's top edge offset above
            (CARD_PADDING_TOP + MARK_HALF) lands this mark's center at
            viewport center. Same component the loader uses, so the
            loader → gate crossfade reads as one seal settling. */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '10px',
          }}
        >
          <DnaVMark size={MARK_SIZE} static />
        </div>

        {/* Eyebrow */}
        <div
          style={{
            position: 'relative',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.3em',
            color: '#868A90',
            textTransform: 'uppercase',
            textAlign: 'center',
            marginBottom: '6px',
          }}
        >
          Confirm Access
        </div>

        <h2
          id="dgate-title"
          style={{
            position: 'relative',
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: '26px',
            color: 'var(--color-content-primary)',
            textAlign: 'center',
            margin: '0 0 16px',
            letterSpacing: '0.01em',
            lineHeight: 1.15,
          }}
        >
          Research-Use Only
        </h2>

        <p
          style={{
            position: 'relative',
            fontSize: '13px',
            color: 'var(--color-content-secondary)',
            lineHeight: 1.55,
            margin: '0 0 18px',
            textAlign: 'center',
            fontFamily: 'Inter, system-ui, Arial, sans-serif',
          }}
        >
          All compounds offered on this site are for laboratory research and
          professional B2B use only. They are <strong>not</strong> intended for
          human or veterinary consumption. By entering, you confirm you are a
          qualified researcher or authorized purchaser.
        </p>

        <label
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 14px',
            marginBottom: '8px',
            border: '1px solid var(--color-border-default)',
            borderRadius: '8px',
            background: 'var(--color-interactive-secondary)',
            fontSize: '13px',
            color: 'var(--color-content-primary)',
            cursor: 'pointer',
            fontFamily: 'Inter, system-ui, Arial, sans-serif',
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            style={{
              accentColor: '#868A90',
              marginTop: '2px',
              width: 16,
              height: 16,
              flexShrink: 0,
            }}
          />
          <span>I am 21 years of age or older.</span>
        </label>

        <label
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '12px 14px',
            marginBottom: '14px',
            border: '1px solid var(--color-border-default)',
            borderRadius: '8px',
            background: 'var(--color-interactive-secondary)',
            fontSize: '13px',
            color: 'var(--color-content-primary)',
            cursor: 'pointer',
            fontFamily: 'Inter, system-ui, Arial, sans-serif',
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            style={{
              accentColor: '#868A90',
              marginTop: '2px',
              width: 16,
              height: 16,
              flexShrink: 0,
            }}
          />
          <span>
            I accept that purchases are <strong>for research only</strong> and
            not for human or animal consumption.
          </span>
        </label>

        {/* Declared industry — required, recorded with the acceptance and
            attached to every order as part of the compliance trail. */}
        <label
          htmlFor="dgate-industry"
          style={{
            position: 'relative',
            display: 'block',
            marginBottom: '20px',
            fontSize: '13px',
            color: 'var(--color-content-primary)',
            fontFamily: 'Inter, system-ui, Arial, sans-serif',
          }}
        >
          <span
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '11px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--color-content-tertiary)',
            }}
          >
            Purchasing on behalf of
          </span>
          <select
            id="dgate-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 14px',
              border: '1px solid var(--color-border-default)',
              borderRadius: '8px',
              background: 'var(--color-interactive-secondary)',
              color: industry ? 'var(--color-content-primary)' : 'var(--color-content-tertiary)',
              fontSize: '13px',
              fontFamily: 'Inter, system-ui, Arial, sans-serif',
              cursor: 'pointer',
              appearance: 'auto',
            }}
          >
            <option value="" disabled>
              Select your industry…
            </option>
            {INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={accept}
          disabled={!ready}
          style={{
            position: 'relative',
            width: '100%',
            padding: '14px',
            background: ready ? 'var(--color-content-primary)' : 'color-mix(in srgb, var(--color-content-primary) 25%, transparent)',
            color: 'var(--color-content-inverse)',
            border: 'none',
            borderRadius: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            cursor: ready ? 'pointer' : 'not-allowed',
            transition: 'background 220ms ease',
          }}
        >
          Enter Site
        </button>

        <div
          style={{
            position: 'relative',
            fontSize: '10px',
            color: 'var(--color-content-tertiary)',
            textAlign: 'center',
            marginTop: '14px',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}
        >
          {siteConfig.compliance.gateLine}
        </div>
      </div>
    </div>
  );
}
