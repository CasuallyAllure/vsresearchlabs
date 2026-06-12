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
        <div className="relative z-10 h-16 px-[var(--space-6)] grid grid-cols-3 items-center">
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
              className="flex flex-col items-center gap-[2px] min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35 rounded-sm"
              aria-label="VS Research Labs — Home"
            >
              <div className="flex items-center gap-1">
                <span className="header-id-wordmark whitespace-nowrap font-semibold uppercase tracking-[0.075em] leading-none text-[15px] sm:text-[17px]">
                  VS Research Labs
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
                className="header-id-subtitle whitespace-nowrap uppercase tracking-[0.18em] leading-none text-[6.5px] sm:text-[7.5px]"
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
        .header-id-wordmark {
          /* Neutral polished-steel chrome — no blue tint, like lab
             stainless. White peaks, mid steel mids, dark gunmetal at the
             horizon, silver-cool refraction lower. */
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
        .header-id-subtitle {
          text-shadow:
            0 0 4px rgba(205, 208, 213, 0.32),
            0 0 10px rgba(180, 184, 190, 0.14);
        }

        /* ── Tron triple-slash — each blade pulses on its own tempo so
              the badge reads as alive. Three different durations and
              delays for the offset rhythm. */
        @keyframes tron-pulse-a {
          0%, 100% { opacity: 0.42; stroke-width: 2.4; }
          50%      { opacity: 1;    stroke-width: 3.4; }
        }
        @keyframes tron-pulse-b {
          0%, 100% { opacity: 0.6;  stroke-width: 2.6; }
          50%      { opacity: 1;    stroke-width: 3.2; }
        }
        @keyframes tron-pulse-c {
          0%, 100% { opacity: 0.5;  stroke-width: 2.2; }
          50%      { opacity: 1;    stroke-width: 3.6; }
        }
        .tron-slash-1 {
          stroke-width: 2.8;
          animation: tron-pulse-a 1.8s ease-in-out infinite;
        }
        .tron-slash-2 {
          stroke-width: 2.8;
          animation: tron-pulse-b 2.6s ease-in-out infinite 0.35s;
        }
        .tron-slash-3 {
          stroke-width: 2.8;
          animation: tron-pulse-c 3.4s ease-in-out infinite 0.85s;
        }
        @media (prefers-reduced-motion: reduce) {
          .tron-slash-1, .tron-slash-2, .tron-slash-3 {
            animation: none;
            opacity: 0.92;
            stroke-width: 3;
          }
        }
      `}</style>
    </>
  );
}
