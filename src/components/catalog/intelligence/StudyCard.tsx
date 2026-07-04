/**
 * StudyCard — canonical published-study renderer
 *
 * One published research study, rendered as a single operational row:
 * sequence index, title, external link, meta band (year · model ·
 * source · phase), and an optional "Observed" bullet block.
 *
 * Human-trial studies receive a tinted model chip (blue register) to
 * surface clinical evidence at a glance. All other study models use the
 * neutral chip register.
 *
 * Consumed by:
 *   - CompoundIntelligenceOverlay (Studies module)
 *   - CompoundIntelligenceHero (Studies slide) — pending re-skin
 *   - ProductPage (E3 Studies module) — pending
 *
 * Visuals are frozen.
 */

import type { ProductStudy, StudyModel } from '../../../types';

const STUDY_MODEL_LABEL: Record<StudyModel, string> = {
  'human':    'Human Study',
  'rat':      'Rat Model',
  'mouse':    'Mouse Model',
  'in-vitro': 'In Vitro',
  'in-vivo':  'In Vivo',
  'ex-vivo':  'Ex Vivo',
  'review':   'Review',
};

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

interface StudyCardProps {
  study: ProductStudy;
  /** Zero-based index; rendered as `01`, `02`. */
  index: number;
}

export function StudyCard({ study, index }: StudyCardProps) {
  const isHumanTrial = study.model === 'human';
  return (
    <div className="py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      {/* Index + title + link */}
      <div className="flex items-start gap-2.5 mb-2">
        <span className="font-mono text-ink/20 tabular-nums shrink-0 pt-0.5" style={{ fontSize: '9px', minWidth: '14px' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <p className="text-ink/68 flex-1 min-w-0 leading-snug" style={{ fontSize: '11.5px' }}>
          {study.title}
        </p>
        {study.url && (
          <a href={study.url} target="_blank" rel="noopener noreferrer"
            className="text-ink/22 hover:text-ink/65 transition-colors shrink-0 mt-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/25 rounded-sm"
            aria-label="Open study source">
            <ExternalLinkIcon />
          </a>
        )}
      </div>

      {/* Meta row: year · model · source · phase */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 mb-2">
        <span className="text-ink/30 font-mono tabular-nums" style={{ fontSize: '9.5px' }}>{study.year}</span>
        <span className="text-ink/14" aria-hidden="true">·</span>
        <span
          className="uppercase"
          style={{
            fontSize: '8px', letterSpacing: '0.14em', padding: '1px 4px', borderRadius: '2px',
            backgroundColor: isHumanTrial ? 'rgba(140, 144, 148,0.08)' : 'var(--color-interactive-secondary)',
            border: isHumanTrial ? '1px solid rgba(140, 144, 148,0.18)' : '1px solid var(--color-border-subtle)',
            color: isHumanTrial ? 'rgba(140,144,148,0.75)' : 'var(--color-content-tertiary)',
          }}>
          {STUDY_MODEL_LABEL[study.model]}
        </span>
        <span className="text-ink/14" aria-hidden="true">·</span>
        <span className="text-ink/28" style={{ fontSize: '9.5px' }}>{study.source}</span>
        {study.phase && (
          <>
            <span className="text-ink/14" aria-hidden="true">·</span>
            <span className="text-ink/30 uppercase" style={{ fontSize: '8px', letterSpacing: '0.12em', backgroundColor: 'var(--color-interactive-secondary)', padding: '1px 4px', borderRadius: '2px', border: '1px solid var(--color-border-subtle)' }}>
              {study.phase}
            </span>
          </>
        )}
      </div>

      {/* Observed findings */}
      {study.notes && study.notes.length > 0 && (
        <div className="pl-5">
          <p className="text-ink/20 uppercase mb-1.5" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>Observed</p>
          <ul className="space-y-1">
            {study.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-ink/25 shrink-0 mt-[3px]" aria-hidden="true" style={{ fontSize: '8px' }}>•</span>
                <span className="text-ink/45" style={{ fontSize: '10.5px', lineHeight: '1.5' }}>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
