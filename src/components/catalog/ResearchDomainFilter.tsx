/**
 * ResearchDomainFilter — "which biological system is this studied in?"
 *
 * The library's second filter dimension, sitting above the mechanism
 * (classification) filter. Mechanism answers *how* a compound acts;
 * this answers *where the research lives* — metabolic, neurological,
 * tissue repair, dermatological, and so on.
 *
 * Register: the control is labelled "Research domain" and each option's
 * description says what the compound class is STUDIED IN. Never an
 * outcome, never second person — these are research materials.
 *
 * A quiet pill row rather than a dropdown: there are only ever eight
 * systems, and seeing the whole map at once is the point.
 */

import type { ResearchDomain } from '../../lib/researchDomain';
import {
  RESEARCH_DOMAIN_LABELS,
  RESEARCH_DOMAIN_DESCRIPTIONS,
} from '../../lib/researchDomain';

export const ALL_DOMAINS = '__all_domains__';

const ALL_DESCRIPTION =
  'Every compound on record, across all research domains. Pick a system to narrow the library to the compounds studied in it.';

interface ResearchDomainFilterProps {
  /** Domains present in the current dataset, in canonical display order. */
  domains: ResearchDomain[];
  value: string;
  onChange: (value: string) => void;
  /** Compound count per domain, shown alongside each pill. */
  counts?: Partial<Record<ResearchDomain, number>>;
}

export function ResearchDomainFilter({ domains, value, onChange, counts }: ResearchDomainFilterProps) {
  const isAll = value === ALL_DOMAINS;
  const description = isAll
    ? ALL_DESCRIPTION
    : RESEARCH_DOMAIN_DESCRIPTIONS[value as ResearchDomain] ?? ALL_DESCRIPTION;

  const options: { id: string; label: string; count?: number }[] = [
    { id: ALL_DOMAINS, label: 'All systems' },
    ...domains.map((d) => ({ id: d, label: RESEARCH_DOMAIN_LABELS[d], count: counts?.[d] })),
  ];

  return (
    <div className="mb-[var(--space-3)]">
      <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/40">
        Research domain — biological system studied
      </p>
      <div role="group" aria-label="Filter by biological system studied" className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.id)}
              className={[
                'inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35',
                active
                  ? 'border-ink/40 bg-ink/[0.07] text-ink font-medium'
                  : 'border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink/85',
              ].join(' ')}
            >
              <span>{opt.label}</span>
              {typeof opt.count === 'number' && (
                <span className="font-mono tabular-nums text-[10px] text-ink/35">{opt.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-[var(--space-2)] flex gap-1.5 text-[13px] leading-relaxed text-ink/60">
        <span aria-hidden="true" className="text-ink/35">—</span>
        <span>{description}</span>
      </p>
    </div>
  );
}
