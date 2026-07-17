/**
 * NavDrawer
 *
 * Slide-out navigation panel triggered by the GlobalHeader hamburger.
 * Renders on every screen size — this is the canonical nav surface
 * across the site. The mobile BottomNav stays in place as a secondary
 * mobile-only floor bar; the drawer is primary.
 *
 * Surface posture matches the rest of the shell:
 *   - Frosted cream + hairline right border (editorial light theme)
 *   - Teal accent for active route + hover state
 *   - Gold reserved for the identity tick + inquiry cart pip
 *   - Silver mono captions for section headers and meta
 *
 * Layout discipline (everything reads as one engineered system):
 *   - Single 20px left gutter — the identity mark, every section label,
 *     and every row icon share the same left edge.
 *   - Editorial section labels: mono caps + a hairline that runs to the
 *     panel edge.
 *   - Research-supply children hang off a vertical guide rule, each with
 *     its own domain icon (helix / neuron / droplet) so the three are
 *     instantly distinguishable rather than a stack of identical flasks.
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
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../lib/useScrollLock';
import { siteConfig } from '../config';
import { DnaVMark } from '../components/brand/DnaVMark';

interface NavLinkDef {
  to: string;
  label: string;
  caption?: string;
  match?: (pathname: string) => boolean;
  icon: React.ReactNode;
  /** Renders the row as a disabled "coming soon" seal (no navigation),
   *  matching the landing's "Archive in preparation" treatment. */
  comingSoon?: boolean;
}

/* ── Icon set — 18px, 1.4 stroke, currentColor unless a signature color
      is intentional (the owl is always gold). Each research domain gets
      a distinct, on-brand glyph. ───────────────────────────────────── */

const HomeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
  </svg>
);

// Research Library mark — a gold owl (knowledge / the library), drawn in
// brand gold regardless of active state so it reads as the section's
// signature rather than a generic nav glyph.
const OwlIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.2 5.4 9 8" />
    <path d="M16.8 5.4 15 8" />
    <path d="M12 4C8.1 4 5 7.1 5 11v2.5a7 7 0 0 0 14 0V11c0-3.9-3.1-7-7-7Z" />
    <circle cx="9.5" cy="10.5" r="2.1" />
    <circle cx="14.5" cy="10.5" r="2.1" />
    <circle cx="9.5" cy="10.5" r="0.55" fill="var(--color-accent-gold)" stroke="none" />
    <circle cx="14.5" cy="10.5" r="0.55" fill="var(--color-accent-gold)" stroke="none" />
    <path d="M12 11.7 11 13.2h2Z" />
    <path d="M10.2 20.6v1.1" />
    <path d="M13.8 20.6v1.1" />
  </svg>
);

// Research Supplies parent — a flask (the catalog as a whole).
const FlaskIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3h6" />
    <path d="M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
    <path d="M7 14h10" />
  </svg>
);

// Biopeptide — DNA double-helix, echoing the brand mark.
const HelixIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3c0 3.6 8 4 8 9s-8 5.4-8 9" />
    <path d="M16 3c0 3.6-8 4-8 9s8 5.4 8 9" />
    <path d="M9 6.5h6" />
    <path d="M9 17.5h6" />
  </svg>
);

// Nootropics — a synaptic node with terminals (cognition).
const NeuronIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="2.3" />
    <path d="M12 9.7V5.4" />
    <path d="M12 14.3v4.3" />
    <path d="M10 10.9 6.4 8.7" />
    <path d="M14 10.9 17.6 8.7" />
    <path d="M10 13.1 6.4 15.3" />
    <path d="M14 13.1 17.6 15.3" />
    <circle cx="12" cy="4.6" r="1" />
    <circle cx="12" cy="19.4" r="1" />
    <circle cx="5.5" cy="8.2" r="1" />
    <circle cx="18.5" cy="8.2" r="1" />
    <circle cx="5.5" cy="15.8" r="1" />
    <circle cx="18.5" cy="15.8" r="1" />
  </svg>
);

// Skincare — a droplet with a shine arc (dermal / topical).
const DropletIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.3c3.1 4.1 5.2 6.5 5.2 9.3a5.2 5.2 0 0 1-10.4 0c0-2.8 2.1-5.2 5.2-9.3z" />
    <path d="M9.5 14a2.6 2.6 0 0 0 2.1 2.1" />
  </svg>
);

// Laboratory Equipment — a microscope (instruments / bench).
const MicroscopeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 21h9" />
    <path d="M3.5 21h17" />
    <path d="M9.5 21a7 7 0 0 0 5-11.9" />
    <path d="M8.6 5.1 11.7 6.6 9.5 11.2 6.4 9.7z" />
    <path d="M8.1 11.4 9.9 12.3" />
    <path d="M8 14.5h4" />
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

const PackageIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m7.5 4.27 9 5.15" />
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
);

// Account — a simple user glyph (customer portal entry point).
const UserIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c.9-3.6 3.8-5.8 7-5.8s6.1 2.2 7 5.8" />
  </svg>
);

// Full Catalog — a grid glyph (browse-everything entry point).
const GridIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </svg>
);

const TOP_NAV: NavLinkDef[] = [
  { to: '/', label: 'Home', caption: 'Overview', icon: HomeIcon, match: (p) => p === '/' },
  { to: '/research', label: 'Research Library', caption: 'Compound Intelligence', icon: OwlIcon, match: (p) => p.startsWith('/research') && !p.startsWith('/research-supplies') },
];

const RESEARCH_SUPPLIES_CHILDREN: NavLinkDef[] = [
  { to: '/research-supplies/biopeptide', label: 'Biopeptide', caption: 'Peptide sciences', icon: HelixIcon, match: (p) => p.startsWith('/research-supplies/biopeptide') },
  { to: '/research-supplies/nootropics', label: 'Nootropics', caption: 'Cognitive', icon: NeuronIcon, match: (p) => p.startsWith('/research-supplies/nootropics') },
  { to: '/research-supplies/skincare', label: 'Skincare', caption: 'Dermal', icon: DropletIcon, match: (p) => p.startsWith('/research-supplies/skincare') },
];

// Full catalog — sits with the Research Supplies group since it's the
// "browse everything" counterpart to the segmented domain hubs above.
const CATALOG_NAV: NavLinkDef = {
  to: '/catalog', label: 'Full Catalog', caption: 'Every product, one list', icon: GridIcon, match: (p) => p.startsWith('/catalog'),
};

const TAIL_NAV: NavLinkDef[] = [
  { to: '/track', label: 'Track Order', caption: 'Status · Invoice · Receipt', icon: PackageIcon, match: (p) => p.startsWith('/track') },
  { to: '/account', label: 'Account', caption: 'Sign in · Order history', icon: UserIcon, match: (p) => p.startsWith('/account') },
  { to: '/laboratory-equipment', label: 'Laboratory Equipment', caption: 'Instruments · Consumables', icon: MicroscopeIcon, match: (p) => p.startsWith('/laboratory-equipment') },
  { to: '/documentation', label: 'Documentation', caption: 'COA · HPLC · Assays', icon: DocumentIcon, match: (p) => p.startsWith('/documentation'), comingSoon: true },
  { to: '/contact', label: 'Contact', caption: 'Open inquiries', icon: MailIcon, match: (p) => p.startsWith('/contact') },
];

/* Per-item reveal helper — while the drawer is open, each row/label joins the
   staggered cascade (`.drawer-reveal` + an inline --drawer-delay). Closed, it
   carries nothing, so reopening cleanly replays the cascade. Reduced-motion
   flattens `.drawer-reveal` to a plain present state (see theme.css). */
function revealProps(open: boolean, delay: number) {
  return open
    ? { className: 'drawer-reveal', style: { '--drawer-delay': `${delay}ms` } as React.CSSProperties }
    : { className: '', style: undefined };
}

/* ── Editorial section label — mono caps with a hairline running to the
      panel edge. The structural rhythm of the whole drawer. ─────────── */
function SectionLabel({ children, open, delay }: { children: React.ReactNode; open: boolean; delay: number }) {
  const r = revealProps(open, delay);
  return (
    <div className={`flex items-center gap-3 px-3 mb-2 ${r.className}`} style={r.style}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 whitespace-nowrap">
        {children}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-ink/[0.12] to-transparent" />
    </div>
  );
}

function NavItem({
  item,
  pathname,
  onClick,
  open,
  delay,
}: {
  item: NavLinkDef;
  pathname: string;
  onClick: () => void;
  open: boolean;
  delay: number;
}) {
  const isActive = item.match ? item.match(pathname) : pathname === item.to;
  const r = revealProps(open, delay);

  // Coming-soon row — same concept as the landing's "Archive in
  // preparation" seal: blur/dim the real content so it never reads as
  // live, with a mono seal. Not a link; not focusable.
  if (item.comingSoon) {
    return (
      <li className={r.className} style={r.style}>
        <div
          aria-disabled="true"
          title="Coming soon"
          className="relative flex min-h-[44px] items-center gap-3.5 rounded-[12px] px-3 py-2.5 cursor-not-allowed"
        >
          <div className="flex min-w-0 items-center gap-3.5 select-none blur-[1.5px] opacity-45 saturate-[0.6]">
            <span className="grid h-[20px] w-[20px] shrink-0 place-items-center text-ink/55">{item.icon}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13.5px] leading-tight tracking-[-0.01em] text-ink/80">{item.label}</span>
              {item.caption && (
                <span className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
                  {item.caption}
                </span>
              )}
            </span>
          </div>
          <span className="ml-auto shrink-0 rounded-full border border-ink/15 bg-ink/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/55">
            Soon
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className={r.className} style={r.style}>
      <Link
        to={item.to}
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={[
          'group relative flex min-h-[44px] items-center gap-3.5 rounded-[12px] px-3 py-2.5',
          'transition-colors duration-200',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-holo/35',
          isActive ? 'bg-holo/[0.07]' : 'hover:bg-ink/[0.045]',
        ].join(' ')}
      >
        {/* Active rail — a machined teal edge, not a timid 2px sliver */}
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
            style={{ backgroundColor: 'var(--color-accent-teal)' }}
          />
        )}
        {/* Icon + label share a hairline-shift micro-interaction on hover so the
            row feels physical without moving the hit area. */}
        <span
          className={`grid h-[20px] w-[20px] shrink-0 place-items-center transition-[color,transform] duration-200 motion-safe:group-hover:translate-x-[1px] ${
            isActive ? 'text-holo-light' : 'text-ink/50 group-hover:text-ink'
          }`}
        >
          {item.icon}
        </span>
        <span className="flex min-w-0 flex-col transition-transform duration-200 motion-safe:group-hover:translate-x-[2px]">
          <span
            className={`text-[13.5px] leading-tight tracking-[-0.01em] transition-colors ${
              isActive ? 'text-ink' : 'text-ink/85 group-hover:text-ink'
            }`}
          >
            {item.label}
          </span>
          {item.caption && (
            <span className="mt-[3px] truncate font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
              {item.caption}
            </span>
          )}
        </span>
        {/* Trailing chevron reveals on hover / active — a quiet "go" affordance */}
        <span
          aria-hidden="true"
          className={`ml-auto shrink-0 transition-[opacity,transform] duration-200 ${
            isActive
              ? 'opacity-100 text-holo-light'
              : 'opacity-0 -translate-x-1 text-ink/40 group-hover:opacity-100 group-hover:translate-x-0'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
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

  // Body scroll lock while open (ref-counted; overflow:hidden preserves position)
  useScrollLock(open);

  // Modality enforcement — matches CartDrawer; restores focus to the header
  // menu button on close.
  const panelRef = useFocusTrap<HTMLElement>(open);

  // Staggered reveal cascade — a running counter advanced in source order as
  // the sections render, so every label/row settles a beat after the one above.
  let order = 0;
  const nextDelay = () => 90 + 30 * order++;

  return createPortal(
    <>
      {/* Backdrop — a real scrim: deeper blur pulls focus off the page and onto
          the panel, and the opacity ramps a touch behind the slide. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-[color:var(--scrim)] backdrop-blur-[6px] transition-opacity duration-[420ms] ease-out ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel — glass chrome (consistent with CartDrawer), inner edge
          rounded so it reads as a floating module, and a weighted decelerate
          slide (Vaul/emil curve — settles, never bounces). Enter is slower than
          exit; reduced-motion zeroes both via the global !important override. */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Primary navigation"
        // Closed, the panel stays mounted off-screen — `inert` keeps its links
        // out of the tab order and the a11y tree. See CartDrawer.
        inert={!open}
        className="glass-panel fixed top-0 left-0 z-[60] h-[100dvh] w-[300px] max-w-[86vw] sm:w-[324px] flex flex-col rounded-r-[22px] overflow-hidden"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: open
            ? 'transform 480ms cubic-bezier(0.32, 0.72, 0, 1)'
            : 'transform 320ms cubic-bezier(0.4, 0, 0.7, 1)',
          boxShadow: 'var(--glass-highlight), 28px 0 64px -24px rgba(26,23,20,0.4), var(--elev-3)',
        }}
      >
        {/* Identity — letterhead lockup. Mark + wordmark + jurisdiction. */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5 border-b border-ink/[0.08]">
          <Link
            to="/"
            onClick={onClose}
            aria-label={`${siteConfig.brand.name} — Home`}
            className="group flex items-center gap-3 min-w-0 rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <DnaVMark size={36} static />
            <span className="flex flex-col gap-[5px] min-w-0">
              <span
                className="font-serif font-medium uppercase leading-none text-ink"
                style={{ fontSize: 15, letterSpacing: '0.18em' }}
              >
                Research Labs
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="h-[1.5px] w-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent-gold)' }}
                />
                <span
                  className="truncate font-mono uppercase leading-none text-ink/50"
                  style={{ fontSize: 9, letterSpacing: '0.2em' }}
                >
                  Bay Area · California
                </span>
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-1.5 -mt-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/45 hover:text-ink hover:bg-ink/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Nav body — primary destinations */}
        <nav aria-label="Primary" className="px-3 py-5 flex-1 min-h-0 overflow-y-auto">
          <SectionLabel open={open} delay={nextDelay()}>Navigate</SectionLabel>
          <ul className="flex flex-col gap-0.5">
            {TOP_NAV.map((item) => (
              <NavItem key={item.to} item={item} pathname={location.pathname} onClick={onClose} open={open} delay={nextDelay()} />
            ))}
          </ul>

          {/* Research Supplies — parent + a guided sub-tree of domains */}
          <div className="mt-7">
            <SectionLabel open={open} delay={nextDelay()}>Research Supplies</SectionLabel>
            <ul className="flex flex-col gap-0.5">
              <NavItem
                item={{
                  to: '/research-supplies',
                  label: 'All Compounds',
                  caption: 'Browse by domain',
                  icon: FlaskIcon,
                  match: (p) => p === '/research-supplies',
                }}
                pathname={location.pathname}
                onClick={onClose}
                open={open}
                delay={nextDelay()}
              />
              <NavItem item={CATALOG_NAV} pathname={location.pathname} onClick={onClose} open={open} delay={nextDelay()} />
            </ul>
            {/* Domains hang off a vertical guide rule aligned under the
                parent's icon. Each carries its own signature glyph. */}
            <ul className="mt-1 ml-[21px] flex flex-col gap-0.5 border-l border-ink/[0.09] pl-3">
              {RESEARCH_SUPPLIES_CHILDREN.map((item) => (
                <NavItem key={item.to} item={item} pathname={location.pathname} onClick={onClose} open={open} delay={nextDelay()} />
              ))}
            </ul>
          </div>

          {/* Equipment + ops */}
          <div className="mt-7">
            <SectionLabel open={open} delay={nextDelay()}>Operational</SectionLabel>
            <ul className="flex flex-col gap-0.5">
              {TAIL_NAV.map((item) => (
                <NavItem key={item.to} item={item} pathname={location.pathname} onClick={onClose} open={open} delay={nextDelay()} />
              ))}
            </ul>
          </div>

          {/* Inquiry — elevated to a gold-accented mini-module so the primary
              commercial action anchors the foot of the nav. */}
          <div className="mt-7">
            <SectionLabel open={open} delay={nextDelay()}>Inquiry</SectionLabel>
            <Link
              to="/cart"
              onClick={onClose}
              aria-current={location.pathname === '/cart' ? 'page' : undefined}
              style={open ? ({ '--drawer-delay': `${nextDelay()}ms` } as React.CSSProperties) : undefined}
              className={`group relative flex min-h-[52px] items-center gap-3.5 rounded-[14px] border border-gold/25 bg-gold/[0.06] px-3.5 py-3 transition-[background-color,border-color] duration-200 hover:bg-gold/[0.1] hover:border-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 ${open ? 'drawer-reveal' : ''}`}
            >
              <span className="grid h-[22px] w-[22px] shrink-0 place-items-center text-gold-dark group-hover:text-gold transition-colors">
                {CartIcon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] leading-tight tracking-[-0.01em] text-ink group-hover:text-ink transition-colors">
                  Inquiry List
                </span>
                <span className="mt-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-ink/45">
                  {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'} pending` : 'Empty'}
                </span>
              </span>
              {itemCount > 0 && (
                <span
                  className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-medium tabular-nums"
                  style={{ backgroundColor: 'var(--color-accent-gold)', color: '#16130F' }}
                >
                  {itemCount}
                </span>
              )}
            </Link>
          </div>
        </nav>

        {/* Drawer footer — quiet legal/meta + admin sign-in. */}
        <div
          className="shrink-0 px-6 py-4 border-t border-ink/[0.07] flex items-center justify-between gap-3"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35 leading-relaxed">
            {siteConfig.compliance.navLines[0]}<br />{siteConfig.compliance.navLines[1]}
          </p>
          <Link
            to="/admin"
            onClick={onClose}
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-full px-3 -mr-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45 hover:text-holo-light transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-holo/35"
          >
            Admin →
          </Link>
        </div>
      </aside>
    </>,
    document.body,
  );
}
