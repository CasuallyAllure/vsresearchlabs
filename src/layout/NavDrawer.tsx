/**
 * NavDrawer
 *
 * Slide-out navigation panel triggered by the GlobalHeader hamburger.
 * Renders on every screen size — this is the canonical nav surface
 * across the site. The mobile BottomNav stays in place as a secondary
 * mobile-only floor bar; the drawer is primary.
 *
 * Surface posture matches the rest of the shell:
 *   - Frosted black + hairline right border
 *   - Holo cyan accent for active route + hover state
 *   - Gold reserved for the inquiry cart pip (primary action signal)
 *   - Silver mono captions for section headers and meta
 *
 * Interaction:
 *   - Slides from left (hamburger is on the left side of the header)
 *   - Backdrop click closes
 *   - ESC closes
 *   - Body scroll-locked while open
 *   - Closes automatically when a link is clicked
 *   - prefers-reduced-motion disables the slide; drawer just appears/hides
 */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { Logo } from '../components/brand/Logo';

interface NavLinkDef {
  to: string;
  label: string;
  caption?: string;
  match?: (pathname: string) => boolean;
  icon: React.ReactNode;
}

const HomeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
  </svg>
);

const MicroscopeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 18h8" />
    <path d="M3 22h18" />
    <path d="M14 22a7 7 0 1 0 0-14" />
    <path d="M9 14h2" />
    <path d="M9 12a2 2 0 0 1-2-2V6h4v4a2 2 0 0 1-2 2Z" />
    <path d="M12 6 8.5 2.5a2.12 2.12 0 0 0-3 3L9 9" />
  </svg>
);

const FlaskIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7 14h10" />
  </svg>
);

const InstrumentIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

const DocumentIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const MailIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const CartIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 8.5h11l-.8 11a2 2 0 0 1-2 1.85H9.3a2 2 0 0 1-2-1.85z" />
    <path d="M9 8.5V6.2a3 3 0 0 1 6 0v2.3" />
  </svg>
);

const TOP_NAV: NavLinkDef[] = [
  { to: '/', label: 'Home', caption: 'Landing', icon: HomeIcon, match: (p) => p === '/' },
  { to: '/research', label: 'Research Library', caption: 'Compound Intelligence', icon: MicroscopeIcon, match: (p) => p.startsWith('/research') && !p.startsWith('/research-supplies') },
];

const RESEARCH_SUPPLIES_CHILDREN: NavLinkDef[] = [
  { to: '/research-supplies/biopeptide', label: 'Biopeptide', icon: FlaskIcon, match: (p) => p.startsWith('/research-supplies/biopeptide') },
  { to: '/research-supplies/nootropics', label: 'Nootropics', icon: FlaskIcon, match: (p) => p.startsWith('/research-supplies/nootropics') },
  { to: '/research-supplies/skincare', label: 'Skincare', icon: FlaskIcon, match: (p) => p.startsWith('/research-supplies/skincare') },
];

const TAIL_NAV: NavLinkDef[] = [
  { to: '/laboratory-equipment', label: 'Laboratory Equipment', caption: 'Instruments · Consumables · Handling', icon: InstrumentIcon, match: (p) => p.startsWith('/laboratory-equipment') },
  { to: '/documentation', label: 'Documentation', caption: 'COA · HPLC · Mass Spec · Sterility', icon: DocumentIcon, match: (p) => p.startsWith('/documentation') },
  { to: '/contact', label: 'Contact', caption: 'Open Inquiries', icon: MailIcon, match: (p) => p.startsWith('/contact') },
];

interface NavItemProps {
  item: NavLinkDef;
  pathname: string;
  onClick: () => void;
  /** Visual indent for sub-items under a section header. */
  indent?: boolean;
}

function NavItem({ item, pathname, onClick, indent }: NavItemProps) {
  const isActive = item.match ? item.match(pathname) : pathname === item.to;
  return (
    <li>
      <Link
        to={item.to}
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={[
          'group relative flex items-center gap-3 py-2.5 rounded-[3px] transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40',
          indent ? 'pl-8 pr-3' : 'px-3',
          isActive ? 'bg-holo/[0.08]' : 'hover:bg-ink/[0.03]',
        ].join(' ')}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-sm"
            style={{ backgroundColor: 'var(--color-accent-teal)' }}
          />
        )}
        <span
          className={`shrink-0 ${isActive ? 'text-holo-light' : 'text-ink/55 group-hover:text-ink/80'} transition-colors`}
        >
          {item.icon}
        </span>
        <span className="flex flex-col min-w-0">
          <span
            className={`text-[12.5px] tracking-tight ${isActive ? 'text-ink' : 'text-ink/80 group-hover:text-ink'} transition-colors`}
          >
            {item.label}
          </span>
          {item.caption && (
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink/40 mt-0.5 truncate">
              {item.caption}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function NavDrawer({ open, onClose }: NavDrawerProps) {
  const location = useLocation();
  const itemCount = useCart((s) => s.itemCount());

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      window.scrollTo(0, y);
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-ink/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Primary navigation"
        className={`fixed top-0 left-0 z-[60] h-full w-[320px] max-w-[88vw] sm:w-[360px] transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          backgroundColor: 'rgba(251, 249, 244, 0.97)',
          borderRight: '1px solid rgba(26, 23, 20, 0.12)',
          boxShadow: '24px 0 60px -20px rgba(26,23,20,0.25)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Drawer header — identity + close */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/[0.08]">
          <Link
            to="/"
            onClick={onClose}
            className="flex flex-col gap-1.5 min-w-0 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          >
            <Logo variant="lockup" markSize={24} wordSize={12.5} showTagline={false} to={null} ariaLabel="VS Research Labs" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-ink/40 pl-[34px]">
              Bay Area · California
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 p-2 text-ink/55 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Nav body — primary destinations */}
        <nav aria-label="Primary" className="px-2 py-3">
          <p className="px-3 mb-2 font-mono text-[8.5px] uppercase tracking-[0.3em] text-ink/35">
            Navigate
          </p>
          <ul className="flex flex-col">
            {TOP_NAV.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={location.pathname}
                onClick={onClose}
              />
            ))}
          </ul>

          {/* Research Supplies — hierarchical group with 3 children */}
          <p className="px-3 mt-5 mb-2 font-mono text-[8.5px] uppercase tracking-[0.3em] text-ink/35">
            Research Supplies
          </p>
          <ul className="flex flex-col">
            <NavItem
              item={{
                to: '/research-supplies',
                label: 'All Compounds',
                icon: FlaskIcon,
                match: (p) => p === '/research-supplies',
              }}
              pathname={location.pathname}
              onClick={onClose}
            />
            {RESEARCH_SUPPLIES_CHILDREN.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={location.pathname}
                onClick={onClose}
                indent
              />
            ))}
          </ul>

          {/* Equipment + ops — flat tail */}
          <p className="px-3 mt-5 mb-2 font-mono text-[8.5px] uppercase tracking-[0.3em] text-ink/35">
            Operational
          </p>
          <ul className="flex flex-col">
            {TAIL_NAV.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={location.pathname}
                onClick={onClose}
              />
            ))}
          </ul>

          {/* Inquiry — separate group */}
          <p className="px-3 mt-5 mb-2 font-mono text-[8.5px] uppercase tracking-[0.3em] text-ink/35">
            Inquiry
          </p>
          <ul>
            <li>
              <Link
                to="/cart"
                onClick={onClose}
                aria-current={location.pathname === '/cart' ? 'page' : undefined}
                className="group relative flex items-center gap-3 px-3 py-2.5 rounded-[3px] hover:bg-ink/[0.03] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/40"
              >
                <span className="shrink-0 text-ink/55 group-hover:text-gold transition-colors">
                  {CartIcon}
                </span>
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-[12.5px] tracking-tight text-ink/85 group-hover:text-ink transition-colors">
                    Inquiry List
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink/40 mt-0.5">
                    {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'} pending` : 'Empty'}
                  </span>
                </span>
                {itemCount > 0 && (
                  <span className="shrink-0 min-w-[18px] h-[18px] px-1 bg-gold rounded-sm text-[10px] font-medium text-ink flex items-center justify-center tabular-nums">
                    {itemCount}
                  </span>
                )}
              </Link>
            </li>
          </ul>
        </nav>

        {/* Drawer footer — quiet legal/meta + admin sign-in */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-3 border-t border-ink/[0.07] flex items-center justify-between gap-3">
          <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-ink/35 leading-snug">
            For research use only<br />Not for human use
          </p>
          <Link
            to="/admin"
            onClick={onClose}
            className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink/45 hover:text-holo-light transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40 rounded-sm px-2 py-1 -mr-1 shrink-0"
          >
            Admin →
          </Link>
        </div>
      </aside>
    </>
  );
}
