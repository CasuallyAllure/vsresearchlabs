/**
 * EntranceSequence — scroll-controlled entrance built from the approved
 * `Landing/Landing GIF.gif` artwork (121 pre-extracted WebP frames in
 * /landing-sequence, see scripts/buildLandingFrames.mjs).
 *
 * Flow:
 *   1. First Landing view of the session: frame 0 fills the viewport as a
 *      fixed canvas overlay — behind the DisclaimerGate (z-9000) when the
 *      disclaimer hasn't been accepted yet. The gate's body scroll lock
 *      keeps the sequence frozen while it is visible.
 *   2. Gate accepted → gate fades out (DisclaimerGate) → document scroll
 *      scrubs the frame sequence via an in-flow spacer sized from the
 *      frame count (entranceScrollDistance).
 *   3. Final frame reached (or "Skip intro") → the sequence FREEZES on the
 *      final frame ('holding') and, after a short pause, tells the parent
 *      (onFinalFrameHold) — Landing then fades the member-access prompt in
 *      above the frozen frame. Reaching the final frame does NOT open the
 *      site by itself.
 *   4. The parent flips `exit` (e.g. "Continue as guest") → completion is
 *      locked for the session (sessionStorage vsr.entranceDone) and the
 *      overlay cross-fades out over the real hero — no white flash, no
 *      vertical jump. onComplete fires after the fade.
 *
 * Engineering notes:
 *   - CONTAIN-fit rendering: the full 1080×1916 composition is always
 *     visible, centered, letterboxed on the dark backdrop — never cropped,
 *     never stretched, vials at their source proportions.
 *   - All frames are preloaded before scrubbing enables; body scroll stays
 *     locked (ref-counted useScrollLock) until they're ready, with a
 *     minimal brand loading indicator once the gate has cleared.
 *   - Scroll events only schedule a rAF; drawing happens at most once per
 *     frame tick and only when the frame index changed — no React state on
 *     the scroll path. Reverse/fast/slow scrolling all just re-map
 *     scrollY → frame index.
 *   - Overlay portals to <body> at z-70: above the site chrome (BottomNav
 *     z-50, header z-40), below the body-portaled MemberAccessGate (z-80)
 *     and the DisclaimerGate (z-9000).
 *   - prefers-reduced-motion: only the final frame is loaded, shown
 *     briefly once the gate clears, then the same hold → prompt flow runs.
 *   - "Skip intro" is a real focusable button (jumps to the final frame +
 *     prompt), and the scrub itself rides native document scroll —
 *     keyboard and AT users are never trapped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../lib/useScrollLock';
import { readDisclaimerAcceptance } from '../../lib/researchAttestation';
import {
  ENTRANCE_FRAME_COUNT,
  entranceFrameForProgress,
  entranceFrameSrc,
  entranceProgress,
  entranceScrollDistance,
  writeEntranceDone,
} from '../../lib/entranceSequence';

/** Overlay cross-fade into the hero on exit. */
const FADE_MS = 700;
/** Pause on the frozen final frame before the member prompt fades in. */
const HOLD_MS = 400;
/** Reduced-motion: how long the final frame holds before the prompt flow. */
const REDUCED_MOTION_HOLD_MS = 1400;
/** Parallel image requests while preloading. */
const PRELOAD_CONCURRENCY = 8;
/** Bail out (close the entrance) if more than this fraction of frames fail. */
const MAX_FAILURE_RATIO = 0.2;
/** Matches the artwork's dark graphite edges — letterbox + backdrop tone. */
const BACKDROP = '#17191c';

/** Brand gold — the single warm accent on the frosted trust badges. */
const BRAND_GOLD = '#B5904B';
/** COA check — a calm lab green, not a neon success green. */
const TRUST_GREEN = '#4FB07A';

/**
 * Trust-badge copy — approved, factual. TRUST_NETWORK_LINE is intentionally a
 * single editable constant: swap in a *verified* figure once one is confirmed
 * (e.g. `Trusted by 1,200+ research professionals`). Do NOT invent a count.
 */
const TRUST_NETWORK_LINE = 'Trusted by research professionals nationwide';
const BADGE_COA_LABEL = 'COA Verified';
const BADGE_COA_SUB = 'every lot';
const BADGE_PURITY_LABEL = '≥98% HPLC Purity';

/**
 * Scroll-progress band across which the trust badges fade in *as the vials
 * rise* (progress 0.5 ≈ frame 60, the vials clearing the bench), hold while
 * they float, then fade out — fully cleared before the final frame (progress
 * 1) freezes and the member-access prompt fades in over it.
 */
const BADGE_IN_START = 0.5;
const BADGE_IN_END = 0.62;
const BADGE_OUT_START = 0.82;
const BADGE_OUT_END = 0.92;

/** Trust-badge opacity for a scroll progress in [0, 1] (0 outside the band). */
function badgeOpacityForProgress(progress: number): number {
  if (progress <= BADGE_IN_START || progress >= BADGE_OUT_END) return 0;
  if (progress < BADGE_IN_END) {
    return (progress - BADGE_IN_START) / (BADGE_IN_END - BADGE_IN_START);
  }
  if (progress <= BADGE_OUT_START) return 1;
  return 1 - (progress - BADGE_OUT_START) / (BADGE_OUT_END - BADGE_OUT_START);
}

const LAST_FRAME = ENTRANCE_FRAME_COUNT - 1;

type Phase = 'loading' | 'active' | 'holding' | 'finishing';

interface EntranceSequenceProps {
  /** Fired once, ~HOLD_MS after the final frame froze — the parent shows
   *  the member-access prompt (or decides to exit straight away). */
  onFinalFrameHold: () => void;
  /** Flip true to close the entrance (e.g. "Continue as guest"): locks the
   *  session flag, cross-fades the overlay out, then fires onComplete. */
  exit: boolean;
  /** Fired after the exit cross-fade — the parent unmounts us. */
  onComplete: () => void;
}

export function EntranceSequence({ onFinalFrameHold, exit, onComplete }: EntranceSequenceProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadedCount, setLoadedCount] = useState(0);
  // Disclaimer gate state: open until the structured acceptance exists.
  // The gate itself fades on accept and fires vsr:disclaimer-accepted.
  const [gateOpen, setGateOpen] = useState(() => readDisclaimerAcceptance() === null);
  const [reduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const badgesRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastIndexRef = useRef(-1);
  const heldRef = useRef(false);
  const exitedRef = useRef(false);
  const onFinalFrameHoldRef = useRef(onFinalFrameHold);
  const onCompleteRef = useRef(onComplete);
  // Latest-callback refs, updated post-render (writing during render trips
  // react-hooks/refs). Both consumers fire from timeouts, never mid-render.
  useEffect(() => {
    onFinalFrameHoldRef.current = onFinalFrameHold;
    onCompleteRef.current = onComplete;
  });

  // Hold body scroll except while actively scrubbing (stacks safely with
  // the gates' own ref-counted locks).
  useScrollLock(phase !== 'active' || reduced);

  useEffect(() => {
    function onAccepted() {
      setGateOpen(false);
    }
    window.addEventListener('vsr:disclaimer-accepted', onAccepted);
    return () => window.removeEventListener('vsr:disclaimer-accepted', onAccepted);
  }, []);

  // The browser's scroll restoration must not drive the scrub: on reload,
  // Chrome re-applies the history entry's saved offset once the runway
  // spacer mounts — a stale deep offset would instantly "complete" the
  // sequence. Take manual control while the entrance owns the scroll and
  // start deterministically at frame 0; restore on unmount.
  useEffect(() => {
    try {
      window.history.scrollRestoration = 'manual';
    } catch { /* older browsers — restoration race stays theoretical */ }
    window.scrollTo(0, 0);
    return () => {
      // Back to the platform default. Not the captured previous value:
      // scrollRestoration persists per history entry across reloads, so
      // "previous" could itself be a stale 'manual' from an earlier visit
      // (nothing else in the app ever sets this).
      try {
        window.history.scrollRestoration = 'auto';
      } catch { /* noop */ }
    };
  }, []);

  /** Contain-draw one frame, DPR-aware: the full composition stays visible,
   *  centered, letterboxed on the backdrop — never cropped or stretched. */
  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    lastIndexRef.current = index;
  }, []);

  /** Final frame reached (scroll end or Skip): freeze it, then hand the
   *  moment to the parent after a short pause. Does NOT open the site. */
  const hold = useCallback(() => {
    if (heldRef.current) return;
    heldRef.current = true;
    drawFrame(LAST_FRAME);
    setPhase('holding');
    window.scrollTo(0, 0);
    window.setTimeout(() => onFinalFrameHoldRef.current(), HOLD_MS);
  }, [drawFrame]);

  // ── Exit (parent-driven, e.g. "Continue as guest") ─────────────────────
  useEffect(() => {
    if (!exit || exitedRef.current) return;
    exitedRef.current = true;
    writeEntranceDone();
    setPhase('finishing');
    const timer = window.setTimeout(() => onCompleteRef.current(), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [exit]);

  // ── Preload ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const images: (HTMLImageElement | null)[] = new Array(ENTRANCE_FRAME_COUNT).fill(null);
    imagesRef.current = images;
    // Reduced motion only ever shows the final frame — skip the rest.
    const indices = reduced
      ? [LAST_FRAME]
      : Array.from({ length: ENTRANCE_FRAME_COUNT }, (_, i) => i);
    let failures = 0;

    const load = (index: number, attempt = 0): Promise<void> =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          images[index] = img;
          if (!cancelled) setLoadedCount((c) => c + 1);
          resolve();
        };
        img.onerror = () => {
          if (attempt < 1) {
            void load(index, attempt + 1).then(resolve);
          } else {
            failures += 1;
            resolve();
          }
        };
        img.src = entranceFrameSrc(index);
      });

    async function run() {
      // First visible frame gets priority so the gate never sits on black.
      await load(indices[0]);
      if (cancelled) return;
      drawFrame(indices[0]);

      const rest = indices.slice(1);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: PRELOAD_CONCURRENCY }, async () => {
          while (cursor < rest.length && !cancelled) {
            const next = rest[cursor];
            cursor += 1;
            await load(next);
          }
        }),
      );
      if (cancelled) return;

      // Never block entry on missing media: too many failures (or a dead
      // first frame) → close the entrance instead of stranding the visitor.
      if (images[indices[0]] === null || failures > indices.length * MAX_FAILURE_RATIO) {
        heldRef.current = true;
        exitedRef.current = true;
        onCompleteRef.current();
        return;
      }
      // Patch isolated gaps with the nearest earlier frame so scrubbing
      // never hits a blank.
      for (let i = 1; i < images.length; i += 1) {
        if (images[i] === null) images[i] = images[i - 1];
      }
      setPhase('active');
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [reduced, drawFrame]);

  // ── Redraw on viewport resize (any phase — the gate can sit open a while) ─
  useEffect(() => {
    function onResize() {
      const index = lastIndexRef.current;
      if (index < 0) return;
      lastIndexRef.current = -1; // force the size-change path in drawFrame
      drawFrame(index);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawFrame]);

  // ── Scroll → frame scrubbing ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || reduced) return;
    const distance = entranceScrollDistance();

    function render() {
      rafRef.current = null;
      // Frozen: hold()'s own scrollTo(0,0) fires one last scroll event
      // before this listener detaches — it must not rewind the frame.
      if (heldRef.current) return;
      const progress = entranceProgress(window.scrollY, distance);
      const index = entranceFrameForProgress(progress);
      if (index !== lastIndexRef.current) drawFrame(index);
      if (cueRef.current) {
        cueRef.current.style.opacity = progress > 0.03 ? '0' : '1';
      }
      // Trust badges ride the same progress as the vials: fade in as they
      // rise, hold, fade out — a small upward drift reinforces the lift.
      if (badgesRef.current) {
        const o = badgeOpacityForProgress(progress);
        badgesRef.current.style.opacity = String(o);
        badgesRef.current.style.transform = `translateY(${(1 - o) * 12}px)`;
      }
      if (progress >= 1) hold();
    }
    function schedule() {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(render);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    schedule(); // sync immediately (covers refresh mid-sequence)
    return () => {
      window.removeEventListener('scroll', schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [phase, reduced, drawFrame, hold]);

  // ── Reduced motion: hold the final frame briefly, then the prompt flow ─
  useEffect(() => {
    if (phase !== 'active' || !reduced || gateOpen) return;
    drawFrame(LAST_FRAME);
    const timer = window.setTimeout(hold, REDUCED_MOTION_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, reduced, gateOpen, drawFrame, hold]);

  const loadedPct = Math.round((loadedCount / (reduced ? 1 : ENTRANCE_FRAME_COUNT)) * 100);
  const mono: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.28em',
    textTransform: 'uppercase',
  };

  // Frosted glass pill in the .glass-clear family (clear sheen over the dark
  // artwork, bright hairline edge + inner highlight). Shared by all badges.
  const badgePill: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(18,20,23,0.52)',
    border: '1px solid rgba(255,255,255,0.26)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.24), 0 10px 26px -14px rgba(0,0,0,0.7)',
    backdropFilter: 'blur(10px) saturate(160%)',
    WebkitBackdropFilter: 'blur(10px) saturate(160%)',
    color: 'rgba(255,255,255,0.92)',
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };

  // The overlay portals to <body>: GlobalSurface is `isolate`, so a fixed
  // element rendered inside it could never stack above the chrome that
  // lives outside it (BottomNav z-50), regardless of z-index.
  const overlay = createPortal(
      <div
        style={{
          position: 'fixed',
          inset: 0,
          // Above site chrome (BottomNav z-50, header z-40); below the
          // body-portaled MemberAccessGate (z-80) that fades in over the
          // frozen final frame, and the DisclaimerGate (z-9000).
          zIndex: 70,
          background: BACKDROP,
          opacity: phase === 'finishing' ? 0 : 1,
          transition: `opacity ${FADE_MS}ms ease`,
          pointerEvents: phase === 'finishing' ? 'none' : 'auto',
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="VS Research Labs entrance — research vials rising from the laboratory bench"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {/* Minimal brand loading indicator — only once the gate has cleared
            but frames are still arriving. */}
        {phase === 'loading' && !gateOpen && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 56,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span style={{ ...mono, color: 'rgba(255,255,255,0.7)' }}>
              VS Research Labs
            </span>
            <span
              aria-hidden="true"
              style={{ width: 120, height: 1, background: 'rgba(255,255,255,0.22)' }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${loadedPct}%`,
                  height: '100%',
                  background: 'rgba(255,255,255,0.85)',
                  transition: 'width 200ms ease',
                }}
              />
            </span>
            <span style={{ ...mono, fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>
              Preparing entrance · {loadedPct}%
            </span>
          </div>
        )}

        {/* Scroll cue — an unmissable invitation: labeled pill + bobbing
            double chevron. Fades as soon as scrubbing begins. Only shown on
            the scrub path, so the loop animation never runs for
            reduced-motion visitors. */}
        {phase === 'active' && !gateOpen && !reduced && (
          <div
            ref={cueRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 32,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              transition: 'opacity 400ms ease',
            }}
          >
            <style>{`
              @keyframes vsrEntranceCueBob {
                0%, 100% { transform: translateY(0); }
                50%      { transform: translateY(9px); }
              }
              @keyframes vsrEntranceCueBlink {
                0%, 100% { opacity: 0.25; }
                50%      { opacity: 1; }
              }
            `}</style>
            <span
              style={{
                ...mono,
                fontSize: '11px',
                padding: '10px 18px',
                color: 'rgba(255,255,255,0.92)',
                background: 'rgba(23,25,28,0.45)',
                border: '1px solid rgba(255,255,255,0.28)',
                borderRadius: 999,
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
              }}
            >
              Scroll to begin
            </span>
            <span
              style={{
                display: 'block',
                animation: 'vsrEntranceCueBob 1.6s ease-in-out infinite',
                filter: 'drop-shadow(0 1px 6px rgba(0,0,0,0.55))',
              }}
            >
              <svg width="22" height="24" viewBox="0 0 22 24" fill="none">
                <path
                  d="M1 1l10 9L21 1"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ animation: 'vsrEntranceCueBlink 1.6s ease-in-out infinite' }}
                />
                <path
                  d="M1 12l10 9 10-9"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ animation: 'vsrEntranceCueBlink 1.6s ease-in-out infinite 0.25s' }}
                />
              </svg>
            </span>
          </div>
        )}

        {/* Trust badges — frosted glass cluster that fades in as the vials
            rise (scroll-driven opacity, above) and clears before the freeze.
            Decorative reinforcement over the animation: aria-hidden so AT
            isn't asked to track a scrubbing marketing overlay. Reduced motion
            shows them statically (no scroll driver, full opacity, no drift).
            Placed low-center, well above the corner Skip pill. */}
        {!gateOpen && (phase === 'active' || (reduced && phase === 'holding')) && (
          <div
            ref={reduced ? undefined : badgesRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 'clamp(108px, 19vh, 200px)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              padding: '0 20px',
              pointerEvents: 'none',
              opacity: reduced ? 1 : 0,
              ...(reduced
                ? {}
                : { transition: 'opacity 120ms linear, transform 120ms linear' }),
            }}
          >
            {/* COA Verified — green check + "every lot" */}
            <span style={badgePill}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill={TRUST_GREEN} fillOpacity="0.9" />
                <path
                  d="M7.5 12.4l3 3 6-6.4"
                  stroke="#0C0C0D"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{BADGE_COA_LABEL}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em' }}>
                {BADGE_COA_SUB}
              </span>
            </span>

            {/* ≥98% HPLC Purity — gold accent node */}
            <span style={badgePill}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="5.5" fill={BRAND_GOLD} />
                <circle cx="12" cy="12" r="9" stroke={BRAND_GOLD} strokeOpacity="0.5" strokeWidth="1.4" />
              </svg>
              <span>{BADGE_PURITY_LABEL}</span>
            </span>

            {/* Network / trust line — the three-body brand mark (gold · teal ·
                ink) as the accent. */}
            <span style={badgePill}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="8" cy="15" r="2.4" fill="#34727A" />
                <circle cx="16" cy="13" r="3.2" fill={BRAND_GOLD} />
                <circle cx="13" cy="7" r="1.7" fill="rgba(255,255,255,0.7)" />
              </svg>
              <span style={{ letterSpacing: '0.1em' }}>{TRUST_NETWORK_LINE}</span>
            </span>
          </div>
        )}

        {/* Accessible completion path — never trap keyboard/AT visitors.
            Jumps to the frozen final frame + prompt, not into the site.
            Smaller than before but a clearer tap target: brighter border,
            firmer backing, a skip glyph, and hover/press/focus states. */}
        {phase === 'active' && !gateOpen && (
          <>
            <style>{`
              .vsr-entrance-skip {
                position: absolute;
                right: 16px;
                bottom: 16px;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-height: 34px;
                padding: 7px 13px;
                font-family: var(--font-mono);
                font-size: 10px;
                letter-spacing: 0.2em;
                text-transform: uppercase;
                color: rgba(255,255,255,0.92);
                background: rgba(16,18,21,0.62);
                border: 1px solid rgba(255,255,255,0.42);
                border-radius: 999px;
                cursor: pointer;
                -webkit-backdrop-filter: blur(8px) saturate(160%);
                backdrop-filter: blur(8px) saturate(160%);
                box-shadow:
                  inset 0 1px 0 rgba(255,255,255,0.28),
                  0 6px 18px -8px rgba(0,0,0,0.72);
                transition:
                  transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
                  background 160ms ease,
                  border-color 160ms ease;
              }
              @media (hover: hover) {
                .vsr-entrance-skip:hover {
                  background: rgba(30,33,37,0.74);
                  border-color: rgba(255,255,255,0.62);
                  transform: translateY(-1px);
                }
              }
              .vsr-entrance-skip:active { transform: translateY(0) scale(0.97); }
              .vsr-entrance-skip:focus-visible {
                outline: none;
                border-color: rgba(181,144,75,0.9);
                box-shadow:
                  0 0 0 2px rgba(181,144,75,0.7),
                  inset 0 1px 0 rgba(255,255,255,0.28);
              }
              @media (prefers-reduced-motion: reduce) {
                .vsr-entrance-skip { transition: none; }
              }
            `}</style>
            <button
              type="button"
              onClick={hold}
              className="vsr-entrance-skip"
              aria-label="Skip the intro animation"
            >
              <span>Skip intro</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 5l7 7-7 7M13 5l7 7-7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>,
    document.body,
  );

  return (
    <>
      {/* Scroll runway — the document height that drives the scrub. Gone
          once the final frame freezes ('holding'): the frame must never
          rewind under the member prompt. */}
      {!reduced && (phase === 'loading' || phase === 'active') && (
        <div aria-hidden="true" style={{ height: entranceScrollDistance() }} />
      )}
      {overlay}
    </>
  );
}
