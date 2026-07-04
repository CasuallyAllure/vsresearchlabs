/**
 * CompoundIntelligenceHero
 * E4 — Landing intelligence hero.
 *
 * A live featured-compound intelligence terminal. Three swipeable
 * slides over one compound (Retatrutide), all driven by the shared
 * `getCompoundIntelligence` selector reading the canonical Product
 * model — the same data the CompoundIntelligenceOverlay consumes.
 * Nothing here is placeholder: identifiers, pharmacology, and studies
 * are read from product data. If a field is absent the block is
 * omitted rather than faked.
 *
 *   Slide 1 · Panel    — specimen plate + real identity + receptor
 *                         activation map (potencies parsed from the
 *                         documented receptor-activity prose).
 *   Slide 2 · Dossier  — mechanism / receptor / pathway / outcome /
 *                         analytical parameters / available tiers.
 *   Slide 3 · Studies  — regulatory posture + the known published
 *                         study record with observed-findings bullets.
 *
 * Interaction: native scroll-snap track (momentum swipe), tab + arrow
 * controls, keyboard arrows, slide indicators. Smooth scroll only
 * under no-preference; reduced-motion jumps instantly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CompoundIntelligenceOverlay } from '../catalog/CompoundIntelligenceOverlay';
import productsData from '../../data/products.json';
import type { Product, ProductStudy, StudyModel } from '../../types';
import { useCart } from '../../hooks/useCart';
import { variantProduct } from '../../lib/cartActions';
import {
  getCompoundIntelligence,
  type CompoundIntelligence,
} from '../../lib/compoundIntelligence';
import { RegulatoryChipCluster } from '../catalog/intelligence/RegulatoryChipCluster';
import { SummaryText } from '../catalog/intelligence/SummaryText';
import { MolecularStructurePanel } from '../catalog/specimen/MolecularStructurePanel';

const products = productsData as unknown as Product[];
const FEATURED_SLUG = 'retatrutide-5mg';

// Marquee compounds offered in the header switcher. Each has rich intel
// (mechanism, receptor activity, 2D structure) so the whole panel re-renders
// cleanly when selected.
const FEATURED_SLUGS = [
  'retatrutide-5mg', 'tirzepatide-10mg', 'semaglutide-5mg', 'cagrisema',
  'mots-c', 'bpc157-5mg', 'ghk-cu', 'nad-plus',
];
const FEATURED = FEATURED_SLUGS
  .map((s) => products.find((p) => p.slug === s))
  .filter((p): p is Product => !!p);

const SLIDES = [
  { key: 'panel', tab: 'Panel', title: 'Visual Compound Panel' },
  { key: 'dossier', tab: 'Dossier', title: 'Intelligence Dossier' },
  { key: 'studies', tab: 'Studies', title: 'Research & Known Studies' },
] as const;

const MODEL_LABEL: Record<StudyModel, string> = {
  human: 'Human',
  rat: 'Rat',
  mouse: 'Mouse',
  'in-vitro': 'In-vitro',
  'in-vivo': 'In-vivo',
  'ex-vivo': 'Ex-vivo',
  review: 'Review',
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/* ── Shared atoms ────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.26em] text-ink/35">
      {children}
    </p>
  );
}

function CornerMarks() {
  const c = 'pointer-events-none absolute h-2.5 w-2.5 border-ink/20';
  return (
    <>
      <span className={`${c} left-2 top-2 border-l border-t`} aria-hidden />
      <span className={`${c} right-2 top-2 border-r border-t`} aria-hidden />
      <span className={`${c} bottom-2 left-2 border-b border-l`} aria-hidden />
      <span className={`${c} bottom-2 right-2 border-b border-r`} aria-hidden />
    </>
  );
}

/* ── Slide 1 — Visual Compound Panel ─────────────────────────────────────── */

function ReceptorMap({ ci }: { ci: CompoundIntelligence }) {
  const targets = ci.receptorTargets;
  if (targets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink/45">
          {ci.classificationLabel}
        </p>
      </div>
    );
  }
  const H = 60 + targets.length * 64;
  const cx = 78;
  const cy = H / 2;
  return (
    <svg
      viewBox={`0 0 360 ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden="true"
    >
      {/* Central compound node */}
      <circle cx={cx} cy={cy} r="30" fill="#070707" stroke="rgba(140,144,148,0.5)" strokeWidth="1.25" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="monospace" fontSize="13" fill="rgba(26,23,20,0.85)" letterSpacing="1">
        {ci.abbreviation}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontFamily="monospace" fontSize="7" fill="rgba(26,23,20,0.32)" letterSpacing="1.5">
        AGONIST
      </text>
      {targets.map((t, i) => {
        const ty = 46 + i * 64;
        const tx = 224;
        return (
          <g key={t.receptor}>
            <path
              d={`M${cx + 30},${cy} C 150,${cy} 160,${ty + 14} ${tx - 8},${ty + 14}`}
              fill="none"
              stroke="rgba(26,23,20,0.22)"
              strokeWidth="1.25"
              pathLength={1}
              className="op-draw"
              style={{ ['--op-delay' as string]: `${360 + i * 160}ms` }}
            />
            <circle cx={cx + 30} cy={cy} r="2" fill="rgba(140,144,148,0.7)" />
            <rect
              x={tx - 8}
              y={ty}
              width="128"
              height="30"
              rx="2"
              fill="rgba(26,23,20,0.025)"
              stroke="rgba(26,23,20,0.12)"
            />
            <text x={tx + 4} y={ty + 13} fontFamily="monospace" fontSize="11" fill="rgba(26,23,20,0.82)" letterSpacing="0.5">
              {t.receptor}
            </text>
            <text x={tx + 4} y={ty + 24} fontFamily="monospace" fontSize="8.5" fill="#9AA0A6" opacity="0.8">
              EC50 {t.ec50}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ink/[0.06] py-2">
      <span className="text-[10px] uppercase tracking-[0.2em] text-ink/30">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink/65">
        {value}
      </span>
    </div>
  );
}

/**
 * useDriftScroll — gives a scroll container a slow, ambient self-scroll
 * that drifts down through the overflowing content, holds at the bottom,
 * then drifts back up (a gentle teleprompter to invite reading). Pauses
 * the moment the reader hovers, focuses, or scrolls it themselves, and
 * resumes shortly after they let go. No-ops under reduced motion.
 */
function useDriftScroll<T extends HTMLElement>(speedPxPerSec = 20) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Per-frame scrollTop writes need instant scrolling, not smooth.
    el.style.scrollBehavior = 'auto';

    let raf = 0;
    let last = 0;
    let holdUntil = 0;
    let pausedUntil = 0;
    // Float accumulator for the scroll position. We must NOT read scrollTop
    // back each frame: iOS quantizes it to whole pixels, so a sub-pixel
    // per-frame delta would round to zero and never advance.
    let pos = el.scrollTop;

    // Pause briefly when the reader actually takes over (scroll / touch /
    // click / keyboard), then resume the ambient drift.
    const nudgePause = () => {
      pausedUntil = performance.now() + 1400;
    };
    el.addEventListener('wheel', nudgePause, { passive: true });
    el.addEventListener('touchmove', nudgePause, { passive: true });
    el.addEventListener('pointerdown', nudgePause);
    el.addEventListener('focusin', nudgePause);

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (!last) last = t;
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      // While the reader is in control, track their position instead of
      // fighting it; resume the drift from wherever they left off.
      if (t < pausedUntil) {
        pos = el.scrollTop;
        return;
      }
      if (max <= 6 || t < holdUntil) return;
      // Reached the bottom on the previous pass → rewind to the top (a cut,
      // never an upward scroll) and pause briefly before drifting again.
      if (pos >= max) {
        pos = 0;
        el.scrollTop = 0;
        holdUntil = t + 900;
        return;
      }
      pos += speedPxPerSec * dt; // always downward
      if (pos >= max) {
        pos = max;
        el.scrollTop = max;
        holdUntil = t + 3000; // dwell at the end so the reader catches up
        return;
      }
      el.scrollTop = pos;
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', nudgePause);
      el.removeEventListener('touchmove', nudgePause);
      el.removeEventListener('pointerdown', nudgePause);
      el.removeEventListener('focusin', nudgePause);
    };
  }, [speedPxPerSec]);
  return ref;
}

function SlidePanel({
  ci,
  product,
  onOpenRecord,
}: {
  ci: CompoundIntelligence;
  product: Product;
  onOpenRecord: () => void;
}) {
  const add = useCart((s) => s.add);
  const driftRef = useDriftScroll<HTMLDivElement>();
  return (
    <div className="grid h-full grid-cols-1 grid-rows-[200px_1fr] md:grid-cols-5 md:grid-rows-none">
      {/* Specimen plate — generated vial + real PubChem structure, side by side.
          Identifier rides a header strip so it never lands on the artwork. */}
      <div className="relative flex min-h-0 min-w-0 flex-col border-b border-ink/[0.06] bg-[var(--surface-specimen-bay)] md:col-span-2 md:border-b-0 md:border-r">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-ink/35">
            Specimen · {ci.sku}
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-ink/25">
            Vial / 2D
          </span>
        </div>
        {/* Specimen viewer — a fixed LIGHT surface in both themes (product +
            molecule read best on light), so the two windows always share one
            colour. Split by a prominent fixed-dark divider; each image fills
            its window to the edges. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 bg-[#ECEEEF]">
          {/* Left — generated specimen vial. object-contain so the square
              studio shot is never zoom-cropped or squished; it sits centered
              on the shared light surface. */}
          <div className="relative min-h-0 overflow-hidden border-r-2 border-[rgba(26,23,20,0.16)]">
            {ci.specimenImage ? (
              <img
                src={ci.specimenImage}
                alt={`${ci.substance} specimen vial`}
                className="h-full w-full object-contain"
                style={{ opacity: 0.96 }}
              />
            ) : null}
          </div>
          {/* Right — real 2D molecular structure (PubChem). `lightbox` keeps it
              on the light viewer (light compositing + dark labels) in both
              themes so it matches the vial window exactly. */}
          <div className="relative min-h-0 overflow-hidden">
            <MolecularStructurePanel substance={ci.substance} abbreviation={ci.abbreviation} bare lightbox />
          </div>
        </div>
        <CornerMarks />
      </div>

      {/* Intelligence — the product. Image supports it. Slowly self-drifts
          through the copy to invite reading; pauses on interaction. */}
      <div ref={driftRef} className="flex min-w-0 flex-col overflow-y-auto p-4 sm:p-5 md:col-span-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="op-tick h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
          />
          <Eyebrow>{ci.classificationLabel}</Eyebrow>
        </div>
        <h3 className="holo-text-display mt-2 break-words text-[clamp(1.25rem,2.4vw,1.7rem)] font-light leading-[1.08] tracking-[-0.02em]">
          {ci.substance}
        </h3>
        <p className="holo-text-citation mt-1 font-mono text-[11px] tracking-[0.06em]">
          {ci.family} · {ci.abbreviation}
        </p>

        {/* Plain-English summary — the friendly read, right under the name. */}
        {ci.summary && (
          <SummaryText
            text={ci.summary}
            className="mt-2.5 text-[12px] leading-relaxed text-ink/70"
          />
        )}

        {/* Regulatory posture — visible without swiping */}
        {(ci.humanTrials !== undefined || ci.fdaStatus) && (
          <div className="mt-2.5">
            <RegulatoryChipCluster
              humanTrials={ci.humanTrials}
              fdaStatus={ci.fdaStatus}
            />
          </div>
        )}

        <div className="mt-2.5 min-w-0">
          <Eyebrow>Receptor activation</Eyebrow>
          <div className="mt-1 h-[84px] w-full min-w-0">
            <ReceptorMap ci={ci} />
          </div>
        </div>

        <div className="mt-2.5 min-w-0">
          {ci.casNumber && <IdentityRow label="CAS" value={ci.casNumber} />}
          {ci.molecularWeight && (
            <IdentityRow label="Mol. weight" value={ci.molecularWeight} />
          )}
          {ci.activeDose && (
            <IdentityRow label="Configuration" value={ci.activeDose} />
          )}
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => add(variantProduct(product, ci.activeDose))}
            className="cta-mint group relative inline-flex items-center justify-center overflow-hidden rounded-full px-[14px] py-[7px] text-[9.5px] font-medium uppercase tracking-[0.2em] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
          >
            <span className="relative">Add to inquiry</span>
          </button>
          <button
            type="button"
            onClick={onOpenRecord}
            className="group inline-flex items-center gap-1.5 px-1 text-[10.5px] uppercase tracking-[0.2em] text-holo/65 transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
          >
            <span>Full record</span>
            <span aria-hidden className="text-holo/45 transition-colors group-hover:text-holo-light">↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Slide 2 — Intelligence Dossier ──────────────────────────────────────── */

function ModuleBlock({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 border-t border-ink/[0.06] py-5">
      {/* Accent channel-marker — same instrumentation language as the
          landing sequence strip and section rails. */}
      <span aria-hidden className="absolute left-0 top-0 h-px w-6 bg-gold/45" />
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-mono text-[10px] tabular-nums text-gold/70">
          {index}
        </span>
        <span className="min-w-0 break-words text-[10.5px] uppercase tracking-[0.22em] text-ink/50">
          {title}
        </span>
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </div>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <p className="holo-text-body break-words text-[12.5px] leading-[1.65]">
      {children}
    </p>
  );
}

function SlideDossier({ ci }: { ci: CompoundIntelligence }) {
  const blocks: Array<{ key: string; title: string; node: React.ReactNode }> =
    [];
  if (ci.mechanismSummary)
    blocks.push({
      key: 'mech',
      title: 'Mechanism of Action',
      node: <Prose>{ci.mechanismSummary}</Prose>,
    });
  if (ci.receptorActivity)
    blocks.push({
      key: 'recept',
      title: 'Receptor / Target Activity',
      node: (
        <>
          <Prose>{ci.receptorActivity}</Prose>
          {ci.receptorTargets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ci.receptorTargets.map((t) => (
                <span
                  key={t.receptor}
                  className="rounded-[2px] border border-ink/10 bg-ink/[0.03] px-2 py-1 font-mono text-[10.5px] text-ink/60"
                >
                  {t.receptor}{' '}
                  <span className="text-gold/80">EC50 {t.ec50}</span>
                </span>
              ))}
            </div>
          )}
        </>
      ),
    });
  if (ci.pathwaySummary)
    blocks.push({
      key: 'path',
      title: 'Signaling Pathway',
      node: <Prose>{ci.pathwaySummary}</Prose>,
    });
  if (ci.physiologicalOutcome.length > 0)
    blocks.push({
      key: 'outcome',
      title: 'Physiological Outcome',
      node: (
        <ul className="space-y-1.5">
          {ci.physiologicalOutcome.map((o) => (
            <li
              key={o}
              className="flex gap-2.5 text-[13px] leading-relaxed text-ink/60"
            >
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gold/60" />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      ),
    });
  if (ci.analytical.length > 0)
    blocks.push({
      key: 'analytical',
      title: 'Analytical Parameters',
      node: (
        <dl className="space-y-2">
          {ci.analytical.map((r) => (
            <div
              key={r.label}
              className="flex min-w-0 items-baseline justify-between gap-4"
            >
              <dt className="shrink-0 text-[11px] text-ink/40">{r.label}</dt>
              <dd className="min-w-0 break-words text-right font-mono text-[11px] tabular-nums text-ink/65">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ),
    });
  if (ci.tiers.length > 0)
    blocks.push({
      key: 'tiers',
      title: 'Available Tiers',
      node: (
        <div className="flex flex-wrap gap-2">
          {ci.tiers.map((v) => (
            <span
              key={v.dose}
              className="rounded-[2px] border border-ink/12 bg-ink/[0.03] px-3 py-1.5 font-mono text-[11px] text-ink/70"
            >
              {v.dose}
            </span>
          ))}
        </div>
      ),
    });

  return (
    <div className="h-full min-w-0 overflow-y-auto px-5 pt-3 pb-6 sm:px-7 sm:pt-4">
      <Eyebrow>Compound intelligence dossier</Eyebrow>
      {/* Grid replaces CSS multi-column for explicit width control. Each
          column carries `min-w-0` via ModuleBlock so internal flex/grid
          rows can shrink and wrap inside the column boundary. */}
      <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-0 md:grid-cols-2">
        {blocks.map((b, i) => (
          <ModuleBlock
            key={b.key}
            index={String(i + 1).padStart(2, '0')}
            title={b.title}
          >
            {b.node}
          </ModuleBlock>
        ))}
      </div>
    </div>
  );
}

/* ── Slide 3 — Research & Known Studies ──────────────────────────────────── */

function StudyEntry({ study }: { study: ProductStudy }) {
  return (
    <li className="border-t border-ink/[0.06] py-5 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h4 className="holo-text-display min-w-0 flex-1 break-words text-[13px] font-light leading-snug tracking-[-0.01em]">
          {study.url ? (
            <a
              href={study.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/t inline text-ink transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
            >
              {study.title}
              <span aria-hidden className="ml-1 align-middle text-[11px] text-holo/50 transition-colors group-hover/t:text-holo-light">↗</span>
            </a>
          ) : (
            study.title
          )}
        </h4>
        <span className="shrink-0 rounded-[2px] border border-ink/12 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink/55">
          {study.phase ?? MODEL_LABEL[study.model]}
        </span>
      </div>
      <p className="holo-text-citation mt-2 font-mono text-[10.5px] tracking-[0.08em]">
        {study.year} · {study.source} ·{' '}
        <span className="holo-text-caption">{MODEL_LABEL[study.model]} study</span>
      </p>
      {study.notes && study.notes.length > 0 && (
        <div className="mt-3 min-w-0">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.2em]">
            Observed
          </p>
          <ul className="mt-2 space-y-1.5">
            {study.notes.map((n) => (
              <li
                key={n}
                className="holo-text-body flex min-w-0 gap-2.5 text-[12px] leading-relaxed"
              >
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-holo/70" />
                <span className="min-w-0 flex-1 break-words">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {study.url && (
        <a
          href={study.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-3 inline-flex items-center gap-1.5 rounded-full border border-holo/25 bg-holo/[0.05] px-2.5 py-1 text-[10px] tracking-[0.1em] text-holo/80 transition-colors hover:border-holo/50 hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
        >
          <span>Read at {study.source}</span>
          <span aria-hidden className="text-holo/50 transition-colors group-hover:text-holo-light">↗</span>
        </a>
      )}
    </li>
  );
}

function SlideStudies({ ci }: { ci: CompoundIntelligence }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto px-5 pt-3 pb-6 sm:px-7 sm:pt-4">
      <Eyebrow>Known studies</Eyebrow>

      {/* Regulatory band */}
      <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-procurement)] border border-holo/15 sm:grid-cols-2">
        <div className="bg-holo/[0.025] px-4 py-3">
          <p className="holo-text-caption text-[9.5px] uppercase tracking-[0.24em]">
            FDA status
          </p>
          <p className="holo-text-body mt-1 font-mono text-[11px]">
            {ci.fdaStatus ?? 'Research use only — not FDA approved'}
          </p>
        </div>
        <div className="bg-holo/[0.025] px-4 py-3">
          <p className="holo-text-caption text-[9.5px] uppercase tracking-[0.24em]">
            Known human trials
          </p>
          <p className="mt-1 font-mono text-[11px]">
            <span className={ci.humanTrials ? 'holo-text-display font-semibold' : 'holo-text-citation'}>
              {ci.humanTrials ? 'YES' : 'NO'}
            </span>
            <span className="holo-text-citation ml-2">
              · {ci.studies.length} publications on record
            </span>
          </p>
        </div>
      </div>

      {ci.hasStudies ? (
        <ul className="mt-5">
          {ci.studies.map((s) => (
            <StudyEntry key={`${s.source}-${s.year}-${s.title}`} study={s} />
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-[13px] text-ink/45">
          Study record pending for this compound.
        </p>
      )}
    </div>
  );
}

/* ── Terminal ────────────────────────────────────────────────────────────── */

function ChevIcon({ dir }: { dir: 'l' | 'r' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'l' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

export function CompoundIntelligenceHero() {
  const trackRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState(FEATURED_SLUG);
  const [pickerOpen, setPickerOpen] = useState(false);
  const product =
    products.find((p) => p.slug === selectedSlug) ??
    products.find((p) => p.slug === FEATURED_SLUG);

  function selectCompound(slug: string) {
    setSelectedSlug(slug);
    setPickerOpen(false);
    setActive(0);
    requestAnimationFrame(() => {
      trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    });
  }

  // Close the compound picker on outside-click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPickerOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const go = useCallback((i: number) => {
    const t = trackRef.current;
    if (!t || t.clientWidth === 0) return;
    const idx = Math.max(0, Math.min(SLIDES.length - 1, i));
    t.scrollTo({
      left: idx * t.clientWidth,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    setActive(idx);
  }, []);

  // Reconcile active index with native scroll position (swipe / momentum)
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
    const onResize = () => {
      if (t.clientWidth === 0) return;
      t.scrollTo({ left: active * t.clientWidth, behavior: 'auto' });
    };
    t.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      t.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [active]);

  if (!product) return null;
  const ci: CompoundIntelligence = getCompoundIntelligence(product);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(active + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(active - 1);
    }
  }

  return (
    <div
      className="op-reveal"
      style={{ ['--op-delay' as string]: '160ms' }}
    >
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={`Featured compound intelligence: ${ci.substance}`}
        onKeyDown={onKeyDown}
        className="module-aura flex h-[572px] flex-col overflow-hidden rounded-[var(--radius-procurement)] border border-ink/[0.10] bg-display sm:h-[592px] lg:h-[616px]"
      >
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-ink/[0.08] px-4 py-0.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="op-tick h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 sm:inline">
              VS Research Labs · Compound Intelligence
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 sm:hidden">
              Compound Intel
            </span>
          </div>
          <div ref={pickerRef} className="relative flex min-w-0 items-center gap-2.5">
            <span className="hidden text-[10px] uppercase tracking-[0.24em] text-ink/30 md:inline">
              Featured
            </span>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
              className="group inline-flex min-w-0 items-center gap-1.5 rounded-full border border-ink/12 px-2.5 py-0.5 transition-colors hover:border-ink/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
            >
              <span className="truncate font-mono text-[11px] tracking-[0.06em] text-ink/85">
                {ci.substance}
              </span>
              <span aria-hidden className={`shrink-0 text-[9px] text-ink/40 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {pickerOpen && (
              <ul
                role="listbox"
                aria-label="Featured compound"
                className="absolute right-0 top-full z-40 mt-1.5 max-h-[300px] w-[210px] overflow-y-auto rounded-lg border border-ink/12 py-1 shadow-[0_14px_38px_-14px_rgba(26,23,20,0.35)]"
                style={{ backgroundColor: 'var(--color-surface-elevated)', backdropFilter: 'blur(8px)' }}
              >
                {FEATURED.map((p) => {
                  const on = p.slug === selectedSlug;
                  return (
                    <li key={p.slug}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => selectCompound(p.slug ?? FEATURED_SLUG)}
                        className={[
                          'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
                          on ? 'bg-holo/[0.10] text-holo font-medium' : 'text-ink/70 hover:bg-ink/[0.05] hover:text-ink',
                        ].join(' ')}
                      >
                        <span className="truncate">{p.name}</span>
                        {on && <span aria-hidden className="text-[11px] text-holo">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Tab strip */}
        <div
          role="tablist"
          aria-label="Compound intelligence slides"
          className="flex shrink-0 border-b border-ink/[0.08]"
        >
          {SLIDES.map((s, i) => {
            const on = i === active;
            return (
              <button
                key={s.key}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => go(i)}
                className="group relative flex-1 px-3 py-0.5 text-left focus:outline-none focus-visible:bg-ink/[0.03]"
              >
                <span className="font-mono text-[9.5px] tabular-nums text-ink/30">
                  0{i + 1}
                </span>
                <span
                  className={`ml-2 text-[10.5px] uppercase tracking-[0.18em] transition-colors ${
                    on ? 'text-ink' : 'text-ink/40 group-hover:text-ink/65'
                  }`}
                >
                  {s.tab}
                </span>
                <span
                  aria-hidden
                  className={`absolute inset-x-0 bottom-0 h-px transition-colors ${
                    on ? 'bg-holo shadow-[0_0_10px_rgba(140, 144, 148,0.55)]' : 'bg-transparent'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Slide track */}
        <div
          ref={trackRef}
          className="cih-track flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        >
          <section
            aria-label="Slide 1: Visual Compound Panel"
            className="min-w-full max-w-full shrink-0 snap-start snap-always"
          >
            <SlidePanel ci={ci} product={product} onOpenRecord={() => setRecordOpen(true)} />
          </section>
          <section
            aria-label="Slide 2: Intelligence Dossier"
            className="min-w-full max-w-full shrink-0 snap-start snap-always"
          >
            <SlideDossier ci={ci} />
          </section>
          <section
            aria-label="Slide 3: Research and Known Studies"
            className="min-w-full max-w-full shrink-0 snap-start snap-always"
          >
            <SlideStudies ci={ci} />
          </section>
        </div>

        {/* Footer control bar */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-ink/[0.08] px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-ink/55">
              0{active + 1}{' '}
              <span className="text-ink/25">/ 0{SLIDES.length}</span>
            </span>
            <span className="flex items-center gap-1.5" aria-hidden>
              {SLIDES.map((s, i) => (
                <span
                  key={s.key}
                  className={`h-px w-6 transition-colors duration-200 ${
                    i === active ? 'bg-holo shadow-[0_0_8px_rgba(140, 144, 148,0.5)]' : 'bg-ink/15'
                  }`}
                />
              ))}
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-ink/35 sm:inline">
              {SLIDES[active].title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(active - 1)}
              disabled={active === 0}
              aria-label="Previous slide"
              className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-ink/12 text-ink/55 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
            >
              <ChevIcon dir="l" />
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              disabled={active === SLIDES.length - 1}
              aria-label="Next slide"
              className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-ink/12 text-ink/55 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
            >
              <ChevIcon dir="r" />
            </button>
          </div>
        </div>
      </div>
      {recordOpen && (
        <CompoundIntelligenceOverlay product={product} onClose={() => setRecordOpen(false)} />
      )}
    </div>
  );
}
