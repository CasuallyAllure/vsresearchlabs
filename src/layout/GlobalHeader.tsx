/**
 * GlobalHeader
 * VS Research Labs App Shell — cream editorial system.
 *
 * Header rendered inside <GlobalSurface />.
 *
 * Layout: [Hamburger LEFT] [Logo CENTER] [Cart RIGHT]
 *
 * Surface posture: frosted cream with a single hairline bottom border.
 * backdrop-blur for scroll float. The identity is the new DNA·V lockup
 * (see components/brand/Logo). The cart count badge is the header's only
 * color accent and reads as a state chip.
 */

import { useState } from 'react';
import { useCart } from '../hooks/useCart';
import { NavDrawer } from './NavDrawer';
import { CartDrawer } from './CartDrawer';
import { Logo } from '../components/brand/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';

export type HeaderRole = 'guest' | 'owner';

interface GlobalHeaderProps {
  role?: HeaderRole;
}

export function GlobalHeader({ role = 'guest' }: GlobalHeaderProps) {
  const itemCount = useCart((s) => s.itemCount());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b border-ink/[0.05]"
        data-role={role}
        style={{ backgroundColor: 'var(--header-bg)' }}
      >
        <div className="relative z-10 h-[64px] sm:h-[60px] px-[var(--space-6)] flex items-center">
          {/* LEFT — Hamburger trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="primary-nav-drawer"
            className="shrink-0 p-2 -ml-2 text-ink/70 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
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

          {/* LEFT — Theme swatch (light / black-&-silver dark). Tiny disc
              showing the live palette, sits just after the hamburger. */}
          <ThemeToggle className="-ml-1" />

          {/* CENTER — DNA·V identity lockup.
              Mobile: stacked (mark above wordmark), bigger, centered.
              Desktop (sm+): horizontal lockup, centered, larger. */}
          <Logo variant="stacked" markSize={44} wordSize={11} circled className="sm:hidden absolute left-1/2 -translate-x-1/2" />
          <Logo
            variant="lockup"
            markSize={48}
            wordSize={14}
            circled
            className="hidden sm:inline-flex sm:absolute sm:left-1/2 sm:-translate-x-1/2"
          />

          {/* RIGHT — Cart */}
          {/* Dimensional chip: gradient fill + lit top edge + soft drop shadow
              so the bag reads as a raised control — the header's one action. */}
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label="Open inquiry list"
            aria-expanded={cartOpen}
            aria-controls="inquiry-cart-drawer"
            className="relative ml-auto shrink-0 flex h-10 w-10 items-center justify-center rounded-full border border-ink/[0.12] text-ink/70 hover:text-ink transition-[color,box-shadow,transform] duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
            style={{
              background:
                'linear-gradient(180deg, var(--color-surface-elevated), var(--surface-product))',
              boxShadow:
                'var(--surface-highlight), 0 1px 2px rgba(30,28,24,0.08), 0 6px 16px -6px rgba(30,28,24,0.22)',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="vsr-bag-depth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
                </linearGradient>
              </defs>
              <path
                d="M6.5 8.5h11l-.8 11a2 2 0 0 1-2 1.85H9.3a2 2 0 0 1-2-1.85z"
                fill="url(#vsr-bag-depth)"
              />
              <path d="M9 8.5V6.2a3 3 0 0 1 6 0v2.3" />
            </svg>
            {itemCount > 0 && (
              <span
                aria-label={`${itemCount} item${itemCount === 1 ? '' : 's'} in inquiry`}
                className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 bg-gold rounded-full text-[10px] font-medium text-ink flex items-center justify-center tabular-nums shadow-[0_1px_3px_rgba(30,28,24,0.25)] ring-2 ring-[color:var(--header-bg)]"
              >
                {itemCount}
              </span>
            )}
          </button>
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
    </>
  );
}
