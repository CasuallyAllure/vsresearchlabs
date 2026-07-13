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
 *   - Hairline grammar (`border-ink/[0.1]`) separates modules; the
 *     surface depth and the bay carry dimension, not glass.
 *   - One orchestrated page-load (op-reveal stagger); the bay self-draws.
 *     All motion is CSS, suppressed under reduced-motion.
 */

import { Link } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { ResearchSuppliesModal } from '../components/landing/ResearchSuppliesModal';
import documentsData from '../data/documents.json';
import type { Document } from '../types';
import { DocumentGallery } from '../components/documents/DocumentGallery';
import { CompoundIntelligenceHero } from '../components/landing/CompoundIntelligenceHero';
// Heavy (three.js + R3F + drei) — split into its own chunk so it streams in
// after the page paints instead of blocking the initial bundle.
import { CompoundVisualizerFrame } from '../components/landing/CompoundVisualizerFrame';
import { CompoundVisualizerModal } from '../components/landing/CompoundVisualizerModal';
import { IntroModal } from '../components/landing/IntroModal';
import { MemberAccessGate } from '../components/landing/MemberAccessGate';
import { useCustomerAuth } from '../lib/customerAuth';
import { LegalDisclaimer } from '../components/landing/LegalDisclaimer';
import { SameDayDeliveryBadge } from '../components/landing/SameDayDeliveryBadge';
import { HeroSegmentMenu } from '../components/landing/HeroSegmentMenu';

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
    <div className="lg:col-span-3 lg:pr-[var(--space-8)]">
      <div className="flex items-center gap-[var(--space-4)] lg:flex-col lg:items-start lg:gap-[var(--space-3)]">
        {/* Large editorial numeral — anchors the section, breaks the
            templated look without adding a loud color. */}
        <span className="font-serif text-[2.6rem] font-light leading-[0.85] tabular-nums text-ink/[0.16] lg:text-[3.4rem]">
          {index}
        </span>
        <span className="holo-text-caption flex items-center gap-[var(--space-2)] text-[11px] uppercase tracking-[0.3em]">
          <span aria-hidden="true" className="h-px w-5 bg-holo/40" />
          {label}
        </span>
      </div>
      <dl className="mt-[var(--space-6)] hidden gap-0 lg:grid">
        {meta.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-[var(--space-3)] border-t border-ink/[0.07] py-[var(--space-2-5)]"
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
      className="-mx-[var(--space-6)] border-b border-ink/[0.1]"
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
  /** When set, the row opens this handler (a modal) instead of navigating. */
  onClick?: () => void;
}

function RouteRow({
  to,
  index,
  title,
  scope,
  readout,
  specimen,
  specimenAlt,
  onClick,
}: RouteRowProps) {
  const cls = [
    'research-surface-solid group flex items-stretch overflow-hidden',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25',
  ].join(' ');

  const inner = (
    <>
      {/* Specimen bay — a full-height plate flush to the card's left edge, so
          the row reads as an instrument panel rather than a thumbnail card. */}
      <div className="relative hidden w-24 shrink-0 self-stretch overflow-hidden border-r border-ink/[0.08] bg-[var(--surface-specimen-bay)] sm:block lg:w-32">
        <img
          src={specimen}
          alt={specimenAlt}
          loading="lazy"
          className="h-full w-full scale-[1.5] object-cover opacity-70 transition duration-300 ease-out group-hover:scale-[1.58] group-hover:opacity-100"
        />
        {/* Registration ticks — corner instrumentation detail. */}
        <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-2 w-2 border-l border-t border-ink/25" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 h-2 w-2 border-b border-r border-ink/25" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-5)] sm:gap-[var(--space-5)]">
        <span className="font-mono text-[10px] tabular-nums tracking-[0.1em] text-ink/30">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-light leading-tight tracking-tight text-ink sm:text-[20px]">
            {title}
          </h3>
          <p className="mt-[var(--space-2)] max-w-[42ch] text-[13px] leading-relaxed text-ink/45">
            {scope}
          </p>
        </div>
        <div className="hidden shrink-0 text-right md:block">
          <p className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-ink/45">
            {readout}
          </p>
          <p className="mt-[var(--space-1)] text-[10px] uppercase tracking-[0.26em] text-ink/25">
            Indexed
          </p>
        </div>
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ink/[0.08] text-[13px] text-ink/30 transition-[border-color,color] duration-200 group-hover:border-holo/40 group-hover:text-holo-light"
        >
          →
        </span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${cls}`}>
        {inner}
      </button>
    );
  }
  return (
    <Link to={to} className={cls}>
      {inner}
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

// Operating standards stated in our own voice — not fabricated testimonials.
const STANDARDS: Array<{ statement: string; label: string }> = [
  {
    statement:
      'Certificates of analysis and batch confirmation are available before request — not produced after the fact.',
    label: 'Documentation',
  },
  {
    statement:
      'Batch references stay consistent session over session, so intake records reconcile in minutes, not a cycle.',
    label: 'Traceability',
  },
  {
    statement:
      'Inquiries — including repeat dose tiers and custom volumes — are quoted within one business day.',
    label: 'Turnaround',
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
  const [suppliesOpen, setSuppliesOpen] = useState(false);
  const [compoundExpanded, setCompoundExpanded] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const { loading: authLoading, user } = useCustomerAuth();

  // First-visit greeting, once per browser session. Guests meet the member-
  // access gate first; dismissing it (or already being signed in) opens the
  // "what are peptides" intro video. The gate never shows to signed-in users.
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      if (sessionStorage.getItem('vsr.introSeen') !== '1') setIntroOpen(true);
    } else if (sessionStorage.getItem('vsr.gateSeen') !== '1') {
      setGateOpen(true);
    }
  }, [authLoading, user]);

  function dismissGate() {
    sessionStorage.setItem('vsr.gateSeen', '1');
    setGateOpen(false);
    if (sessionStorage.getItem('vsr.introSeen') !== '1') setIntroOpen(true);
  }

  function dismissIntro() {
    sessionStorage.setItem('vsr.introSeen', '1');
    setIntroOpen(false);
  }

  return (
    <>
      {/* Member-access gate greets guests first; on dismiss the intro follows. */}
      <MemberAccessGate open={gateOpen} onGuest={dismissGate} />
      {/* "What are peptides" intro video — greets the visitor after the gate. */}
      <IntroModal open={introOpen} onClose={dismissIntro} />
      <ResearchSuppliesModal open={suppliesOpen} onClose={() => setSuppliesOpen(false)} />
      <CompoundVisualizerModal open={compoundExpanded} onClose={() => setCompoundExpanded(false)} />

      {/* ── HERO · COMPOUND INTELLIGENCE ─────────────────────────────────── */}
      <section
        className="-mx-[var(--space-6)] border-b border-ink/[0.1]"
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
              <div className="inline-flex items-center gap-[var(--space-2)]" style={{ pointerEvents: 'auto' }}>
                {/* WhatsApp — active */}
                <a
                  href="https://chat.whatsapp.com/L2cbscwNV6gDttj1oYbFyC"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Contact us on WhatsApp"
                  title="Contact us on WhatsApp"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-display text-ink/80 shadow-[0_1px_2px_rgba(26,23,20,0.06)] transition-colors hover:border-ink/35 hover:text-ink"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.76.46 3.45 1.32 4.95l-1.44 5.27 5.4-1.42c1.45.8 3.08 1.22 4.72 1.22 5.52 0 10-4.48 10-10s-4.48-10-10-10zm0 18.16c-1.5 0-2.99-.42-4.27-1.21l-.3-.18-3.18.83.85-3.1-.2-.32c-.87-1.39-1.32-2.99-1.32-4.6 0-4.78 3.9-8.66 8.7-8.66 2.32 0 4.5.9 6.14 2.53 1.64 1.64 2.55 3.81 2.55 6.13 0 4.79-3.9 8.67-8.7 8.67zm4.97-6.5c-.27-.14-1.6-.79-1.85-.88-.25-.09-.43-.14-.6.14-.18.27-.7.88-.85 1.05-.16.18-.31.2-.58.07-.27-.14-1.14-.42-2.18-1.34-.81-.72-1.35-1.6-1.5-1.88-.16-.27-.02-.42.12-.55.12-.12.27-.31.4-.46.13-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.45-.82-1.98-.22-.53-.45-.45-.6-.45-.15-.01-.33-.01-.51-.01-.18 0-.46.07-.71.34-.25.27-.94.91-.94 2.22 0 1.31.96 2.58 1.09 2.75.14.18 1.9 2.91 4.62 4.07.64.28 1.16.45 1.55.58.65.2 1.25.18 1.72.11.52-.08 1.6-.65 1.83-1.28.22-.63.22-1.18.15-1.28-.07-.1-.25-.16-.51-.3z" />
                  </svg>
                </a>
                {/* TikTok — coming soon (grayed) */}
                <span
                  aria-label="TikTok — coming soon"
                  title="TikTok — coming soon"
                  aria-disabled="true"
                  className="flex h-9 w-9 cursor-default items-center justify-center rounded-full border border-ink/10 text-ink/25"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                  </svg>
                </span>
                {/* Instagram — coming soon (grayed) */}
                <span
                  aria-label="Instagram — coming soon"
                  title="Instagram — coming soon"
                  aria-disabled="true"
                  className="flex h-9 w-9 cursor-default items-center justify-center rounded-full border border-ink/10 text-ink/25"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </span>
              </div>
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
                  /* Structural line-art rides currentColor → ink on cream,
                     silver on black. Per-line alpha kept via *-opacity attrs.
                     The teal Bay Lights below are exempt (own color). */
                  style={{ color: 'var(--color-content-primary)' }}
                >
                  <defs>
                    {/* Soft halo for the Bay Lights trickle */}
                    <filter id="bayLightGlow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="1.4" />
                    </filter>
                  </defs>

                  {/* Project labels — silver mono micrograph */}
                  <text x="6" y="9" fontFamily="monospace" fontSize="6" fill="currentColor" fillOpacity="0.5" letterSpacing="0.22em">BAY BRIDGE · EAST SPAN</text>
                  <text x="525" y="9" fontFamily="monospace" fontSize="6" fill="currentColor" fillOpacity="0.5" letterSpacing="0.18em">OPENED 2013</text>

                  {/* Main cable — single self-anchored loop: deck → over tower
                      top → deck. Two Q segments meeting at the tower saddle. */}
                  <path d="M 20,92 Q 215,60 410,14" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round" />
                  <path d="M 410,14 Q 495,60 580,92" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round" />

                  {/* Suspender verticals — dense rod field, each top riding
                      the catenary cable (see BRIDGE_SUSPENDERS). */}
                  <g stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.4">
                    {BRIDGE_SUSPENDERS.map(({ x, yTop }) => (
                      <line key={`rod-${x}`} x1={x} y1={yTop} x2={x} y2={92} />
                    ))}
                  </g>

                  {/* Single tower — four-legged from the bridge's iconic
                      side view. Legs flare slightly at the base and
                      converge near the top, with cross-bracing visible. */}
                  <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round">
                    {/* Outer pair (visible legs) */}
                    <line x1="404" y1="92" x2="408" y2="12" />
                    <line x1="416" y1="92" x2="412" y2="12" />
                    {/* Inner pair (back legs, slightly dimmer perspective) */}
                  </g>
                  <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.65" strokeLinecap="round">
                    <line x1="407" y1="92" x2="409" y2="12" />
                    <line x1="413" y1="92" x2="411" y2="12" />
                  </g>

                  {/* Tower cross-bracing — horizontal beams between the legs */}
                  <g stroke="currentColor" strokeOpacity="0.38" strokeWidth="0.5">
                    <line x1="404.5" y1="20" x2="415.5" y2="20" />
                    <line x1="405" y1="32" x2="415" y2="32" />
                    <line x1="405.5" y1="44" x2="414.5" y2="44" />
                    <line x1="406" y1="56" x2="414" y2="56" />
                    <line x1="406.5" y1="68" x2="413.5" y2="68" />
                    <line x1="407" y1="80" x2="413" y2="80" />
                  </g>
                  {/* Internal X bracing (subtle) */}
                  <g stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.35">
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
                  <line x1="406" y1="12" x2="414" y2="12" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round" />

                  {/* Roadway deck — single wide deck (East Span is single deck) */}
                  <line x1="0" y1="92" x2="600" y2="92" stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.85" />
                  <line x1="0" y1="98" x2="600" y2="98" stroke="currentColor" strokeOpacity="0.34" strokeWidth="0.5" />

                  {/* Pier extending down from tower base into water */}
                  <g stroke="currentColor" strokeOpacity="0.36" strokeWidth="0.6">
                    <line x1="406" y1="98" x2="406" y2="128" />
                    <line x1="414" y1="98" x2="414" y2="128" />
                    <line x1="404" y1="128" x2="416" y2="128" />
                  </g>

                  {/* Waterline */}
                  <line x1="0" y1="132" x2="600" y2="132" stroke="currentColor" strokeOpacity="0.22" strokeWidth="0.3" strokeDasharray="3 4" />

                  {/* Dimension marks */}
                  <text x="295" y="14" fontFamily="monospace" fontSize="5" fill="currentColor" fillOpacity="0.45" letterSpacing="0.1em">MAIN SPAN 1,263 FT</text>
                  <text x="403" y="138" fontFamily="monospace" fontSize="5" fill="currentColor" fillOpacity="0.42" letterSpacing="0.12em">SAS TOWER · 525 FT</text>

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
                          stroke="rgba(140,144,148,0.85)"
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
                        stroke="rgba(150, 154, 158,0.95)"
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
                className="op-reveal mt-[var(--space-4)] text-[clamp(1.45rem,2.8vw,2.0rem)] leading-[1.1] tracking-[-0.02em] text-ink"
                style={{ ['--op-delay' as string]: '90ms' }}
              >
                <span className="font-light text-ink/85">
                  Bay Area biopeptide sciences.
                </span>
                <br />
                <span className="font-light text-ink">Highest purity, on demand.</span>
              </h1>

              <p
                className="op-reveal mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed text-ink/60"
                style={{ ['--op-delay' as string]: '170ms' }}
              >
                <strong className="font-semibold text-ink">
                  Velari Systems Research Labs
                </strong>{' '}
                is a Northern California research company specializing in{' '}
                {/* Monochrome-instrument: category words are ink + medium
                    weight (no color), underlined on hover. Each links to its
                    supply destination. */}
                <Link to="/research-supplies/biopeptide" className="font-medium text-ink underline-offset-2 hover:underline">
                  peptides
                </Link>
                ,{' '}
                <Link to="/research-supplies/nootropics" className="font-medium text-ink underline-offset-2 hover:underline">
                  nootropics
                </Link>
                ,{' '}
                <Link to="/research-supplies/skincare" className="font-medium text-ink underline-offset-2 hover:underline">
                  skincare-grade compounds
                </Link>
                , and{' '}
                <Link to="/laboratory-equipment" className="font-medium underline-offset-2 hover:underline">
                  laboratory equipment
                </Link>
                {' '}— all supplied at research-grade purity.{' '}
                <SameDayDeliveryBadge />
                {' '}and{' '}
                <span className="font-medium text-ink">
                  next-day
                </span>
                {' '}delivery available across the Bay Area on select orders.
                {' '}But we're a research company first — so we share what we
                know. Every compound here carries an{' '}
                <span className="font-medium text-ink">
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
                <HeroSegmentMenu
                  triggerClassName="hero-cta-gold group relative inline-flex items-center justify-center overflow-hidden rounded-full px-[14px] py-[7px] text-[10px] font-medium uppercase tracking-[0.18em] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
                  heading="Begin inquiry — choose a segment"
                  items={[
                    { label: 'Biopeptide', caption: 'Peptide sciences', to: '/research-supplies/biopeptide' },
                    { label: 'Nootropics', caption: 'Cognitive', to: '/research-supplies/nootropics' },
                    { label: 'Skin-Care', caption: 'Dermal', to: '/research-supplies/skincare' },
                  ]}
                >
                  <span aria-hidden="true" className="hero-cta-gold-sheen pointer-events-none absolute inset-0" />
                  <span className="relative">Begin Inquiry</span>
                </HeroSegmentMenu>
                <HeroSegmentMenu
                  triggerClassName="hero-cta-holo group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-[14px] py-[7px] text-[10px] uppercase tracking-[0.18em] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                  heading="View research — choose a segment"
                  items={[
                    { label: 'Biopeptide', caption: 'Compound library', to: '/research' },
                    { label: 'Nootropics', caption: 'Compound library', to: '/research' },
                    { label: 'Skin-Care', caption: 'Compound library', to: '/research' },
                  ]}
                >
                  <span aria-hidden="true" className="hero-cta-holo-sheen pointer-events-none absolute inset-0" />
                  <span className="relative">View Research</span>
                  <span
                    aria-hidden="true"
                    className="relative text-ink/45 transition-colors duration-300 group-hover:text-ink"
                  >
                    →
                  </span>
                </HeroSegmentMenu>
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
              <CompoundVisualizerFrame onExpand={() => setCompoundExpanded(true)} />
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
              transition: box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1),
                          border-color 250ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            .hero-whatsapp-cta:hover {
              border-color: rgba(26, 23, 20, 0.3) !important;
              box-shadow: 0 2px 8px rgba(26, 23, 20, 0.12) !important;
            }
            .hero-whatsapp-cta:focus-visible {
              outline: none;
              box-shadow: 0 0 0 2px rgba(140, 144, 148, 0.5) !important;
            }
            @media (prefers-reduced-motion: reduce) {
              .hero-whatsapp-cta { animation: none !important; background-position: 50% 0% !important; }
              .hero-whatsapp-cta:hover { transform: none; }
            }

            /* Begin Inquiry — flat brushed silver (mirrors .cta-mint):
               no gradient, no glow, hairline machined top edge. Fixed dark
               text (display-base is dark in both themes) since the silver
               fill is light-toned in both. */
            .hero-cta-gold {
              background: var(--color-accent-gold);
              color: var(--color-display-base);
              border: 1px solid rgba(0, 0, 0, 0.16);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
              transition:
                background-color 180ms var(--easing-easeOut),
                border-color 180ms var(--easing-easeOut);
            }
            .hero-cta-gold:hover {
              background: var(--color-accent-gold-light);
              border-color: rgba(0, 0, 0, 0.22);
            }
            .hero-cta-gold:active { background: var(--color-accent-gold-dark); }

            /* View Research — quiet neutral outline sibling of the silver primary. */
            .hero-cta-holo {
              background: transparent;
              border: 1px solid var(--color-border-strong);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
              transition:
                border-color 180ms var(--easing-easeOut),
                background 180ms var(--easing-easeOut);
            }
            .hero-cta-holo:hover {
              border-color: var(--color-content-primary);
              background: var(--color-interactive-secondary);
            }

            /* Sheen retired — inert no-op for legacy markup. */
            .hero-cta-gold-sheen,
            .hero-cta-holo-sheen { display: none; }
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
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          Inventory-first. Inquiry-led.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-ink/60">
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
            onClick={() => setSuppliesOpen(true)}
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
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          Batch-tracked research archive.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-ink/60">
          Certificates of analysis, purity reports, and calibration
          records are filed against the same batch identifiers used in
          the catalog. Documentation is referenced for reconciliation
          and procurement audit, not advertised.
        </p>

        {/* Placeholder archive — blurred behind a "to be updated" seal so we
            never present filler certificates as real records. */}
        <div className="mt-[var(--space-10)] relative">
          <div
            aria-hidden="true"
            className="pointer-events-none select-none blur-[7px] opacity-45 saturate-[0.6]"
          >
            <DocumentGallery
              documents={documents.slice(0, 3)}
              cardHref="/documentation"
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center px-[var(--space-4)]">
            <div className="rounded-full border border-ink/15 bg-base-800/85 px-[var(--space-6)] py-[var(--space-3)] backdrop-blur-sm text-center">
              <span className="block font-mono text-[10px] uppercase tracking-[0.28em] text-ink/60">
                Archive in preparation
              </span>
              <span className="mt-1 block text-[11px] text-ink/40">
                Live certificates &amp; batch records — to be updated.
              </span>
            </div>
          </div>
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
        <h2 className="max-w-[24ch] text-[clamp(1.45rem,2.8vw,2.0rem)] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          Procurement, as a sequence.
        </h2>
        <p className="mt-[var(--space-4)] max-w-[58ch] text-[13px] leading-relaxed text-ink/60">
          The path from inquiry to fulfilment is fixed and documented at
          every step. No funnel, no negotiation theatre, no surprise at
          release.
        </p>

        {/* Sequence strip — each step is a channel: a hairline rule capped
            with a short accent segment, then code · title · body. Reads as an
            instrument scale, not a bordered table. */}
        <ol className="mt-[var(--space-10)] grid grid-cols-1 gap-x-[var(--space-6)] gap-y-[var(--space-8)] sm:grid-cols-2 lg:grid-cols-4">
          {SEQUENCE.map((step) => (
            <li key={step.code} className="relative pt-[var(--space-5)]">
              <span aria-hidden="true" className="absolute left-0 top-0 h-px w-full bg-ink/[0.1]" />
              <span aria-hidden="true" className="absolute left-0 top-0 h-px w-8 bg-holo/55" />
              <div className="flex items-baseline gap-[var(--space-2-5)]">
                <span className="holo-text-display font-mono text-[11px] tabular-nums">
                  {step.code}
                </span>
                <span className="text-[16px] font-light tracking-tight text-ink">
                  {step.title}
                </span>
              </div>
              <p className="mt-[var(--space-3)] max-w-[30ch] text-[13px] leading-relaxed text-ink/55">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        {/* Operating standards — stated in our own voice, not testimonials */}
        <div className="mt-[var(--space-12)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em]">
            Operating standards
          </p>
          <ul className="mt-[var(--space-6)] grid grid-cols-1 gap-x-[var(--space-10)] gap-y-[var(--space-8)] lg:grid-cols-3">
            {STANDARDS.map((s) => (
              <li key={s.label}>
                <p className="holo-text-body max-w-[34ch] text-[13px] font-light leading-relaxed">
                  {s.statement}
                </p>
                <p className="holo-text-caption mt-[var(--space-4)] text-[10px] uppercase tracking-[0.2em] text-holo/70">
                  {s.label}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Formal inquiry intake */}
        <div className="mt-[var(--space-12)] flex flex-col gap-[var(--space-5)] border-t border-ink/[0.1] pt-[var(--space-10)] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-[clamp(1.4rem,2.6vw,1.9rem)] font-light tracking-[-0.02em] text-ink">
              Inquiries open.
            </h3>
            <p className="mt-[var(--space-3)] max-w-[46ch] text-[14px] leading-relaxed text-ink/50">
              Volume requests, custom dose tiers, and equipment
              configurations are quoted by inquiry. A response follows
              within one business day.
            </p>
          </div>
          <Link
            to="/contact"
            className="hero-cta-gold group relative inline-flex min-h-[44px] shrink-0 items-center justify-center overflow-hidden rounded-full px-[26px] py-[11px] text-[11px] font-medium uppercase tracking-[0.14em] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
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
