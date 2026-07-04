/**
 * BottomNav
 *
 * Persistent floating chrome island, shown at all viewports. Centered
 * at the bottom in a compact rounded-full pill.
 *
 *   [ Home ] [ Library ] [ Research Supplies ▸ ] [ Lab Equipment ] [ Contact ]
 *
 * The Research Supplies slot is a mega-item — tap opens a bottom
 * sheet listing the three compound categories. This keeps the pill
 * at a stable slot count even as catalog domains grow.
 *
 * Monochrome chrome — no holo tint on the pill itself. Active icons
 * come alive with theme-cyan accents (orbiting electrons on the atom,
 * pulses / bubbles / sweeps on the others). Respects prefers-reduced-motion.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export type NavRole = 'guest' | 'owner';

/* Monochrome-instrument: active nav accents use brushed silver (the "gold"
   token now holds silver). Both were distinct accents (teal + gold); unified
   to one neutral silver so the nav reads monochrome. */
const ACCENT = 'rgb(var(--c-gold))';
const GOLD = 'rgb(var(--c-gold))';

/* ── prefers-reduced-motion hook ────────────────────────────────────────── */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ── Icon components ────────────────────────────────────────────────────────
   Each icon takes an `active` flag. When active, a complementary cyan
   accent animates within the icon's own form. When prefers-reduced-motion
   is set, the accent renders as a static lit dot — the icon still reads
   as "alive" but stops moving. */

interface IconProps {
  active: boolean;
  reduce: boolean;
}

function HomeIcon({ active, reduce }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
      {active && (
        <>
          {/* Window-light: door interior glows. Static dot under reduced motion. */}
          <circle
            cx="12"
            cy="17.5"
            r="1.5"
            fill={ACCENT}
            stroke="none"
            style={{ filter: `drop-shadow(0 0 2px ${ACCENT})` }}
          >
            {!reduce && (
              <animate attributeName="opacity" values="0.45;1;0.45" dur="1.6s" repeatCount="indefinite" />
            )}
          </circle>
        </>
      )}
    </svg>
  );
}

// Research Library — gold owl (knowledge / the library). Drawn in brand
// gold regardless of active state; the pupils give a slow blink when the
// route is live (static under reduced motion).
function OwlIcon({ active, reduce }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.2 5.4 9 8" />
      <path d="M16.8 5.4 15 8" />
      <path d="M12 4C8.1 4 5 7.1 5 11v2.5a7 7 0 0 0 14 0V11c0-3.9-3.1-7-7-7Z" />
      <circle cx="9.5" cy="10.5" r="2.1" />
      <circle cx="14.5" cy="10.5" r="2.1" />
      <path d="M12 11.7 11 13.2h2Z" />
      <path d="M10.2 20.6v1.1" />
      <path d="M13.8 20.6v1.1" />
      <circle cx="9.5" cy="10.5" r="0.6" fill={GOLD} stroke="none" style={active ? { filter: `drop-shadow(0 0 2px ${GOLD})` } : undefined}>
        {active && !reduce && (
          <animate attributeName="r" values="0.6;0.6;0.15;0.6" keyTimes="0;0.85;0.92;1" dur="4s" repeatCount="indefinite" />
        )}
      </circle>
      <circle cx="14.5" cy="10.5" r="0.6" fill={GOLD} stroke="none" style={active ? { filter: `drop-shadow(0 0 2px ${GOLD})` } : undefined}>
        {active && !reduce && (
          <animate attributeName="r" values="0.6;0.6;0.15;0.6" keyTimes="0;0.85;0.92;1" dur="4s" repeatCount="indefinite" />
        )}
      </circle>
    </svg>
  );
}

function FlaskIcon({ active, reduce }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6" />
      <path d="M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M7 14h10" />
      {active && (
        <>
          {/* Bubbles rising from below the liquid line (y=14). Two bubbles,
              staggered so the rise feels organic. */}
          <circle cx="10.5" cy="19" r="0.85" fill={ACCENT} stroke="none" style={{ filter: `drop-shadow(0 0 1.5px ${ACCENT})` }}>
            {!reduce && (
              <>
                <animate attributeName="cy" values="19;14.5" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="1.8s" repeatCount="indefinite" />
              </>
            )}
          </circle>
          <circle cx="13.5" cy="20" r="0.7" fill={ACCENT} stroke="none" style={{ filter: `drop-shadow(0 0 1.5px ${ACCENT})` }}>
            {!reduce && (
              <>
                <animate attributeName="cy" values="20;14.5" dur="2.2s" begin="-0.9s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.2s" begin="-0.9s" repeatCount="indefinite" />
              </>
            )}
          </circle>
        </>
      )}
    </svg>
  );
}

function MicroscopeIcon({ active, reduce }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 18h8" />
      <path d="M3 22h18" />
      <path d="M14 22a7 7 0 1 0 0-14" />
      <path d="M9 14h2" />
      <path d="M9 12a2 2 0 0 1-2-2V6h4v4a2 2 0 0 1-2 2Z" />
      <path d="M12 6 8.5 2.5a2.12 2.12 0 0 0-3 3L9 9" />
      {active && (
        <>
          {/* Specimen spotlight — bright dot on the stage where the slide sits. */}
          <circle cx="9" cy="14" r="1.4" fill={ACCENT} stroke="none" style={{ filter: `drop-shadow(0 0 2.5px ${ACCENT})` }}>
            {!reduce && (
              <animate attributeName="r" values="0.9;1.6;0.9" dur="1.6s" repeatCount="indefinite" />
            )}
          </circle>
        </>
      )}
    </svg>
  );
}

function MailIcon({ active, reduce }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
      {active && (
        <>
          {/* Signal dot tracing the envelope fold — left to right sweep. */}
          <circle r="1.2" fill={ACCENT} stroke="none" style={{ filter: `drop-shadow(0 0 2px ${ACCENT})` }}>
            {reduce ? (
              // Static dot at envelope center (delivered).
              <>
                <animate attributeName="cx" values="12" dur="0.001s" fill="freeze" />
                <animate attributeName="cy" values="13" dur="0.001s" fill="freeze" />
              </>
            ) : (
              <animateMotion dur="2.2s" repeatCount="indefinite" path="M 3 7 L 12 13 L 21 7" />
            )}
          </circle>
        </>
      )}
    </svg>
  );
}

/* ── Sheet data ─────────────────────────────────────────────────────────── */

interface SheetEntry {
  to: string;
  label: string;
  caption: string;
}

const RESEARCH_SUPPLIES_SHEET: SheetEntry[] = [
  {
    to: '/research-supplies/biopeptide',
    label: 'Biopeptide',
    caption: 'Metabolic · Regenerative · Growth-factor',
  },
  {
    to: '/research-supplies/nootropics',
    label: 'Nootropics',
    caption: 'Cognition · Plasticity · Neuroprotection',
  },
  {
    to: '/research-supplies/skincare',
    label: 'Skincare',
    caption: 'Barrier · Repair · Pigmentation',
  },
];

/* ── Component ──────────────────────────────────────────────────────────── */

interface BottomNavProps {
  role?: NavRole;
}

export function BottomNav({ role = 'guest' }: BottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [sheetOpen, setSheetOpen] = useState(false);

  const path = location.pathname;
  const isHome = path === '/';
  const isResearchLibrary =
    path.startsWith('/research') && !path.startsWith('/research-supplies');
  const isResearchSupplies = path.startsWith('/research-supplies');
  const isLabEquipment = path.startsWith('/laboratory-equipment');
  const isContact = path.startsWith('/contact');

  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  useEffect(() => {
    setSheetOpen(false);
  }, [path]);

  // Persistent hint — show whenever the sheet is closed and the user isn't
  // already on a research-supplies page.
  const showHint = !sheetOpen && !isResearchSupplies;

  function handleSheetEntry(to: string) {
    setSheetOpen(false);
    navigate(to);
  }

  return (
    <>
      {sheetOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 z-40 bg-ink/55 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Research supplies — choose a domain"
            className="fixed left-1/2 -translate-x-1/2 z-50"
            style={{
              // Sit just above the pill: pill_bottom (safe-area or 2px) +
              // pill_height (~36px) + small gap (8px).
              bottom: 'calc(max(2px, env(safe-area-inset-bottom)) + 44px)',
              width: 'min(360px, calc(100vw - 1.5rem))',
              background: 'var(--botnav-sheet-grad)',
              border: '0.5px solid var(--botnav-border)',
              borderRadius: '20px',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: 'var(--botnav-shadow-sheet)',
            }}
          >
            <div className="px-4 pt-4 pb-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink/40">
                Research Supplies
              </p>
              <p className="mt-1 text-[11px] text-ink/55">
                Choose a research domain.
              </p>
            </div>
            <ul className="px-2 pb-2">
              {RESEARCH_SUPPLIES_SHEET.map((entry) => {
                const isActive = path.startsWith(entry.to);
                return (
                  <li key={entry.to}>
                    <button
                      type="button"
                      onClick={() => handleSheetEntry(entry.to)}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'w-full flex items-center justify-between gap-3 px-3 py-3 rounded-[10px] transition-colors',
                        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40',
                        isActive
                          ? 'bg-ink/[0.10]'
                          : 'hover:bg-ink/[0.05] active:bg-ink/[0.08]',
                      ].join(' ')}
                    >
                      <span className="flex flex-col items-start min-w-0">
                        <span className={`text-[13px] tracking-tight ${isActive ? 'text-ink' : 'text-ink/85'}`}>
                          {entry.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink/40 mt-0.5">
                          {entry.caption}
                        </span>
                      </span>
                      <span aria-hidden="true" className="text-ink/35 text-sm shrink-0">
                        →
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 pb-3 pt-1 border-t border-ink/[0.06]">
              <Link
                to="/research-supplies"
                onClick={() => setSheetOpen(false)}
                className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-ink/45 hover:text-ink/80 transition-colors"
              >
                View hub →
              </Link>
            </div>
          </div>
        </>
      )}

      <nav
        className="fixed left-1/2 -translate-x-1/2 z-30"
        data-role={role}
        aria-label="Primary"
        style={{
          // Hug the bottom of the visible viewport. On notch / home-indicator
          // devices the safe-area inset keeps it clear of the home bar;
          // otherwise it sits 2px above the absolute bottom edge.
          bottom: 'max(2px, env(safe-area-inset-bottom))',
          background: 'var(--botnav-grad)',
          border: '0.5px solid var(--botnav-border)',
          borderRadius: '9999px',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: 'var(--botnav-shadow)',
        }}
      >
        {/* Hint — points at the center Research Supplies slot. */}
        {showHint && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 whitespace-nowrap"
          >
            <span
              className={`relative inline-block rounded-full px-2 py-[2.5px] text-[7px] font-medium uppercase tracking-[0.22em] ${reduce ? '' : 'vsr-nav-hint-glitch'}`}
              style={{
                color: 'var(--color-content-inverse)',
                background: 'linear-gradient(180deg, rgb(var(--c-gold)) 0%, rgb(var(--c-gold-dark)) 100%)',
                border: '0.5px solid rgba(140,110,50,0.6)',
                boxShadow:
                  '0 2px 8px -2px rgba(26,23,20,0.35)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
              }}
            >
              Research Supplies
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-full -translate-x-1/2"
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: '4px solid rgb(var(--c-gold-dark))',
                }}
              />
            </span>
          </div>
        )}

        <ul className="flex items-center gap-2 px-3 py-1">
          <NavSlot isActive={isHome} ariaLabel="Home" kind="link" to="/">
            <HomeIcon active={isHome} reduce={reduce} />
          </NavSlot>
          <NavSlot isActive={isResearchLibrary} ariaLabel="Research library — compound intelligence" kind="link" to="/research">
            <OwlIcon active={isResearchLibrary} reduce={reduce} />
          </NavSlot>
          <NavSlot
            isActive={isResearchSupplies}
            ariaLabel="Research supplies — choose domain"
            kind="button"
            onClick={() => setSheetOpen((v) => !v)}
            ariaExpanded={sheetOpen}
          >
            <FlaskIcon active={isResearchSupplies} reduce={reduce} />
          </NavSlot>
          <NavSlot isActive={isLabEquipment} ariaLabel="Laboratory equipment" kind="link" to="/laboratory-equipment">
            <MicroscopeIcon active={isLabEquipment} reduce={reduce} />
          </NavSlot>
          <NavSlot isActive={isContact} ariaLabel="Contact" kind="link" to="/contact">
            <MailIcon active={isContact} reduce={reduce} />
          </NavSlot>
        </ul>
      </nav>
    </>
  );
}

/* ── NavSlot ────────────────────────────────────────────────────────────── */

type NavSlotProps =
  | {
      kind: 'link';
      to: string;
      isActive: boolean;
      ariaLabel: string;
      children: ReactNode;
    }
  | {
      kind: 'button';
      onClick: () => void;
      isActive: boolean;
      ariaLabel: string;
      ariaExpanded: boolean;
      children: ReactNode;
    };

function NavSlot(props: NavSlotProps) {
  const baseClass = [
    'relative flex items-center justify-center h-7 w-14 rounded-full transition-colors duration-150',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40',
    props.isActive ? 'text-ink' : 'text-ink/50 hover:text-ink/90',
  ].join(' ');
  const style = props.isActive
    ? {
        backgroundColor: 'var(--color-interactive-secondary)',
        boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.18)',
      }
    : undefined;

  return (
    <li>
      {props.kind === 'link' ? (
        <Link
          to={props.to}
          aria-label={props.ariaLabel}
          aria-current={props.isActive ? 'page' : undefined}
          className={baseClass}
          style={style}
        >
          {props.children}
        </Link>
      ) : (
        <button
          type="button"
          onClick={props.onClick}
          aria-label={props.ariaLabel}
          aria-expanded={props.ariaExpanded}
          aria-haspopup="menu"
          className={baseClass}
          style={style}
        >
          {props.children}
        </button>
      )}
    </li>
  );
}
