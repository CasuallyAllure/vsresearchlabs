/**
 * HeroHoloCarousel
 *
 * Swipeable carousel inside the FIG-01 hero frame. Slide manifest:
 *   1. Holographic peptide cluster (spin + flicker — visual identity).
 *   2. Summary Effects (NEW) — leading observed outcomes from up to three
 *      studies, each carrying a small source citation under the effect.
 *   3. Mechanism Brief — short mechanism prose + receptor target chips.
 *   4. Clinical Observation — lead human study title + first finding.
 *
 * Frame chrome (caption block, corner registration marks, REV mark,
 * grid backdrop, scanline overlay) lives in the parent Landing hero —
 * it is static across slides. Animation keyframes for the hologram
 * (`hero-holo-spin`, `hero-holo-flicker`) are defined in Landing.tsx.
 *
 * Text in every non-hologram slide is rendered through `holo-text-*`
 * classes (defined at the bottom of this file) which give the type a
 * real holographic feel via layered cyan text-shadow stops — not just
 * the cyan color. Three tiers: display, body, caption.
 *
 * All content is read from `getCompoundIntelligence(featured)`.
 * Nothing is fabricated. Slides with no data degrade out.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import productsData from '../../data/products.json';
import type { Product, ProductStudy, StudyModel } from '../../types';
import {
  getCompoundIntelligence,
  type CompoundIntelligence,
} from '../../lib/compoundIntelligence';
import { CompoundHologram3D, type CompoundStructure } from './CompoundHologram3D';
import retatrutideStructure from '../../data/structures/retatrutide.json';

const products = productsData as unknown as Product[];
const FEATURED_SLUG = 'retatrutide-5mg';

/** Display label per study model — used by the Summary Effects citation
 *  so users immediately see whether a finding came from human trials,
 *  an animal model, or in-vitro work. */
const MODEL_DISPLAY: Record<StudyModel, string> = {
  human: 'Human Trial',
  rat: 'Rat Model',
  mouse: 'Mouse Model',
  'in-vitro': 'In-Vitro',
  'in-vivo': 'In-Vivo',
  'ex-vivo': 'Ex-Vivo',
  review: 'Review',
};

type SlideKey = 'holo' | 'effects' | 'mechanism' | 'clinical';

interface EffectRow {
  effect: string;
  study: ProductStudy;
}

export function HeroHoloCarousel() {
  const product = products.find((p) => p.slug === FEATURED_SLUG);
  const ci = product ? getCompoundIntelligence(product) : null;

  // Build slide manifest from available data — degrade slides with no content.
  const effects = ci ? pickEffects(ci) : [];
  const leadStudy = ci ? pickLeadStudy(ci) : null;

  const slides: SlideKey[] = ['holo'];
  if (effects.length > 0) slides.push('effects');
  if (ci?.mechanismSummary) slides.push('mechanism');
  if (leadStudy) slides.push('clinical');

  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const go = useCallback(
    (i: number) => {
      const t = trackRef.current;
      if (!t || t.clientWidth === 0) return;
      const idx = Math.max(0, Math.min(slides.length - 1, i));
      t.scrollTo({ left: idx * t.clientWidth, behavior: 'smooth' });
      setActive(idx);
    },
    [slides.length],
  );

  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (t.clientWidth === 0) return;
        setActive(Math.round(t.scrollLeft / t.clientWidth));
      });
    };
    t.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      t.removeEventListener('scroll', onScroll);
    };
  }, []);

  if (!ci) return <SlideHologram />;

  return (
    <>
      <div
        ref={trackRef}
        className="hero-holo-track absolute inset-0 z-[2] flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        role="region"
        aria-roledescription="carousel"
        aria-label="Compound visualization slides"
      >
        {slides.map((key) => (
          <div
            key={key}
            className="relative min-w-full shrink-0 snap-start snap-always"
            aria-label={SLIDE_LABEL[key]}
          >
            {key === 'holo' && (
              <SlideHologram
                fdaStatus={ci.fdaStatus}
                humanTrials={ci.humanTrials}
              />
            )}
            {key === 'effects' && <SlideEffects effects={effects} />}
            {key === 'mechanism' && <SlideMechanism ci={ci} />}
            {key === 'clinical' && leadStudy && (
              <SlideClinical study={leadStudy} compound={ci.substance} />
            )}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5">
          {slides.map((key, i) => {
            const on = i === active;
            return (
              <button
                key={key}
                type="button"
                onClick={() => go(i)}
                aria-label={`View ${SLIDE_LABEL[key]}`}
                className="h-1.5 w-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/50"
                style={{
                  backgroundColor: on ? 'rgba(100,200,255,0.85)' : 'rgba(255,255,255,0.18)',
                  boxShadow: on ? '0 0 8px rgba(100,200,255,0.55)' : 'none',
                  transform: on ? 'scale(1.1)' : 'scale(1)',
                }}
              />
            );
          })}
        </div>
      )}

      {/* Right-edge nav cue — small chevron, gently nudges to invite
          the swipe / click. Hides on the last slide. */}
      {slides.length > 1 && active < slides.length - 1 && (
        <button
          type="button"
          onClick={() => go(active + 1)}
          aria-label="Next slide"
          className="hero-holo-next-cue absolute right-2 top-1/2 z-30 flex h-8 w-5 items-center justify-center text-holo/65 hover:text-holo-light transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40 rounded-sm"
          style={{
            filter: 'drop-shadow(0 0 6px rgba(100,200,255,0.6)) drop-shadow(0 0 14px rgba(100,200,255,0.3))',
          }}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true">
            <path
              d="M2 1 L8 7 L2 13"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      <style>{`
        .hero-holo-track { scrollbar-width: none; -ms-overflow-style: none; }
        .hero-holo-track::-webkit-scrollbar { display: none; }

        /* Right-edge nav cue — slow horizontal nudge so the user reads
           "this swipes" without the arrow being noisy. Reduced-motion
           safe. */
        @keyframes hero-holo-next-nudge {
          0%, 100% { transform: translate(0, -50%); opacity: 0.55; }
          50%      { transform: translate(3px, -50%); opacity: 0.9; }
        }
        .hero-holo-next-cue {
          animation: hero-holo-next-nudge 2.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-holo-next-cue { animation: none; opacity: 0.7; }
        }

        /* Holographic typography (holo-text-display / body / caption /
           citation / pulse) is now defined globally in theme.css — see
           the DESIGN SYSTEM block. Removed from this scoped style to
           keep the carousel free of duplicate rules. */
      `}</style>
    </>
  );
}

/* ── Slide helpers ────────────────────────────────────────────────────── */

const SLIDE_LABEL: Record<SlideKey, string> = {
  holo: 'Holographic structure',
  effects: 'Summary effects',
  mechanism: 'Mechanism brief',
  clinical: 'Clinical observation',
};

/**
 * Parse the canonical fdaStatus string into a phase token and an
 * approval flag for the hologram slide overlay. Handles the three
 * patterns used across the dataset:
 *   "Approved — …"
 *   "Investigational — Phase N program ongoing; not FDA approved"
 *   "Not approved — …"
 */
function parseFdaInfo(status?: string): {
  phase: string | null;
  approved: boolean;
  label: string;
} {
  if (!status) return { phase: null, approved: false, label: 'Status unknown' };
  const notApproved = /\bnot\s+(fda\s+)?approved\b/i.test(status);
  const approved = /\bapproved\b/i.test(status) && !notApproved;
  const phaseMatch = status.match(/Phase\s+(\d[A-Za-z]?)/i);
  const phase = phaseMatch ? `Phase ${phaseMatch[1]}` : null;
  const label = approved ? 'FDA Approved' : 'Not FDA Approved';
  return { phase, approved, label };
}

function pickLeadStudy(ci: CompoundIntelligence): ProductStudy | null {
  if (!ci.studies || ci.studies.length === 0) return null;
  const human = ci.studies
    .filter((s) => s.model === 'human')
    .sort((a, b) => b.year - a.year)[0];
  if (human) return human;
  return [...ci.studies].sort((a, b) => b.year - a.year)[0] ?? null;
}

/**
 * Pull a quantitative effect bullet from up to 3 studies. Human trials
 * first (clinical evidence carries the most weight on this slide),
 * recent-year first within each tier. Within each study's notes the
 * picker PREFERS notes that contain quantitative data (%, numeric
 * change) so users see concrete percentages — falls back to the lead
 * note if no quantitative note exists.
 */
function pickEffects(ci: CompoundIntelligence): EffectRow[] {
  if (!ci.studies || ci.studies.length === 0) return [];
  const sorted = [...ci.studies].sort((a, b) => {
    const aHuman = a.model === 'human' ? 0 : 1;
    const bHuman = b.model === 'human' ? 0 : 1;
    if (aHuman !== bHuman) return aHuman - bHuman;
    return b.year - a.year;
  });
  const out: EffectRow[] = [];
  for (const s of sorted) {
    if (out.length >= 3) break;
    const notes = s.notes ?? [];
    // Prefer notes carrying real numbers (%, decimals). Fall back to lead.
    const quantitative = notes.find((n) => /%|\d/.test(n));
    const lead = (quantitative ?? notes[0])?.trim();
    if (lead) out.push({ effect: lead, study: s });
  }
  return out;
}

/* ── Slide 1 — Holographic peptide cluster ────────────────────────────── */

interface SlideHologramProps {
  fdaStatus?: string;
  humanTrials?: boolean;
}

function SlideHologram({ fdaStatus, humanTrials }: SlideHologramProps = {}) {
  const reg = parseFdaInfo(fdaStatus);
  const showRegulatory = !!fdaStatus || humanTrials !== undefined;
  return (
    <div className="absolute inset-0">
      {/* 3D compound visualization — see CompoundHologram3D.tsx for the
          full WebGL implementation. Replacing the visualization (e.g.
          for layered SVG, or PDB-driven per-compound structure) is a
          single-component swap; nothing else in this slide depends on
          the rendering technology. */}
      <CompoundHologram3D structure={retatrutideStructure as unknown as CompoundStructure} />

      {/* Regulatory overlay — bottom-left of slide 1 only. Phase and FDA
          status pulled from the canonical fdaStatus string. */}
      {showRegulatory && (
        <div className="absolute bottom-10 left-4 z-20 flex flex-col gap-1 pointer-events-none sm:left-6">
          <p className="font-mono text-[8px] uppercase tracking-[0.3em] holo-text-caption">
            Regulatory
          </p>
          {reg.phase && (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] holo-text-display holo-text-pulse">
              {reg.phase}
            </p>
          )}
          <p
            className={
              reg.approved
                ? 'font-mono text-[10px] uppercase tracking-[0.2em] holo-text-display'
                : 'font-mono text-[10px] uppercase tracking-[0.2em] holo-text-warning font-semibold'
            }
          >
            {reg.label}
          </p>
          {humanTrials !== undefined && (
            <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] holo-text-citation">
              Human Trials · {humanTrials ? 'Confirmed' : 'None Known'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Slide 2 — Summary Effects ────────────────────────────────────────── */

function SlideEffects({ effects }: { effects: EffectRow[] }) {
  return (
    <div className="absolute inset-0 flex items-start justify-center px-6 pb-10 pt-24 sm:items-center sm:px-10 sm:pt-24">
      <div className="w-full max-w-[44ch]">
        <p className="mb-4 text-center font-mono text-[8.5px] uppercase tracking-[0.3em] holo-text-caption">
          Summary · Effects
        </p>
        <ul className="space-y-3.5">
          {effects.map((e, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="font-mono text-[10px] tabular-nums tracking-[0.04em] holo-text-caption shrink-0 mt-0.5">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug holo-text-display holo-text-pulse break-words">
                  {e.effect}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.2em] holo-text-citation break-words">
                  <span className="holo-text-caption">
                    {MODEL_DISPLAY[e.study.model]}
                  </span>
                  {' · '}
                  {e.study.source} · {e.study.year}
                  {e.study.phase ? ` · ${e.study.phase}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Slide 3 — Mechanism Brief ────────────────────────────────────────── */

function SlideMechanism({ ci }: { ci: CompoundIntelligence }) {
  return (
    <div className="absolute inset-0 flex items-start justify-center px-6 pb-10 pt-24 sm:items-center sm:px-10 sm:pt-12">
      <div className="max-w-[40ch] text-center">
        <p className="mb-3 font-mono text-[8.5px] uppercase tracking-[0.3em] holo-text-caption">
          Mechanism · Brief
        </p>
        <p className="text-[12px] leading-[1.6] holo-text-body break-words">
          {ci.mechanismSummary}
        </p>
        {ci.receptorTargets.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            {ci.receptorTargets.slice(0, 3).map((t) => (
              <span
                key={t.receptor}
                className="rounded-[2px] border border-holo/30 bg-holo/[0.06] px-2 py-0.5 font-mono text-[9.5px] tracking-[0.06em] holo-text-caption"
              >
                {t.receptor}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Slide 4 — Clinical Observation ───────────────────────────────────── */

function SlideClinical({
  study,
  compound,
}: {
  study: ProductStudy;
  compound: string;
}) {
  const lead = study.notes?.[0];
  return (
    <div className="absolute inset-0 flex items-start justify-center px-6 pb-10 pt-24 sm:items-center sm:px-10 sm:pt-12">
      <div className="max-w-[42ch]">
        <p className="mb-3 text-center font-mono text-[8.5px] uppercase tracking-[0.3em] holo-text-caption">
          {study.phase ? `Clinical · ${study.phase}` : 'Clinical Observation'}
        </p>
        <p className="text-center text-[11px] leading-snug holo-text-body break-words">
          {study.title}
        </p>
        {lead && (
          <div className="mt-4 border-t border-holo/15 pt-3">
            <p className="mb-1.5 text-center text-[10.5px] uppercase tracking-[0.22em] holo-text-caption">
              Observed
            </p>
            <p className="text-[12px] leading-relaxed holo-text-display holo-text-pulse break-words">
              {lead}
            </p>
          </div>
        )}
        <p className="mt-4 text-center font-mono text-[8.5px] uppercase tracking-[0.22em] holo-text-citation">
          {study.source} · {study.year} · {compound}
        </p>
      </div>
    </div>
  );
}
