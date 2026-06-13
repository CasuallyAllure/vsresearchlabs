/**
 * GlobalHeader
 * Phase 3 — VS Research Labs App Shell
 * Reconciliation Pass B — Chrome neutralization.
 *
 * Header rendered inside <GlobalSurface />. Replaces the legacy Navbar.
 *
 * Layout: [Hamburger LEFT] [Logo CENTER] [Cart RIGHT]
 *
 * Surface posture: frosted black with a single hairline bottom border.
 * backdrop-blur-sm for scroll float; bg-black/80 maintains legibility.
 * No glass — chrome is institutional, not atmospheric. The cart count
 * badge is the header's only color accent and reads as a state chip.
 *
 * The hamburger now opens the canonical NavDrawer (slide-out from the
 * left). Drawer state is owned by this component.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { NavDrawer } from './NavDrawer';
import { CartDrawer } from './CartDrawer';
import { useTheme, THEME_LABELS } from '../lib/theme';

export type HeaderRole = 'guest' | 'owner';

interface GlobalHeaderProps {
  role?: HeaderRole;
}

export function GlobalHeader({ role = 'guest' }: GlobalHeaderProps) {
  const itemCount = useCart((s) => s.itemCount());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const { theme, cycle } = useTheme();

  return (
    <>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b border-white/[0.06] overflow-hidden"
        data-role={role}
        style={{ backgroundColor: 'rgba(8, 10, 13, 0.62)' }}
      >
        <div className="relative z-10 h-12 px-[var(--space-6)] grid grid-cols-3 items-center">
          {/* LEFT — Hamburger trigger + color-theme toggle */}
          <div className="flex items-center justify-start gap-0.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="primary-nav-drawer"
              className="p-2 -ml-2 text-white/70 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="4.5" y1="7.5" x2="19.5" y2="7.5" />
                <line x1="4.5" y1="12" x2="13.5" y2="12" />
                <line x1="4.5" y1="16.5" x2="19.5" y2="16.5" />
              </svg>
            </button>

            <button
              type="button"
              onClick={cycle}
              aria-label={`Color theme: ${THEME_LABELS[theme]}. Click to change.`}
              title={`Theme: ${THEME_LABELS[theme]}`}
              className="p-2 text-white/70 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
              {/* Half-filled contrast disc — classic theme glyph. */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
              </svg>
            </button>
          </div>

          {/* CENTER — Identity: chrome wordmark + slashes inline on the
              top row, subtitle on the row below. Slashes sit immediately
              to the right of "Labs" at the same vertical level. */}
          <div className="flex items-center justify-center min-w-0">
            <Link
              to="/"
              className="flex flex-col items-center gap-[2px] min-w-0 -translate-y-[2px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35 rounded-sm"
              aria-label="VS Research Labs — Home"
            >
              <div className="flex items-center gap-1">
                <span className="header-id-wordmark inline-flex items-center whitespace-nowrap font-semibold uppercase tracking-[0.075em] leading-none text-[15px] sm:text-[17px]">
                  <span className="header-id-vs">
                    VS
                    <span aria-hidden="true" className="vs-spark b1" />
                    <span aria-hidden="true" className="vs-spark b2" />
                    <span aria-hidden="true" className="vs-spark b3" />
                    <span aria-hidden="true" className="vs-spark f1" />
                    <span aria-hidden="true" className="vs-spark f2" />
                    <span aria-hidden="true" className="vs-spark f3" />
                  </span>
                  <span className="header-id-wordmark-sub">
                    <span className="header-id-sub-text">Research&nbsp;Labs</span>
                    <span aria-hidden="true" className="header-id-sub-rule" />
                  </span>
                </span>
                {/* Tron triple-slash — sized to match the wordmark height,
                    sitting on the same baseline. Each blade pulses at its
                    own tempo. */}
                <span
                  aria-hidden="true"
                  className="hidden sm:inline-flex shrink-0"
                  style={{
                    filter:
                      'drop-shadow(0 0 5px rgba(120, 210, 255, 0.7)) drop-shadow(0 0 12px rgba(120, 210, 255, 0.32)) drop-shadow(0 0 18px rgba(255, 138, 46, 0.22))',
                  }}
                >
                  <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
                    <g strokeLinecap="round">
                      <line className="tron-slash-1" x1="4"  y1="17" x2="11" y2="3" stroke="#7AE5FF" />
                      <line className="tron-slash-2" x1="11" y1="17" x2="18" y2="3" stroke="#4A95E0" />
                      <line className="tron-slash-3" x1="18" y1="17" x2="25" y2="3" stroke="#FF8A2E" />
                    </g>
                  </svg>
                </span>
              </div>
              <span
                className="header-id-subtitle whitespace-nowrap uppercase tracking-[0.18em] leading-none text-[5.5px] sm:text-[6.5px]"
                style={{
                  color: 'rgba(206, 210, 215, 0.7)',
                  fontFamily: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
                }}
              >
                BioPeptide Sciences · Nootropics · Skin-Care
              </span>
            </Link>
          </div>

          {/* RIGHT — Cart */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label="Open inquiry list"
              aria-expanded={cartOpen}
              aria-controls="inquiry-cart-drawer"
              className="relative p-2 -mr-2 text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6.5 8.5h11l-.8 11a2 2 0 0 1-2 1.85H9.3a2 2 0 0 1-2-1.85z" />
                <path d="M9 8.5V6.2a3 3 0 0 1 6 0v2.3" />
              </svg>
              {itemCount > 0 && (
                <span
                  aria-label={`${itemCount} item${itemCount === 1 ? '' : 's'} in inquiry`}
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-gold rounded-sm text-[10px] font-medium text-black flex items-center justify-center tabular-nums"
                >
                  {itemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Slide-out navigation drawer */}
      <div id="primary-nav-drawer">
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>

      {/* Slide-out inquiry cart drawer */}
      <div id="inquiry-cart-drawer">
        <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      </div>

      {/* Chrome wordmark + subtitle styles — scoped to the header. */}
      <style>{`
        /* Container only — fill/glow now live on the two child marks so "VS"
           can be gold while "Research Labs" stays polished steel. */
        .header-id-wordmark {
          color: transparent;
        }
        /* "VS" — warm gold metallic, structured like the steel ramp (white-hot
           peak, deep horizon line, refracted lower glow) but in gold tones so
           it reads as the precious-metal counterpart to the steel sub-mark. */
        .header-id-vs {
          /* Raise "VS" to optically align with the "Research Labs" text — the
             sub-mark's underline + gap hang below, so row-centering otherwise
             drops VS lower than the text it sits beside. */
          transform: translateY(-0.1em);
          background: linear-gradient(
            180deg,
            #FCFAF2 0%,
            #ECE2C4 16%,
            #D8C9A2 40%,
            #BFB084 50%,
            #6F6648 50.5%,
            #C2B690 64%,
            #E2D7BC 84%,
            #FBF8EF 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow:
            0 0 10px rgba(216, 201, 162, 0.28),
            0 0 22px rgba(191, 176, 132, 0.14);
          filter:
            drop-shadow(0 1px 0 rgba(70, 60, 38, 0.45))
            drop-shadow(0 0 6px rgba(226, 215, 188, 0.22));
        }
        /* "Research Labs" — smaller, lighter and a touch more tracked than
           "VS", stacked over a hairline rule so the text + strike together
           occupy the same vertical height as the gold "VS". */
        .header-id-wordmark-sub {
          display: inline-flex;
          flex-direction: column;
          align-items: stretch;
          font-size: 0.7em;
          font-weight: 400;
          letter-spacing: 0.13em;
          margin-left: 0.5em;
          gap: 0.28em;
        }
        /* Polished-steel chrome for the sub-mark text. */
        .header-id-sub-text {
          background: linear-gradient(
            180deg,
            #FFFFFF 0%,
            #EAECEE 18%,
            #BCBFC3 42%,
            #93969B 50%,
            #52555A 50.5%,
            #A1A4A8 65%,
            #DADCDE 84%,
            #F6F7F8 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow:
            0 0 10px rgba(220, 222, 226, 0.28),
            0 0 22px rgba(195, 198, 202, 0.14);
          filter:
            drop-shadow(0 1px 0 rgba(30, 32, 36, 0.42))
            drop-shadow(0 0 6px rgba(210, 213, 218, 0.22));
        }
        /* Hairline strike under "Research Labs" — a steel gradient rule that
           fades at both ends, with a soft bloom to match the chrome glow. */
        .header-id-sub-rule {
          height: 1px;
          border-radius: 1px;
          background: linear-gradient(
            90deg,
            rgba(210, 213, 218, 0) 0%,
            rgba(210, 213, 218, 0.85) 18%,
            rgba(255, 255, 255, 0.95) 50%,
            rgba(210, 213, 218, 0.85) 82%,
            rgba(210, 213, 218, 0) 100%
          );
          box-shadow: 0 0 4px rgba(210, 213, 218, 0.35);
        }
        .header-id-subtitle {
          text-shadow:
            0 0 4px rgba(205, 208, 213, 0.32),
            0 0 10px rgba(180, 184, 190, 0.14);
        }

        /* ── Tron triple-slash — glitchy CRT/terminal flicker. Hard-cut
              (stepped) opacity dropouts, signal-tear horizontal jitter and
              abrupt stroke-width jumps, each blade on its own noisy loop so
              they read as an unstable digital signal rather than a smooth
              breathing pulse. */
        .tron-slash-1,
        .tron-slash-2,
        .tron-slash-3 {
          stroke-width: 2.8;
          transform-box: fill-box;
        }
        @keyframes tron-glitch-1 {
          0%, 10%   { opacity: 0.9;  stroke-width: 2.8; transform: translateX(0); }
          11%       { opacity: 0.12; transform: translateX(0.7px); }
          14%       { opacity: 1;    stroke-width: 3.6; transform: translateX(-0.5px); }
          16%, 33%  { opacity: 0.85; stroke-width: 2.6; transform: translateX(0); }
          34%       { opacity: 0.2;  }
          36%       { opacity: 1;    stroke-width: 3.4; }
          38%, 62%  { opacity: 0.9;  stroke-width: 2.8; }
          63%       { opacity: 0.08; transform: translateX(0.9px); }
          66%       { opacity: 1;    transform: translateX(0); }
          68%, 86%  { opacity: 0.85; }
          87%       { opacity: 0.3;  stroke-width: 2.4; }
          89%       { opacity: 1;    stroke-width: 3.2; }
          90%, 100% { opacity: 0.9;  stroke-width: 2.8; }
        }
        @keyframes tron-glitch-2 {
          0%, 7%    { opacity: 0.85; stroke-width: 2.8; transform: translateX(0); }
          8%        { opacity: 1;    stroke-width: 3.5; transform: translateX(-0.6px); }
          10%       { opacity: 0.15; transform: translateX(0.5px); }
          12%, 40%  { opacity: 0.9;  stroke-width: 2.7; transform: translateX(0); }
          41%       { opacity: 0.25; }
          43%       { opacity: 1;    stroke-width: 3.3; }
          45%, 58%  { opacity: 0.8;  stroke-width: 2.8; }
          59%       { opacity: 0.1;  transform: translateX(-0.8px); }
          61%       { opacity: 1;    transform: translateX(0); }
          63%, 92%  { opacity: 0.9;  }
          93%       { opacity: 0.22; stroke-width: 2.5; }
          95%       { opacity: 1;    stroke-width: 3.4; }
          96%, 100% { opacity: 0.85; stroke-width: 2.8; }
        }
        @keyframes tron-glitch-3 {
          0%, 14%   { opacity: 0.9;  stroke-width: 2.8; transform: translateX(0); }
          15%       { opacity: 0.18; transform: translateX(0.8px); }
          17%       { opacity: 1;    stroke-width: 3.6; transform: translateX(-0.6px); }
          19%, 46%  { opacity: 0.82; stroke-width: 2.6; transform: translateX(0); }
          47%       { opacity: 0.12; transform: translateX(0.6px); }
          49%       { opacity: 1;    stroke-width: 3.2; transform: translateX(0); }
          51%, 70%  { opacity: 0.9;  stroke-width: 2.8; }
          71%       { opacity: 0.28; }
          73%       { opacity: 1;    stroke-width: 3.5; }
          75%, 88%  { opacity: 0.85; stroke-width: 2.7; }
          89%       { opacity: 0.1;  transform: translateX(-0.7px); }
          91%       { opacity: 1;    transform: translateX(0); }
          92%, 100% { opacity: 0.9;  stroke-width: 2.8; }
        }
        .tron-slash-1 { animation: tron-glitch-1 1.7s steps(1, end) infinite; }
        .tron-slash-2 { animation: tron-glitch-2 1.3s steps(1, end) infinite 0.2s; }
        .tron-slash-3 { animation: tron-glitch-3 2.1s steps(1, end) infinite 0.5s; }
        @media (prefers-reduced-motion: reduce) {
          .tron-slash-1, .tron-slash-2, .tron-slash-3 {
            animation: none;
            opacity: 0.92;
            stroke-width: 3;
          }
        }

        /* ── "VS" star sparkles — small four-point stars scattered around the
              mark, some behind the glyphs (z-index:-1) and some in front
              (z-index:2). Sized in em so they scale with the wordmark, and
              each twinkles (scale + fade + slow rotate) on its own staggered
              tempo so the cluster shimmers gracefully rather than blinking
              in unison. */
        .header-id-vs { position: relative; }
        .vs-spark {
          position: absolute;
          width: var(--s, 0.3em);
          height: var(--s, 0.3em);
          background: #FFF8E6;
          clip-path: polygon(
            50% 0%, 58% 42%, 100% 50%, 58% 58%,
            50% 100%, 42% 58%, 0% 50%, 42% 42%
          );
          opacity: 0;
          transform: scale(0.25) rotate(-12deg);
          pointer-events: none;
          filter:
            drop-shadow(0 0 2px rgba(255, 244, 214, 0.9))
            drop-shadow(0 0 5px rgba(244, 210, 140, 0.5));
          animation: vs-twinkle var(--dur, 2.8s) ease-in-out var(--d, 0s) infinite;
        }
        @keyframes vs-twinkle {
          0%, 46%, 100% { opacity: 0; transform: scale(0.25) rotate(-12deg); }
          60%           { opacity: 1; transform: scale(1) rotate(0deg); }
          74%           { opacity: 0.8; transform: scale(0.92) rotate(8deg); }
          88%           { opacity: 0; transform: scale(0.4) rotate(16deg); }
        }
        /* behind the glyphs */
        .vs-spark.b1 { --s: 0.42em; --d: 0s;    --dur: 3.1s; top: -26%; left: -7%;   z-index: -1; }
        .vs-spark.b2 { --s: 0.30em; --d: 1.15s; --dur: 2.6s; bottom: -20%; right: 6%; z-index: -1; }
        .vs-spark.b3 { --s: 0.24em; --d: 0.6s;  --dur: 3.5s; top: 34%; right: -11%;  z-index: -1; }
        /* in front of the glyphs */
        .vs-spark.f1 { --s: 0.32em; --d: 1.7s;  --dur: 2.9s; top: -16%; right: 16%;  z-index: 2; }
        .vs-spark.f2 { --s: 0.22em; --d: 0.35s; --dur: 2.4s; bottom: -12%; left: 12%; z-index: 2; }
        .vs-spark.f3 { --s: 0.20em; --d: 2.1s;  --dur: 3.2s; top: 6%; left: 44%;      z-index: 2; }
        @media (prefers-reduced-motion: reduce) {
          .vs-spark { animation: none; opacity: 0; }
        }
      `}</style>
    </>
  );
}
