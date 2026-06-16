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
 * before the "Enter Site" button enables. Acceptance is persisted in
 * localStorage under STORAGE_KEY so it doesn't re-prompt across visits.
 *
 * Behavior:
 *   - Body scroll locked while open
 *   - Background blur + dim so the landing video module is hinted at
 *     behind the glass card
 *   - ESC does NOT close — this is a legal gate, not a dismissable dialog
 */

import { useEffect, useState } from 'react';
import { DnaVMark } from './DnaVMark';

const STORAGE_KEY = 'vsrl_disclaimer_accepted_v1';

// Card geometry constants. The card is positioned so the DNA mark sits
// close to viewport center (matching the BrandLoader behind it) but
// nudged down by CARD_DROP_PX so the overall popup doesn't feel high
// on mobile — visual balance of the card mass beats perfect mark
// alignment.
const CARD_PADDING_TOP = 28;     // matches inline padding in card style
const MARK_SIZE = 64;            // DnaVMark size in the gate
const MARK_HALF = MARK_SIZE / 2; // distance from mark top to its center
const CARD_DROP_PX = 50;         // shift the whole card this many px below center-mark anchor
const CARD_RIGHT_PX = 12;        // nudge card this many px right of dead-center

export function DisclaimerGate() {
  const [open, setOpen] = useState(false);
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    try {
      const accepted = localStorage.getItem(STORAGE_KEY);
      if (!accepted) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function accept() {
    if (!age || !terms) return;
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage might be blocked (private mode etc); accept this session anyway.
    }
    setOpen(false);
  }

  if (!open) return null;

  const ready = age && terms;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dgate-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
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
        style={{
          // Anchor the card so the DNA mark's CENTER (which sits at
          // CARD_PADDING_TOP + MARK_HALF from the card's top edge) lines
          // up with the viewport's vertical center. That way the gate's
          // mark visually inherits the loader's mark position for a
          // seamless crossfade.
          position: 'absolute',
          top: `calc(50% - ${CARD_PADDING_TOP + MARK_HALF - CARD_DROP_PX}px)`,
          left: '50%',
          transform: `translateX(calc(-50% + ${CARD_RIGHT_PX}px))`,
          width: 'calc(100% - 40px)',
          maxWidth: 460,
          // Don't allow the card to extend below the viewport — let the
          // content scroll internally on short screens.
          maxHeight: `calc(100% - (50% - ${CARD_PADDING_TOP + MARK_HALF - CARD_DROP_PX}px) - 20px)`,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: `${CARD_PADDING_TOP}px 26px 24px`,
          background:
            'linear-gradient(135deg, rgba(251,249,244,0.88) 0%, rgba(251,249,244,0.66) 100%)',
          border: '1px solid rgba(255,255,255,0.45)',
          borderRadius: '16px',
          boxShadow:
            '0 24px 60px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.65), 0 0 0 1px rgba(52,114,122,0.10)',
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
              'linear-gradient(90deg, transparent, rgba(98,160,166,0.9), rgba(255,255,255,0.95), rgba(98,160,166,0.9), transparent)',
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
              'linear-gradient(135deg, rgba(98,160,166,0.16) 0%, transparent 40%, transparent 60%, rgba(52,114,122,0.12) 100%)',
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
            fontFamily: '"IBM Plex Mono", "Courier New", monospace',
            fontSize: '10px',
            letterSpacing: '0.3em',
            color: '#34727A',
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
            fontFamily:
              '"Cormorant Garamond", "EB Garamond", Garamond, Georgia, serif',
            fontWeight: 400,
            fontSize: '26px',
            color: '#1A1714',
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
            color: 'rgba(26,23,20,0.78)',
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
            border: '1px solid rgba(26,23,20,0.12)',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.55)',
            fontSize: '13px',
            color: '#1A1714',
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
              accentColor: '#34727A',
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
            marginBottom: '20px',
            border: '1px solid rgba(26,23,20,0.12)',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.55)',
            fontSize: '13px',
            color: '#1A1714',
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
              accentColor: '#34727A',
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

        <button
          type="button"
          onClick={accept}
          disabled={!ready}
          style={{
            position: 'relative',
            width: '100%',
            padding: '14px',
            background: ready ? '#1A1714' : 'rgba(26,23,20,0.22)',
            color: '#FBF9F4',
            border: 'none',
            borderRadius: '8px',
            fontFamily: '"IBM Plex Mono", "Courier New", monospace',
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
            fontSize: '9.5px',
            color: 'rgba(26,23,20,0.5)',
            textAlign: 'center',
            marginTop: '14px',
            fontFamily: '"IBM Plex Mono", "Courier New", monospace',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}
        >
          For Research Use Only · Not For Human Use
        </div>
      </div>
    </div>
  );
}
