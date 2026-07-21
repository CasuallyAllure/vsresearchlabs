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

import { useState, lazy, Suspense } from 'react';
import { useCart } from '../hooks/useCart';
import { NavDrawer } from './NavDrawer';
import { Logo } from '../components/brand/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { CartIcon } from '../components/icons/CartIcon';

const CartDrawer = lazy(() => import('./CartDrawer').then((m) => ({ default: m.CartDrawer })));

export type HeaderRole = 'guest' | 'owner';

interface GlobalHeaderProps {
  role?: HeaderRole;
}

export function GlobalHeader({ role = 'guest' }: GlobalHeaderProps) {
  const itemCount = useCart((s) => s.itemCount());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartEverOpened, setCartEverOpened] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b border-ink/[0.05]"
        data-role={role}
        style={{ backgroundColor: 'var(--header-bg)' }}
      >
        <div className="relative z-10 h-[52px] sm:h-[56px] px-[var(--space-6)] flex items-center">
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
          <Logo variant="stacked" markSize={32} wordSize={10} circled className="sm:hidden absolute left-1/2 -translate-x-1/2" />
          <Logo
            variant="lockup"
            markSize={36}
            wordSize={13}
            circled
            className="hidden sm:inline-flex sm:absolute sm:left-1/2 sm:-translate-x-1/2"
          />

          {/* RIGHT — Cart. Quiet control mirroring the hamburger's treatment
              (no chip, no gradient) — the header's one action stays understated. */}
          <button
            type="button"
            onClick={() => {
              setCartOpen(true);
              setCartEverOpened(true);
            }}
            aria-label="Open inquiry list"
            aria-expanded={cartOpen}
            aria-controls="inquiry-cart-drawer"
            className="relative ml-auto shrink-0 p-2 -mr-2 text-ink/70 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          >
            <CartIcon size={20} />
            {itemCount > 0 && (
              <span
                aria-label={`${itemCount} item${itemCount === 1 ? '' : 's'} in inquiry`}
                className="absolute top-0 right-0 min-w-[17px] h-[17px] px-1 bg-gold rounded-full text-[10px] font-medium text-ink flex items-center justify-center tabular-nums shadow-[0_1px_3px_rgba(30,28,24,0.25)] ring-2 ring-[color:var(--header-bg)]"
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
        {cartEverOpened && (
          <Suspense fallback={null}>
            <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
          </Suspense>
        )}
      </div>
    </>
  );
}
