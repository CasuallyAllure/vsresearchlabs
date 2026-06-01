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
 *   - Hairline grammar (`border-white/[0.06]`) separates modules; the
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
import { LegalDisclaimer } from '../components/landing/LegalDisclaimer';

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
    <div className="lg:col-span-3 lg:border-r lg:border-white/[0.06] lg:pr-[var(--space-8)]">
      <div className="flex items-baseline gap-[var(--space-3)] lg:flex-col lg:items-start lg:gap-[var(--space-4)]">
        <span className="font-mono text-[13px] tabular-nums tracking-[0.1em] text-gold/80">
          {index}
        </span>
        <span className="text-[11px] uppercase tracking-[0.3em] text-white/45">
          {label}
        </span>
      </div>
      <dl className="mt-[var(--space-5)] hidden gap-[var(--space-3)] lg:grid">
        {meta.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-[var(--space-3)] border-t border-white/[0.06] pt-[var(--space-2)]"
          >
            <dt className="text-[10px] uppercase tracking-[0.22em] text-white/30">
              {k}
            </dt>
            <dd className="font-mono text-[11px] tabular-nums tracking-[0.06em] text-white/55">
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
      className="-mx-[var(--space-6)] border-b border-white/[0.06]"
      aria-label={aria}
      style={id ? { scrollMarginTop: '4rem' } : undefined}
    >
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-[var(--space-8)] px-[var(--space-6)] py-[var(--space-16)] sm:py-[var(--space-20)] lg:grid-cols-12 lg:gap-[var(--space-10)]">
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
  last,
}: RouteRowProps) {
  return (
    <Link
      to={to}
      className={[
        'group flex items-center gap-[var(--space-5)] py-[var(--space-6)]',
        'transition-colors duration-150 hover:bg-white/[0.015]',
        'focus:outline-none focus-visible:bg-white/[0.02]',
        last ? '' : 'border-b border-white/[0.06]',
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
        <h3 className="text-xl font-light tracking-tight text-white sm:text-2xl">
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
        className="shrink-0 text-lg text-white/25 transition-colors duration-150 group-hover:text-gold"
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

export function Landing() {
  return (
    <>
      {/* ── HERO · COMPOUND INTELLIGENCE ─────────────────────────────────── */}
      <section
        className="-mx-[var(--space-6)] border-b border-white/[0.06]"
        aria-label="Compound intelligence"
      >
        <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] pt-[var(--space-6)] pb-[var(--space-12)] sm:pt-[var(--space-8)] sm:pb-[var(--space-16)]">
          {/* Two-column layout: text left, reserved media slot right.
              Slot is structural — built so future animated media drops in
              without redesigning the hero. */}
          <div className="grid grid-cols-1 gap-[var(--space-8)] md:grid-cols-12 md:items-center">

            {/* ── TEXT COLUMN ─────────────────────────────────────────── */}
            <div className="md:col-span-6">
              <div
                className="op-reveal flex items-center gap-[var(--space-3)]"
                style={{ ['--op-delay' as string]: '0ms' }}
              >
                <span
                  aria-hidden="true"
                  className="op-tick h-1.5 w-1.5 rounded-full bg-gold"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                  Compound Intelligence
                </span>
              </div>

              <h1
                className="op-reveal mt-[var(--space-4)] text-[clamp(1.45rem,2.8vw,2.0rem)] leading-[1.1] tracking-[-0.02em] text-white"
                style={{ ['--op-delay' as string]: '90ms' }}
              >
                <span className="font-light text-white/85">
                  Deep compound intelligence,
                </span>
                <br />
                <span className="font-medium text-white">on the record.</span>
              </h1>

              <p
                className="op-reveal mt-[var(--space-3)] max-w-[48ch] text-[13px] leading-relaxed text-white/50"
                style={{ ['--op-delay' as string]: '170ms' }}
              >
                Every featured compound carries documented mechanism,
                receptor pharmacology, signaling, and the published study
                record. The same intelligence powers the catalog overlay
                and full compound records.
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
                      // Update hash without jumping (the smooth scroll already moved us)
                      if (history.replaceState) {
                        history.replaceState(null, '', '#inventory');
                      }
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-gold px-[var(--space-5)] py-[var(--space-2-5)] text-[10.5px] font-medium uppercase tracking-[0.2em] text-black transition-colors duration-150 hover:bg-gold-light focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
                >
                  Begin Inquiry
                </a>
                <Link
                  to="/research"
                  className="group inline-flex items-center gap-[var(--space-2)] rounded-full border border-holo/25 px-[var(--space-5)] py-[var(--space-2-5)] text-[10.5px] uppercase tracking-[0.2em] text-white/65 transition-[color,border-color,box-shadow,background-color] duration-200 hover:border-holo/55 hover:text-holo-light hover:bg-holo/[0.04] hover:shadow-[0_0_18px_rgba(100,200,255,0.22)] focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
                >
                  <span>View Research</span>
                  <span
                    aria-hidden="true"
                    className="text-holo/45 transition-colors duration-200 group-hover:text-holo-light"
                  >
                    →
                  </span>
                </Link>
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
                className="relative aspect-[5/4] w-full overflow-hidden"
                style={{
                  backgroundColor: '#070707',
                  border: '1px solid rgba(255,255,255,0.07)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
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
                  <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-cyan-300/55">
                    Compound of the Month: Retatrutide
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

                {/* Holographic compound visualization — slow Y-axis spin + flicker.
                    Stylized peptide cluster (CA backbone + ring substituents).
                    Cyan register, drop-shadow glow, scanline overlay. */}
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ perspective: '700px' }}
                >
                  <div
                    aria-hidden="true"
                    className="hero-holo-spin hero-holo-flicker"
                    style={{
                      width: '62%',
                      height: '62%',
                      transformStyle: 'preserve-3d',
                      filter: 'drop-shadow(0 0 6px rgba(100,200,255,0.55)) drop-shadow(0 0 14px rgba(100,200,255,0.25))',
                    }}
                  >
                    <svg viewBox="-100 -100 200 200" className="h-full w-full">
                      <defs>
                        <radialGradient id="holo-node" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="rgba(180,235,255,0.95)" />
                          <stop offset="60%" stopColor="rgba(100,200,255,0.55)" />
                          <stop offset="100%" stopColor="rgba(100,200,255,0)" />
                        </radialGradient>
                      </defs>

                      {/* Outer hexagonal ring — 6 atoms */}
                      {Array.from({ length: 6 }).map((_, i) => {
                        const a = (i / 6) * Math.PI * 2;
                        const x = Math.cos(a) * 70;
                        const y = Math.sin(a) * 70;
                        const nx = Math.cos(((i + 1) / 6) * Math.PI * 2) * 70;
                        const ny = Math.sin(((i + 1) / 6) * Math.PI * 2) * 70;
                        return (
                          <g key={`outer-${i}`}>
                            <line x1={x} y1={y} x2={nx} y2={ny} stroke="rgba(140,220,255,0.7)" strokeWidth="0.8" />
                            <circle cx={x} cy={y} r="4" fill="url(#holo-node)" />
                          </g>
                        );
                      })}

                      {/* Middle triangular cluster — 3 atoms */}
                      {Array.from({ length: 3 }).map((_, i) => {
                        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
                        const x = Math.cos(a) * 36;
                        const y = Math.sin(a) * 36;
                        return (
                          <g key={`mid-${i}`}>
                            <line x1="0" y1="0" x2={x} y2={y} stroke="rgba(140,220,255,0.55)" strokeWidth="0.6" />
                            <circle cx={x} cy={y} r="3.2" fill="url(#holo-node)" />
                          </g>
                        );
                      })}

                      {/* Spokes from center to outer ring */}
                      {Array.from({ length: 6 }).map((_, i) => {
                        const a = (i / 6) * Math.PI * 2;
                        const x = Math.cos(a) * 70;
                        const y = Math.sin(a) * 70;
                        return (
                          <line
                            key={`spoke-${i}`}
                            x1="0" y1="0" x2={x} y2={y}
                            stroke="rgba(140,220,255,0.25)" strokeWidth="0.4" strokeDasharray="2 3"
                          />
                        );
                      })}

                      {/* Central nucleus */}
                      <circle cx="0" cy="0" r="5" fill="url(#holo-node)" />
                      <circle cx="0" cy="0" r="2.2" fill="rgba(220,245,255,0.95)" />

                      {/* Outer orbit ring (ellipse for depth feel) */}
                      <ellipse cx="0" cy="0" rx="86" ry="22" fill="none" stroke="rgba(140,220,255,0.32)" strokeWidth="0.5" />
                    </svg>
                  </div>
                </div>

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
        <h2 className="max-w-[20ch] text-[clamp(1.6rem,3.2vw,2.4rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Inventory-first. Inquiry-led.
        </h2>
        <p className="mt-[var(--space-5)] max-w-[58ch] text-[15px] leading-relaxed text-white/55">
          Every SKU carries a documented family, dose tier, and
          procurement abbreviation. Pricing and availability are
          confirmed by inquiry, not by listing. No flash promotions, no
          urgency furniture. The catalog is structured for research
          environments that re-order, audit, and reconcile against the
          same identifiers session over session.
        </p>

        <div className="mt-[var(--space-10)] border-t border-white/[0.06]">
          <RouteRow
            to="/research-supplies"
            index="RS"
            title="Research Supplies"
            scope="Peptides, bacteriostatic water, syringes, consumables."
            readout="5 SKU · LEAD 3–10D"
            specimen="/specimens/semaglutide-5mg.svg"
            specimenAlt="Lyophilized semaglutide specimen vial, technical plate"
          />
          <RouteRow
            to="/laboratory-equipment"
            index="LE"
            title="Laboratory Equipment"
            scope="Analytical balances, pH meters, centrifuges, liquid handling."
            readout="5 SKU · LEAD 7–21D"
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
        <h2 className="max-w-[20ch] text-[clamp(1.6rem,3.2vw,2.4rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Batch-tracked research archive.
        </h2>
        <p className="mt-[var(--space-5)] max-w-[58ch] text-[15px] leading-relaxed text-white/55">
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
            className="group inline-flex items-center gap-[var(--space-2)] text-[11px] uppercase tracking-[0.3em] text-white/55 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            <span>View all documentation</span>
            <span
              aria-hidden="true"
              className="text-white/35 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-gold"
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
        <h2 className="max-w-[20ch] text-[clamp(1.6rem,3.2vw,2.4rem)] font-light leading-[1.1] tracking-[-0.02em] text-white">
          Procurement, as a sequence.
        </h2>
        <p className="mt-[var(--space-5)] max-w-[58ch] text-[15px] leading-relaxed text-white/55">
          The path from inquiry to fulfilment is fixed and documented at
          every step. No funnel, no negotiation theatre, no surprise at
          release.
        </p>

        {/* Sequence strip */}
        <ol className="mt-[var(--space-10)] grid grid-cols-1 border-t border-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {SEQUENCE.map((step, i) => (
            <li
              key={step.code}
              className={[
                'border-b border-white/[0.06] px-0 py-[var(--space-6)] sm:px-[var(--space-5)]',
                'sm:border-b-0 sm:border-t',
                i % 2 === 0 ? 'sm:border-r sm:border-white/[0.06]' : '',
                'lg:border-r',
                i === SEQUENCE.length - 1 ? 'lg:border-r-0' : '',
                i === 0 ? 'sm:pl-0 lg:pl-0' : '',
              ].join(' ')}
            >
              <div className="flex items-baseline gap-[var(--space-3)]">
                <span className="font-mono text-[12px] tabular-nums text-gold/70">
                  {step.code}
                </span>
                <span className="text-[15px] font-light tracking-tight text-white">
                  {step.title}
                </span>
              </div>
              <p className="mt-[var(--space-3)] max-w-[32ch] text-[13px] leading-relaxed text-white/45">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        {/* Field references */}
        <div className="mt-[var(--space-12)]">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/35">
            Field references
          </p>
          <ul className="mt-[var(--space-6)] grid grid-cols-1 gap-x-[var(--space-10)] gap-y-[var(--space-8)] lg:grid-cols-3">
            {REFERENCES.map((r) => (
              <li key={r.name}>
                <blockquote className="max-w-[34ch] text-[14px] font-light leading-relaxed text-white/70">
                  {r.quote}
                </blockquote>
                <p className="mt-[var(--space-4)] text-[13px] text-white/55">
                  {r.name}
                </p>
                <p className="mt-[var(--space-0-5)] text-[10px] uppercase tracking-[0.2em] text-white/35">
                  {r.role}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Formal inquiry intake */}
        <div className="mt-[var(--space-12)] flex flex-col gap-[var(--space-5)] border-t border-white/[0.06] pt-[var(--space-10)] sm:flex-row sm:items-end sm:justify-between">
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
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-gold px-[var(--space-8)] py-[var(--space-4)] text-[11px] font-medium uppercase tracking-[0.22em] text-black transition-colors duration-150 hover:bg-gold-light focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          >
            Begin inquiry
          </Link>
        </div>
      </Module>

      {/* ── DISCLOSURE ───────────────────────────────────────────────────── */}
      <LegalDisclaimer />
    </>
  );
}
