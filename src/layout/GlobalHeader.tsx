/**
 * GlobalHeader
 * Phase 3 — VS Research Labs App Shell
 *
 * Header rendered inside <GlobalSurface />. Replaces the legacy Navbar.
 *
 * Layout: [Hamburger LEFT] [Logo CENTER] [Cart RIGHT]
 *
 * The hamburger trigger is a placeholder button — no drawer logic yet.
 * `onMenuClick` is exposed as an optional callback so a future drawer
 * (likely owned by LANE_COMPONENTS) can wire in without touching this
 * file again.
 *
 * Accepts a `role` prop as a placeholder until LANE_AUTH (P4) wires the
 * authStore. Defaults to 'guest'.
 */

import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';

export type HeaderRole = 'guest' | 'owner' | 'door' | 'promoter' | 'dj';

interface GlobalHeaderProps {
  role?: HeaderRole;
  onMenuClick?: () => void;
}

export function GlobalHeader({ role = 'guest', onMenuClick }: GlobalHeaderProps) {
  const itemCount = useCart((s) => s.itemCount());

  return (
    <header
      className="sticky top-0 z-40 bg-black border-b border-white/[0.06]"
      data-role={role}
    >
      <div className="relative h-14 px-[var(--space-6)] grid grid-cols-3 items-center">
        {/* LEFT — Hamburger trigger (placeholder) */}
        <div className="flex items-center justify-start">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open menu"
            className="p-2 -ml-2 text-white/70 hover:text-white transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        </div>

        {/* CENTER — Logo */}
        <div className="flex items-center justify-center">
          <Link
            to="/"
            className="tracking-widest text-sm font-light text-white uppercase whitespace-nowrap"
          >
            VS Research Labs
          </Link>
        </div>

        {/* RIGHT — Cart */}
        <div className="flex items-center justify-end">
          <Link
            to="/cart"
            className="relative p-2 -mr-2 text-white/60 hover:text-white transition-colors"
            aria-label="Cart"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-gold rounded-full text-[10px] font-bold text-black flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
