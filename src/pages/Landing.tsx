/**
 * Landing
 * E4 — Landing visual evolution.
 *
 * Rebuilt from a centered editorial stack into an operational research
 * platform composition:
 *
 *   1. Hero            — asymmetric two-column. Left: mono operational
 *                        signature, tight mixed-weight display, scope
 *                        statement, instrument spec rail, dual CTA.
 *                        Right: OperationalVisualBay (the framed
 *                        procedural visual system).
 *   2. 01 Procurement  — metadata rail + instrumented catalog routes
 *                        carrying specimen anchors.
 *   3. 02 Records      — metadata rail + batch-tracked document archive.
 *   4. 03 Sequence     — operational sequence strip, field references,
 *                        and the single formal inquiry intake.
 *   5. Disclosure      — compliance-oriented close.
 *
 * Composition laws:
 *   - Asymmetric. A persistent left metadata rail (mono index + meta)
 *     runs against a wider content column. Nothing is centered-stacked.
 *   - Mono is a first-class voice — the operational signature, indices,
 *     readouts, and codes. Gold is the single accent (live signals and
 *     the one primary CTA), held under ~10% of any surface.
 *   - Hairline grammar (`border-white/[0.1]`) separates modules; the
 *     surface depth and the bay carry dimension, not glass.
 *   - One orchestrated page-load (op-reveal stagger); the bay self-draws.
 *     All motion is CSS, suppressed under reduced-motion.
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import documentsData from '../data/documents.json';
import type { Document } from '../types';
import { DocumentGallery } from '../components/documents/DocumentGallery';
import { CompoundIntelligenceHero } from '../components/landing/CompoundIntelligenceHero';
import { HeroHoloCarousel } from '../components/landing/HeroHoloCarousel';
import { LegalDisclaimer } from '../components/landing/LegalDisclaimer';
import { SameDayDeliveryBadge } from '../components/landing/SameDayDeliveryBadge';

const documents = documentsData as unknown as Document[];

/* ── Module header rail ───────────────────────────────────────────────────
   The persistent asymmetry primitive. A mono index + label + operational
   meta lines run in a narrow rail against the wider content column. On
   mobile the rail sits inline above the content; on lg it becomes the
   left column with a vertical hairline seam. */

interface ModuleRailProps {
  index: string;
  label: string;
  meta: Array<[string, string]>;
}

function ModuleRail({ index, label, meta }: ModuleRailProps) {
  return (
    <div className="lg:col-span-3 lg:border-r lg:border-white/[0.1] lg:pr-[var(--space-8)]">
      <div className="flex items-baseline gap-[var(--space-3)] lg:flex-col lg:items-start lg:gap-[var(--space-4)]">
        <span className="holo-text-display font-mono text-[13px] tabular-nums tracking-[0.1em]">
          {index}
        </span>
        <span className="holo-text-caption text-[11px] uppercase tracking-[0.3em]">
          {label}
        </span>
      </div>
      <dl className="mt-[var(--space-5)] hidden gap-[var(--space-3)] lg:grid">
        {meta.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-[var(--space-3)] border-t border-holo/10 pt-[var(--space-2)]"
          >
            <dt className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">
              {k}
            </dt>
            <dd className="holo-text-body font-mono text-[11px] tabular-nums tracking-[0.06em]">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface ModuleProps {
  index: string;
  label: string;
  meta: Array<[string, string]>;
  children: ReactNode;
  /** aria-label for the section landmark. */
  aria: string;
  /** Optional element id — used by hero "Begin Inquiry" smooth-scroll. */
  id?: string;
}

function Module({ index, label, meta, children, aria, id }: ModuleProps) {
  return (
    <section
      id={id}
      className="-mx-[var(--space-6)] border-b border-white/[0.1]"
      aria-label={aria}
      style={id ? { scrollMarginTop: '4rem' } : undefined}
    >
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-[var(--space-8)] px-[var(--space-6)] py-[var(--space-12)] sm:py-[var(--space-14)] lg:grid-cols-12 lg:gap-[var(--space-10)]">
        <ModuleRail index={index} label={label} meta={meta} />
        <div className="lg:col-span-9">{children}</div>
      </div>
    </section>
  );
}

/* ── Instrumented catalog route row ──────────────────────────────────────── */

interface RouteRowProps {
  to: string;
  index: string;
  title: string;
  scope: string;
  readout: string;
  specimen: string;
  specimenAlt: string;
  last?: boolean;
}

function RouteRow({
  to,
  index,
  title,
  scope,
  readout,
  specimen,
  specimenAlt,
}: RouteRowProps) {
  return (
    <Link
      to={to}
      className={[
        'research-surface-solid group flex items-center gap-[var(--space-5)]',
        'px-[var(--space-5)] py-[var(--space-5)]',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25',
      ].join(' ')}
    >
      <div className="hidden h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius-procurement)] border border-white/[0.08] bg-[var(--surface-specimen-bay)] sm:block">
        <img
          src={specimen}
          alt={specimenAlt}
          loading="lazy"
          className="h-full w-full scale-[1.55] object-cover opacity-80 transition-opacity duration-150 group-hover:opacity-100"
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-white/30">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-light tracking-tight text-white sm:text-lg">
          {title}
        </h3>
        <p className="mt-[var(--space-1-5)] text-[13px] leading-relaxed text-white/45">
          {scope}
        </p>
      </div>
      <div className="hidden shrink-0 text-right md:block">
        <p className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-white/45">
          {readout}
        </p>
        <p className="mt-[var(--space-1)] text-[10px] uppercase tracking-[0.24em] text-white/25">
          Indexed
        </p>
      </div>
      <span
        aria-hidden="true"
        className="shrink-0 text-lg text-white/25 transition-colors duration-150 group-hover:text-holo-light"
      >
        →
      </span>
    </Link>
  );
}

/* ── Operational sequence step ───────────────────────────────────────────── */

const SEQUENCE: Array<{ code: string; title: string; body: string }> = [
  {
    code: 'S1',
    title: 'Inquiry',
    body: 'Catalog identifiers, dose tiers, and volumes submitted as a structured request.',
  },
  {
    code: 'S2',
    title: 'Verification',
    body: 'Buyer eligibility and institutional context reviewed before quotation.',
  },
  {
    code: 'S3',
    title: 'Quotation',
    body: 'Pricing, lead time, and batch availability confirmed in writing.',
  },
  {
    code: 'S4',
    title: 'Fulfilment',
    body: 'Release against documented batch references with certificates on file.',
  },
];

const REFERENCES: Array<{ quote: string; name: string; role: string }> = [
  {
    quote:
      'Certificates of analysis arrived alongside batch confirmation. Documentation was available before request.',
    name: 'M. Chen',
    role: 'Research Procurement Lead · Northeast U.S.',
  },
  {
    quote:
      'Batch references matched our intake records exactly. Reconciliation took minutes, not a cycle.',
    name: 'J. Park',
    role: 'Laboratory Manager · Independent facility',
  },
  {
    quote:
      'Inquiry turnaround was consistent. Repeat dose tiers were quoted within one business day.',
    name: 'K. Whitfield',
    role: 'Senior Researcher · University partner',
  },
];

/* Bay Bridge "Bay Lights" — the vertical suspender rods that carry the
   luminous trickle (Leo Villareal's installation lived on exactly these
   cables). Each rod's top point; all meet the deck at y=92. Ordered
   left→right across the span so the cascade ripples like the real thing. */
const BRIDGE_SUSPENDERS: ReadonlyArray<{ x: number; yTop: number }> = [
  { x: 46, yTop: 87.7 },
  { x: 59, yTop: 85.5 },
  { x: 72, yTop: 83.2 },
  { x: 85, yTop: 80.9 },
  { x: 98, yTop: 78.6 },
  { x: 111, yTop: 76.3 },
  { x: 124, yTop: 73.9 },
  { x: 137, yTop: 71.5 },
  { x: 150, yTop: 69.1 },
  { x: 163, yTop: 66.7 },
  { x: 176, yTop: 64.2 },
  { x: 189, yTop: 61.6 },
  { x: 202, yTop: 59.1 },
  { x: 215, yTop: 56.5 },
  { x: 228, yTop: 53.9 },
  { x: 241, yTop: 51.2 },
  { x: 254, yTop: 48.6 },
  { x: 267, yTop: 45.9 },
  { x: 280, yTop: 43.1 },
  { x: 293, yTop: 40.3 },
  { x: 306, yTop: 37.5 },
  { x: 319, yTop: 34.7 },
  { x: 332, yTop: 31.8 },
  { x: 345, yTop: 28.9 },
  { x: 358, yTop: 26 },
  { x: 371, yTop: 23.1 },
  { x: 384, yTop: 20.1 },
  { x: 426, yTop: 22.5 },
  { x: 439, yTop: 29.3 },
  { x: 452, yTop: 35.9 },
  { x: 465, yTop: 42.3 },
  { x: 478, yTop: 48.6 },
  { x: 491, yTop: 54.7 },
  { x: 504, yTop: 60.6 },
  { x: 517, yTop: 66.4 },
  { x: 530, yTop: 72 },
  { x: 543, yTop: 77.4 },
  { x: 556, yTop: 82.7 },
  { x: 569, yTop: 87.8 },
];

export function Landing() {
  return (
    <>
      {/* ── HERO · COMPOUND INTELLIGENCE ─────────────────────────────────── */}
      <section
        className="-mx-[var(--space-6)] border-b border-white/[0.1]"
        aria-label="Compound intelligence"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] pt-[var(--space-6)] pb-[var(--space-12)] sm:pt-[var(--space-8)] sm:pb-[var(--space-16)]">
          {/* Two-column layout: text left, reserved media slot right.
              Slot is structural — built so future animated media drops in
              without redesigning the hero. */}
          <div className="grid grid-cols-1 gap-[var(--space-8)] md:grid-cols-12 md:items-center">

            {/* ── TEXT COLUMN ─────────────────────────────────────────── */}
            <div className="md:col-span-6 relative">

              {/* WhatsApp CTA — flowing silver-cyan pill. The wrapper
                  matches the body paragraph's max-w-[52ch] so the button
                  centers above the paragraph's actual width, not the
                  full text column. */}
              <div
                className="hero-whatsapp-wrap"
                style={{
                  left: '-8px',
                  width: '100%',
                  maxWidth: '52ch',
                  display: 'flex',
                  zIndex: 50,
                  pointerEvents: 'none',
                }}
              >
              <a
                href="https://wa.me/15555551234"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contact us on WhatsApp"
                className="hero-whatsapp-cta group inline-flex items-center gap-2"
                style={{
                  pointerEvents: 'auto',
                  padding: '5px 11px 5px 9px',
                  borderRadius: '999px',
                  background:
                    'linear-gradient(90deg, rgba(170,225,255,0.95) 0%, rgba(255,255,255,1) 22%, rgba(170,220,250,0.92) 44%, rgba(255,255,255,1) 66%, rgba(170,225,255,0.95) 88%, rgba(220,240,255,1) 100%)',
                  backgroundSize: '240% 100%',
                  backgroundPosition: '0% 0%',
                  color: 'rgb(15, 26, 46)',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: '9.5px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  boxShadow:
                    '0 0 0 0.5px rgba(200,235,255,0.85), 0 0 16px rgba(170,225,255,0.85), 0 0 34px rgba(120,200,245,0.65), 0 0 52px rgba(110,195,245,0.4), 0 4px 16px rgba(100,180,235,0.3), inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(40,80,120,0.18)',
                  animation: 'hero-whatsapp-anim 6s linear infinite',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="relative"
                >
                  <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.76.46 3.45 1.32 4.95l-1.44 5.27 5.4-1.42c1.45.8 3.08 1.22 4.72 1.22 5.52 0 10-4.48 10-10s-4.48-10-10-10zm0 18.16c-1.5 0-2.99-.42-4.27-1.21l-.3-.18-3.18.83.85-3.1-.2-.32c-.87-1.39-1.32-2.99-1.32-4.6 0-4.78 3.9-8.66 8.7-8.66 2.32 0 4.5.9 6.14 2.53 1.64 1.64 2.55 3.81 2.55 6.13 0 4.79-3.9 8.67-8.7 8.67zm4.97-6.5c-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.6.14-.18.27-.7.88-.85 1.05-.16.18-.31.2-.58.07-.27-.14-1.14-.42-2.18-1.34-.81-.72-1.35-1.6-1.5-1.88-.16-.27-.02-.42.12-.55.12-.12.27-.31.4-.46.13-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.45-.82-1.98-.22-.53-.45-.45-.6-.45-.15-.01-.33-.01-.51-.01-.18 0-.46.07-.71.34-.25.27-.94.91-.94 2.22 0 1.31.96 2.58 1.09 2.75.14.18 1.9 2.91 4.62 4.07.64.28 1.16.45 1.55.58.65.2 1.25.18 1.72.11.52-.08 1.6-.65 1.83-1.28.22-.63.22-1.18.15-1.28-.07-.1-.25-.16-.51-.3z" />
                </svg>
                <span className="relative">Contact us on WhatsApp</span>
                <span className="relative text-[11px] -mr-0.5" aria-hidden="true">→</span>
              </a>
              </div>

              {/* Bay Bridge architectural micrograph — sits low, anchored
                  to the bottom of the column. Two suspension towers with
                  cross-bracing, catenary main cables, suspender verticals,
                  roadway deck, anchorages, dimension labels. Top portion
                  fades so it doesn't reach into the body copy. */}
              <div
                aria-hidden="true"
                className="hero-bridge-arch pointer-events-none absolute opacity-75 hidden md:block"
                style={{ height: '140px', bottom: '-72px', left: '48px', right: '-40px' }}
              >
                <svg
                  viewBox="0 0 600 140"
                  preserveAspectRatio="xMidYEnd meet"
                  className="h-full w-full"
                >
                  <defs>
                    {/* Soft halo for the Bay Lights trickle */}
                    <filter id="bayLightGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="1.4" />
                    </filter>
                  </defs>

                  {/* Project labels — silver mono micrograph */}
                  <text x="6" y="9" fontFamily="monospace" fontSize="6" fill="rgba(205,220,235,0.75)" letterSpacing="0.22em">BAY BRIDGE · EAST SPAN</text>
                  <text x="525" y="9" fontFamily="monospace" fontSize="6" fill="rgba(205,220,235,0.75)" letterSpacing="0.18em">OPENED 2013</text>

                  {/* Main cable — single self-anchored loop: deck → over tower
                      top → deck. Two Q segments meeting at the tower saddle. */}
                  <path d="M 20,92 Q 215,60 410,14" fill="none" stroke="rgba(225,235,245,1)" strokeWidth="1.1" strokeLinecap="round" />
                  <path d="M 410,14 Q 495,60 580,92" fill="none" stroke="rgba(225,235,245,1)" strokeWidth="1.1" strokeLinecap="round" />

                  {/* Suspender verticals — dense rod field, each top riding
                      the catenary cable (see BRIDGE_SUSPENDERS). */}
                  <g stroke="rgba(180,200,220,0.55)" strokeWidth="0.4">
                    {BRIDGE_SUSPENDERS.map(({ x, yTop }) => (
                      <line key={`rod-${x}`} x1={x} y1={yTop} x2={x} y2={92} />
                    ))}
                  </g>

                  {/* Single tower — four-legged from the bridge's iconic
                      side view. Legs flare slightly at the base and
                      converge near the top, with cross-bracing visible. */}
                  <g stroke="rgba(232,240,248,1)" strokeWidth="1.1" strokeLinecap="round">
                    {/* Outer pair (visible legs) */}
                    <line x1="404" y1="92" x2="408" y2="12" />
                    <line x1="416" y1="92" x2="412" y2="12" />
                    {/* Inner pair (back legs, slightly dimmer perspective) */}
                  </g>
                  <g stroke="rgba(200,215,230,0.75)" strokeWidth="0.65" strokeLinecap="round">
                    <line x1="407" y1="92" x2="409" y2="12" />
                    <line x1="413" y1="92" x2="411" y2="12" />
                  </g>

                  {/* Tower cross-bracing — horizontal beams between the legs */}
                  <g stroke="rgba(200,215,230,0.7)" strokeWidth="0.5">
                    <line x1="404.5" y1="20" x2="415.5" y2="20" />
                    <line x1="405" y1="32" x2="415" y2="32" />
                    <line x1="405.5" y1="44" x2="414.5" y2="44" />
                    <line x1="406" y1="56" x2="414" y2="56" />
                    <line x1="406.5" y1="68" x2="413.5" y2="68" />
                    <line x1="407" y1="80" x2="413" y2="80" />
                  </g>
                  {/* Internal X bracing (subtle) */}
                  <g stroke="rgba(180,200,220,0.45)" strokeWidth="0.35">
                    <line x1="404.5" y1="20" x2="415" y2="32" />
                    <line x1="415.5" y1="20" x2="405" y2="32" />
                    <line x1="405" y1="32" x2="414.5" y2="44" />
                    <line x1="415" y1="32" x2="405.5" y2="44" />
                    <line x1="405.5" y1="44" x2="414" y2="56" />
                    <line x1="414.5" y1="44" x2="406" y2="56" />
                    <line x1="406" y1="56" x2="413.5" y2="68" />
                    <line x1="414" y1="56" x2="406.5" y2="68" />
                    <line x1="406.5" y1="68" x2="413" y2="80" />
                    <line x1="413.5" y1="68" x2="407" y2="80" />
                  </g>

                  {/* Saddle at tower top — small horizontal piece where the
                      main cable passes over. */}
                  <line x1="406" y1="12" x2="414" y2="12" stroke="rgba(232,240,248,1)" strokeWidth="1.1" strokeLinecap="round" />

                  {/* Roadway deck — single wide deck (East Span is single deck) */}
                  <line x1="0" y1="92" x2="600" y2="92" stroke="rgba(220,232,242,0.95)" strokeWidth="0.85" />
                  <line x1="0" y1="98" x2="600" y2="98" stroke="rgba(200,215,230,0.6)" strokeWidth="0.5" />

                  {/* Pier extending down from tower base into water */}
                  <g stroke="rgba(200,215,230,0.65)" strokeWidth="0.6">
                    <line x1="406" y1="98" x2="406" y2="128" />
                    <line x1="414" y1="98" x2="414" y2="128" />
                    <line x1="404" y1="128" x2="416" y2="128" />
                  </g>

                  {/* Waterline */}
                  <line x1="0" y1="132" x2="600" y2="132" stroke="rgba(180,200,220,0.35)" strokeWidth="0.3" strokeDasharray="3 4" />

                  {/* Dimension marks */}
                  <text x="295" y="14" fontFamily="monospace" fontSize="5" fill="rgba(205,220,235,0.65)" letterSpacing="0.1em">MAIN SPAN 1,263 FT</text>
                  <text x="403" y="138" fontFamily="monospace" fontSize="5" fill="rgba(205,220,235,0.6)" letterSpacing="0.12em">SAS TOWER · 525 FT</text>

                  {/* ── Bay Lights ──────────────────────────────────────────
                      A luminous point trickles down each suspender cable,
                      cascading left→right across the span. Purely additive
                      and motion-gated: the `.bay-lights` group is invisible
                      under reduced-motion, so the static micrograph is the
                      accessible default. `pathLength={1}` normalizes every
                      rod regardless of length; `--op-delay` staggers the
                      ripple. A blurred halo pass + a crisp core pass read
                      together as a single light. */}
                  <g className="bay-lights">
                    <g filter="url(#bayLightGlow)">
                      {BRIDGE_SUSPENDERS.map(({ x, yTop }, i) => (
                        <line
                          key={`bl-glow-${x}`}
                          className="op-trickle"
                          x1={x}
                          y1={yTop}
                          x2={x}
                          y2={92}
                          pathLength={1}
                          stroke="rgba(150,205,255,0.85)"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          style={{ ['--op-delay' as string]: `${i * 80}ms` }}
                        />
                      ))}
                    </g>
                    {BRIDGE_SUSPENDERS.map(({ x, yTop }, i) => (
                      <line
                        key={`bl-core-${x}`}
                        className="op-trickle"
                        x1={x}
                        y1={yTop}
                        x2={x}
                        y2={92}
                        pathLength={1}
                        stroke="rgba(238,247,255,0.95)"
                        strokeWidth={0.75}
                        strokeLinecap="round"
                        style={{ ['--op-delay' as string]: `${i * 80}ms` }}
                      />
                    ))}
                  </g>
                </svg>
              </div>

              {/* Content above the map */}
              <div className="relative z-10">
              {/* Hero eyebrow removed — replaced by the vertical flow strip
                  positioned at the grid level above. */}

              <h1
                className="op-reveal mt-[var(--space-4)] text-[clamp(1.45rem,2.8vw,2.0rem)] leading-[1.1] tracking-[-0.02em] text-white"
                style={{ ['--op-delay' as string]: '90ms' }}
              >
                <span className="font-light text-white/85">
                  Bay Area biopeptide sciences.
                </span>
                <br />
                <span className="font-medium text-white">Highest purity, on demand.</span>
              </h1>

              <p
                className="op-reveal mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed text-white/60"
                style={{ ['--op-delay' as string]: '170ms' }}
              >
                <strong
                  className="font-semibold text-white"
                  style={{ textShadow: '0 0 8px rgba(255,255,255,0.18)' }}
                >
                  Velari Systems Research Labs
                </strong>{' '}
                is a Northern California research company specializing in{' '}
                <span
                  className="font-medium text-holo-light"
                  style={{ textShadow: '0 0 6px rgba(100,200,255,0.4), 0 0 14px rgba(100,200,255,0.18)' }}
                >
                  peptides, nootropics, and skincare-grade compounds
                </span>
                {' '}— all supplied at research-grade purity.{' '}
                <SameDayDeliveryBadge />
                {' '}and{' '}
                <span
                  className="font-medium text-holo-light"
                  style={{ textShadow: '0 0 6px rgba(100,200,255,0.4)' }}
                >
                  next-day
                </span>
                {' '}delivery available across the Bay Area on select orders.
                {' '}But we're a research company first — so we share what we
                know. Every compound here carries an{' '}
                <span
                  className="font-medium text-holo-light"
                  style={{ textShadow: '0 0 6px rgba(100,200,255,0.4), 0 0 14px rgba(100,200,255,0.18)' }}
                >
                  open research dossier
                </span>
                {' '}— mechanism, receptor data, and the published study
                record — so you can learn the science behind every compound
                we carry.
              </p>

              <div
                className="op-reveal mt-[var(--space-6)] flex flex-wrap items-center gap-[var(--space-3)]"
                style={{ ['--op-delay' as string]: '240ms' }}
              >
                <a
                  href="#inventory"
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById('inventory');
                    if (el) {
                      el.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                      if (history.replaceState) {
                        history.replaceState(null, '', '#inventory');
                      }
                    }
                  }}
                  className="hero-cta-gold group relative inline-flex items-center justify-center overflow-hidden rounded-full px-[14px] py-[7px] text-[9.5px] font-medium uppercase tracking-[0.22em] text-black transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <span aria-hidden="true" className="hero-cta-gold-sheen pointer-events-none absolute inset-0" />
                  <span className="relative">Begin Inquiry</span>
                </a>
                <Link
                  to="/research"
                  className="hero-cta-holo group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-[14px] py-[7px] text-[9.5px] uppercase tracking-[0.22em] text-holo-light transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
                >
                  <span aria-hidden="true" className="hero-cta-holo-sheen pointer-events-none absolute inset-0" />
                  <span className="relative">View Research</span>
                  <span
                    aria-hidden="true"
                    className="relative text-holo/70 transition-colors duration-300 group-hover:text-holo-light"
                  >
                    →
                  </span>
                </Link>
              </div>
              </div>
            </div>

            {/* ── RESERVED MEDIA SLOT ─────────────────────────────────── */}
            {/* Structural placeholder for future compound visualization —
                animated molecular structures, motion graphics, research
                media. Captioned scientific panel, not construction sign. */}
            <div
              className="op-reveal md:col-span-6"
              style={{ ['--op-delay' as string]: '210ms' }}
            >
              <div
                className="module-aura relative aspect-[5/4] w-full overflow-hidden"
                style={{
                  backgroundColor: '#070707',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
                aria-label="Compound visualization placeholder"
              >
                {/* Corner registration marks — scientific panel cue */}
                <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 border-l border-t border-white/20" />
                <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 border-r border-t border-white/20" />
                <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b border-l border-white/20" />
                <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 h-2.5 w-2.5 border-b border-r border-white/20" />

                {/* Top-left caption — micrographic data block */}
                <div className="absolute left-4 top-4 z-10 flex flex-col gap-1">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/30">
                    Compound Visualization
                  </span>
                  <span className="font-mono text-[8.5px] tabular-nums tracking-[0.18em] text-white/22">
                    FIG-01
                  </span>
                  <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-cyan-300/70">
                    <span className="font-bold">Compound of the Month:</span>{' '}
                    <span
                      className="font-bold"
                      style={{
                        color: '#FF8A2E',
                        textShadow:
                          '0 0 4px rgba(255,138,46,0.85), 0 0 10px rgba(255,138,46,0.55), 0 0 18px rgba(255,138,46,0.3)',
                      }}
                    >
                      Retatrutide
                    </span>
                  </span>
                </div>

                {/* Subtle grid backdrop — instrumentation feel */}
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 200 160"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(120,200,255,0.05)" strokeWidth="0.4" />
                    </pattern>
                    <radialGradient id="hero-glow" cx="50%" cy="55%" r="55%">
                      <stop offset="0%" stopColor="rgba(100,200,255,0.12)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                    </radialGradient>
                  </defs>
                  <rect width="200" height="160" fill="url(#hero-grid)" />
                  <rect width="200" height="160" fill="url(#hero-glow)" />
                </svg>

                {/* Holographic content — swipeable: Slide 1 hologram,
                    Slide 2 mechanism brief, Slide 3 lead clinical study.
                    Frame chrome (caption / corners / REV / scanlines)
                    stays static across all slides. */}
                <HeroHoloCarousel />

                {/* Scanline overlay — period 90s holo cue */}
                <div
                  aria-hidden="true"
                  className="hero-holo-scan pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'repeating-linear-gradient(to bottom, transparent 0px, rgba(120,200,255,0.05) 1px, transparent 2px, transparent 3px)',
                    mixBlendMode: 'screen',
                  }}
                />

                {/* Bottom-right registration */}
                <span className="absolute bottom-3 right-4 z-10 font-mono text-[8px] uppercase tracking-[0.2em] text-white/22">
                  REV. A
                </span>

                {/* Holographic animation styles — scoped to this frame */}
                <style>{`
                  @keyframes hero-holo-spin {
                    from { transform: rotateY(0deg); }
                    to   { transform: rotateY(360deg); }
                  }
                  @keyframes hero-holo-flicker {
                    0%, 100% { opacity: 0.92; }
                    8%       { opacity: 0.55; }
                    9%       { opacity: 0.95; }
                    42%      { opacity: 0.78; }
                    43%      { opacity: 0.95; }
                    71%      { opacity: 0.6; }
                    72%      { opacity: 0.92; }
                  }
                  @keyframes hero-holo-scan {
                    from { transform: translateY(-100%); }
                    to   { transform: translateY(100%); }
                  }
                  .hero-holo-spin {
                    animation: hero-holo-spin 14s linear infinite;
                  }
                  .hero-holo-flicker {
                    animation: hero-holo-spin 14s linear infinite,
                               hero-holo-flicker 3.4s steps(1, end) infinite;
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .hero-holo-spin, .hero-holo-flicker, .hero-holo-scan {
                      animation: none !important;
                      opacity: 0.9;
                    }
                  }
                `}</style>
              </div>
            </div>
          </div>

          {/* Featured compound intelligence terminal — visible breathing
              room restored to compensate for the tightened hero text. */}
          <div className="mt-[var(--space-6)] sm:mt-[var(--space-8)]">
            <CompoundIntelligenceHero />
          </div>

          {/* Hero CTA styles — scoped to this section. Layered glows +
              sweep highlight for both pills. prefers-reduced-motion safe.
              Also: 80s chrome identity block above the headline. */}
          <style>{`
            /* ── WhatsApp CTA — flowing silver-cyan pill ──────────────
               Core styles (background, animation, glow) are set inline
               on the element to bypass the op-reveal cascade conflict.
               This block carries the keyframes, hover, focus, and
               reduced-motion override. */
            @keyframes hero-whatsapp-anim {
              from { background-position: 0% 0%; }
              to   { background-position: 240% 0%; }
            }
            /* CTA wrapper placement. Mobile: normal flow at the top of the
               text column so it clears the sticky header and pushes the
               headline down instead of overlapping it. Desktop (md, where
               the two-column layout begins): the tucked floating -44px look. */
            .hero-whatsapp-wrap {
              position: static;
              justify-content: flex-start;
              margin-top: -8px;
              margin-bottom: var(--space-4);
            }
            @media (min-width: 768px) {
              .hero-whatsapp-wrap {
                position: absolute;
                top: -22px;
                justify-content: center;
                margin-top: 0;
                margin-bottom: 0;
              }
            }
            .hero-whatsapp-cta {
              transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1),
                          box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            .hero-whatsapp-cta:hover {
              transform: translateY(-0.5px);
              box-shadow:
                0 0 0 0.5px rgba(210, 240, 255, 0.95),
                0 0 22px rgba(180, 230, 255, 0.85),
                0 0 40px rgba(120, 200, 245, 0.6),
                0 6px 20px rgba(100, 180, 235, 0.32),
                inset 0 1px 0 rgba(255, 255, 255, 0.8),
                inset 0 -1px 0 rgba(40, 80, 120, 0.16) !important;
            }
            .hero-whatsapp-cta:focus-visible {
              outline: none;
              box-shadow:
                0 0 0 2px rgba(170, 225, 255, 0.95),
                0 0 22px rgba(180, 230, 255, 0.85),
                0 0 40px rgba(120, 200, 245, 0.6) !important;
            }
            @media (prefers-reduced-motion: reduce) {
              .hero-whatsapp-cta { animation: none !important; background-position: 50% 0% !important; }
              .hero-whatsapp-cta:hover { transform: none; }
            }

            /* Begin Inquiry — cool holo-mint, drawn from the compound
               visualization palette (teal #4FE0C9 / mint #6CE8C0). */
            .hero-cta-gold {
              background: linear-gradient(180deg, #A8F0DC 0%, #54DDC0 55%, #3FB89B 100%);
              box-shadow:
                0 0 0 0.5px rgba(168, 240, 220, 0.6),
                0 0 12px rgba(79, 224, 201, 0.35),
                0 3px 10px rgba(79, 224, 201, 0.22),
                inset 0 0.5px 0 rgba(230, 255, 246, 0.6),
                inset 0 -0.5px 0 rgba(10, 60, 50, 0.2);
            }
            .hero-cta-gold:hover {
              box-shadow:
                0 0 0 0.5px rgba(190, 250, 230, 0.9),
                0 0 22px rgba(108, 232, 192, 0.6),
                0 5px 14px rgba(79, 224, 201, 0.35),
                inset 0 0.5px 0 rgba(235, 255, 248, 0.7),
                inset 0 -0.5px 0 rgba(10, 60, 50, 0.18);
              transform: translateY(-0.5px);
            }
            .hero-cta-gold-sheen {
              background: linear-gradient(110deg, transparent 35%, rgba(240,255,250,0.55) 50%, transparent 65%);
              transform: translateX(-140%);
              transition: transform 750ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            .hero-cta-gold:hover .hero-cta-gold-sheen {
              transform: translateX(140%);
            }

            /* View Research — refined cyan, thinner profile */
            .hero-cta-holo {
              background: linear-gradient(180deg, rgba(20,50,92,0.88) 0%, rgba(12,32,62,0.82) 100%);
              -webkit-backdrop-filter: blur(5px);
              backdrop-filter: blur(5px);
              border: 0.5px solid rgba(120, 210, 255, 0.4);
              box-shadow:
                inset 0 0 10px rgba(100, 200, 255, 0.08),
                inset 0 0.5px 0 rgba(180, 230, 255, 0.22),
                0 0 12px rgba(100, 200, 255, 0.2),
                0 2px 10px rgba(100, 200, 255, 0.1);
            }
            .hero-cta-holo:hover {
              border-color: rgba(160, 225, 255, 0.8);
              background: linear-gradient(180deg, rgba(120,210,255,0.13) 0%, rgba(100,200,255,0.04) 100%);
              box-shadow:
                inset 0 0 16px rgba(120, 210, 255, 0.18),
                inset 0 0.5px 0 rgba(180, 230, 255, 0.35),
                0 0 22px rgba(120, 210, 255, 0.45),
                0 3px 14px rgba(100, 200, 255, 0.2);
              transform: translateY(-0.5px);
            }
            .hero-cta-holo-sheen {
              background: linear-gradient(110deg, transparent 35%, rgba(180,235,255,0.35) 50%, transparent 65%);
              transform: translateX(-140%);
              transition: transform 750ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            .hero-cta-holo:hover .hero-cta-holo-sheen {
              transform: translateX(140%);
            }

            @media (prefers-reduced-motion: reduce) {
              .hero-cta-gold:hover,
              .hero-cta-holo:hover { transform: none; }
              .hero-cta-gold-sheen,
              .hero-cta-holo-sheen { transition: none; transform: none; }
            }
          `}</style>
        </div>
      </section>

      {/* ── 01 · RESEARCH PROCUREMENT ────────────────────────────────────── */}
      <Module
        id="inventory"
        index="01"
        label="Procurement"
        aria="Research procurement"
        meta={[
          ['SKU', '10'],
          ['Families', '4'],
          ['Lead', '3–21 D'],
        ]}
      >
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Inventory-first. Inquiry-led.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-white/60">
          Every SKU carries a documented family, dose tier, and
          procurement abbreviation. Pricing and availability are
          confirmed by inquiry, not by listing. No flash promotions, no
          urgency furniture. The catalog is structured for research
          environments that re-order, audit, and reconcile against the
          same identifiers session over session.
        </p>

        <div className="mt-[var(--space-10)] flex flex-col gap-[var(--space-4)]">
          <RouteRow
            to="/research-supplies"
            index="RS"
            title="Research Supplies"
            scope="Compounds organized by research domain: biopeptide, nootropics, skincare."
            readout="3 DOMAINS · LEAD 3–10D"
            specimen="/specimens/semaglutide-5mg.svg"
            specimenAlt="Lyophilized semaglutide specimen vial, technical plate"
          />
          <RouteRow
            to="/laboratory-equipment"
            index="LE"
            title="Laboratory Equipment"
            scope="Instruments, consumables, and handling tools across research workflows."
            readout="7 SKU · LEAD 3–21D"
            specimen="/specimens/microcentrifuge.svg"
            specimenAlt="Benchtop microcentrifuge specimen, technical plate"
            last
          />
        </div>
      </Module>

      {/* ── 02 · ANALYTICAL RECORDS ──────────────────────────────────────── */}
      <Module
        index="02"
        label="Records"
        aria="Analytical records"
        meta={[
          ['Control', 'CONTROLLED'],
          ['Revision', 'REV. A'],
          ['Standard', 'ICH Q2'],
        ]}
      >
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Batch-tracked research archive.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-white/60">
          Certificates of analysis, purity reports, and calibration
          records are filed against the same batch identifiers used in
          the catalog. Documentation is referenced for reconciliation
          and procurement audit, not advertised.
        </p>

        <div className="mt-[var(--space-10)]">
          <DocumentGallery
            documents={documents.slice(0, 3)}
            cardHref="/documentation"
          />
        </div>

        <div className="mt-[var(--space-8)]">
          <Link
            to="/documentation"
            className="group inline-flex items-center gap-[var(--space-2)] text-[11px] uppercase tracking-[0.3em] text-white/55 transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
          >
            <span>View all documentation</span>
            <span
              aria-hidden="true"
              className="text-white/35 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-holo"
            >
              →
            </span>
          </Link>
        </div>
      </Module>

      {/* ── 03 · OPERATIONAL SEQUENCE ────────────────────────────────────── */}
      <Module
        index="03"
        label="Sequence"
        aria="Operational sequence and references"
        meta={[
          ['Intake', 'OPEN'],
          ['SLA', '≤ 1 D'],
          ['Buyer', 'VERIFIED'],
        ]}
      >
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Procurement, as a sequence.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-white/60">
          The path from inquiry to fulfilment is fixed and documented at
          every step. No funnel, no negotiation theatre, no surprise at
          release.
        </p>

        {/* Sequence strip */}
        <ol className="mt-[var(--space-10)] grid grid-cols-1 border-t border-white/[0.1] sm:grid-cols-2 lg:grid-cols-4">
          {SEQUENCE.map((step, i) => (
            <li
              key={step.code}
              className={[
                'border-b border-white/[0.1] px-0 py-[var(--space-6)] sm:px-[var(--space-5)]',
                'sm:border-b-0 sm:border-t',
                i % 2 === 0 ? 'sm:border-r sm:border-white/[0.1]' : '',
                'lg:border-r',
                i === SEQUENCE.length - 1 ? 'lg:border-r-0' : '',
                i === 0 ? 'sm:pl-0 lg:pl-0' : '',
              ].join(' ')}
            >
              <div className="flex items-baseline gap-[var(--space-3)]">
                <span className="holo-text-display font-mono text-[12px] tabular-nums">
                  {step.code}
                </span>
                <span className="text-[15px] font-light tracking-tight text-white">
                  {step.title}
                </span>
              </div>
              <p className="mt-[var(--space-3)] max-w-[32ch] text-[13px] leading-relaxed text-white/55">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        {/* Field references */}
        <div className="mt-[var(--space-12)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em]">
            Field references
          </p>
          <ul className="mt-[var(--space-6)] grid grid-cols-1 gap-x-[var(--space-10)] gap-y-[var(--space-8)] lg:grid-cols-3">
            {REFERENCES.map((r) => (
              <li key={r.name}>
                <blockquote className="holo-text-body max-w-[34ch] text-[13px] font-light leading-relaxed">
                  {r.quote}
                </blockquote>
                <p className="mt-[var(--space-4)] text-[12px] text-white/65">
                  {r.name}
                </p>
                <p className="holo-text-caption mt-[var(--space-0-5)] text-[9.5px] uppercase tracking-[0.2em]">
                  {r.role}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Formal inquiry intake */}
        <div className="mt-[var(--space-12)] flex flex-col gap-[var(--space-5)] border-t border-white/[0.1] pt-[var(--space-10)] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-[clamp(1.4rem,2.6vw,1.9rem)] font-light tracking-[-0.02em] text-white">
              Inquiries open.
            </h3>
            <p className="mt-[var(--space-3)] max-w-[46ch] text-[14px] leading-relaxed text-white/50">
              Volume requests, custom dose tiers, and equipment
              configurations are quoted by inquiry. A response follows
              within one business day.
            </p>
          </div>
          <Link
            to="/contact"
            className="hero-cta-gold group relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full px-[14px] py-[7px] text-[9.5px] font-medium uppercase tracking-[0.22em] text-black transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <span aria-hidden="true" className="hero-cta-gold-sheen pointer-events-none absolute inset-0" />
            <span className="relative">Begin inquiry</span>
          </Link>
        </div>
      </Module>

      {/* ── DISCLOSURE ───────────────────────────────────────────────────── */}
      <LegalDisclaimer />
    </>
  );
}
