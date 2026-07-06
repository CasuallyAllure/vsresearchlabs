/**
 * ResearchSuppliesHub
 *
 * Compound catalog hub at /research-supplies. Surfaces the three
 * compound categories (Biopeptide / Nootropics / Skincare) as a
 * picker. Adding a fourth compound vertical later is a one-row
 * addition here — zero nav restructure.
 */

import { Link } from 'react-router-dom';
import { useProductStore } from '../stores/productStore';

interface HubRow {
  to: string;
  eyebrow: string;
  title: string;
  body: string;
  countCategory: string;
}

const ROWS: HubRow[] = [
  {
    to: '/research-supplies/biopeptide',
    eyebrow: '01',
    title: 'Biopeptide',
    body:
      'Lyophilized peptides for metabolic, regenerative, growth-factor, and immunomodulatory research models.',
    countCategory: 'biopeptide-research-supplies',
  },
  {
    to: '/research-supplies/nootropics',
    eyebrow: '02',
    title: 'Nootropics',
    body:
      'Neuroactive compounds for cognition, plasticity, and neuroprotection research models.',
    countCategory: 'nootropics-research-supplies',
  },
  {
    to: '/research-supplies/skincare',
    eyebrow: '03',
    title: 'Skincare',
    body:
      'Topical and dermatological research compounds for barrier, repair, and pigmentation models.',
    countCategory: 'skincare-research-supplies',
  },
];

export function ResearchSuppliesHub() {
  const products = useProductStore((s) => s.products);

  function countFor(category: string): number {
    return products.filter((p) => p.category === category).length;
  }

  return (
    <section className="pt-[var(--space-4)] pb-[var(--space-8)]">
      <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Research Supplies
        </p>
        <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Compounds </span>
          <span className="font-light text-ink">by domain.</span>
        </h1>
        <p className="holo-text-body mt-[var(--space-3)] max-w-[52ch] text-[13px] leading-relaxed">
          Compound catalogs separated by research domain. Equipment,
          consumables, and handling tools live under{' '}
          <Link
            to="/laboratory-equipment"
            className="text-holo-light underline underline-offset-4 decoration-holo/30 hover:decoration-holo-light/60 transition-colors"
          >
            Laboratory Equipment
          </Link>
          .
        </p>
      </header>

      <ul className="border-t border-ink/[0.06]">
        {ROWS.map((row) => {
          const count = countFor(row.countCategory);
          return (
            <li key={row.to} className="border-b border-ink/[0.06]">
              <Link
                to={row.to}
                className="group flex items-start gap-[var(--space-5)] py-[var(--space-6)] transition-colors duration-150 hover:bg-ink/[0.015] focus:outline-none focus-visible:bg-ink/[0.02]"
              >
                <span className="holo-text-display font-mono text-[13px] tabular-nums tracking-[0.1em] pt-1 shrink-0">
                  {row.eyebrow}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[clamp(1.1rem,2vw,1.4rem)] font-light text-ink tracking-tight leading-tight">
                    {row.title}
                  </h2>
                  <p className="holo-text-body mt-[var(--space-2)] text-[13px] leading-relaxed max-w-[60ch]">
                    {row.body}
                  </p>
                  <p className="holo-text-caption mt-[var(--space-3)] text-[10px] uppercase tracking-[0.25em]">
                    {count} {count === 1 ? 'compound' : 'compounds'} on file
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 self-center text-lg text-ink/25 transition-colors duration-150 group-hover:text-holo-light"
                >
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
