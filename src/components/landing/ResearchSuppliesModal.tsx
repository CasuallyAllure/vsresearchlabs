/**
 * ResearchSuppliesModal
 *
 * The /research-supplies hub experience as a landing pop-up: the three
 * compound domains (Biopeptide / Nootropics / Dermatological) as a picker. Each row
 * routes to its domain catalog. Lets the buyer choose a domain without leaving
 * the landing page. Centered modal, ESC / backdrop to close, body scroll-lock.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useProductStore } from '../../stores/productStore';
import { useScrollLock } from '../../lib/useScrollLock';

interface DomainRow {
  to: string;
  eyebrow: string;
  title: string;
  body: string;
  category: string;
}

const ROWS: DomainRow[] = [
  {
    to: '/research-supplies/biopeptide',
    eyebrow: '01',
    title: 'Biopeptide',
    body: 'Lyophilized peptides for metabolic, regenerative, growth-factor, and immunomodulatory research models.',
    category: 'biopeptide-research-supplies',
  },
  {
    to: '/research-supplies/nootropics',
    eyebrow: '02',
    title: 'Nootropics',
    body: 'Neuroactive compounds for cognition, plasticity, and neuroprotection research models.',
    category: 'nootropics-research-supplies',
  },
  {
    to: '/research-supplies/skincare',
    eyebrow: '03',
    title: 'Dermatological',
    body: 'Topical and dermal-tissue research compounds for barrier, repair, and pigmentation research models.',
    category: 'skincare-research-supplies',
  },
];

export function ResearchSuppliesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useProductStore((s) => s.products);

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const countFor = (cat: string) => products.filter((p) => p.category === cat).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Research supplies — choose a domain"
      className="fixed inset-0 z-[80] flex items-center justify-center p-[var(--space-4)]"
      style={{ background: 'rgba(26,23,20,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[14px] border border-ink/[0.12] bg-display shadow-[0_24px_60px_-18px_rgba(26,23,20,0.5)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-[var(--space-4)] px-[var(--space-6)] pt-[var(--space-6)] pb-[var(--space-4)] border-b border-ink/[0.06]">
          <div>
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
              Research Supplies
            </p>
            <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.02em] text-ink">
              <span className="font-light text-ink/85">Compounds </span>
              <span className="font-medium text-ink">by domain.</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mr-1 -mt-1 p-2 text-ink/45 hover:text-ink rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Domain rows */}
        <ul>
          {ROWS.map((row) => {
            const count = countFor(row.category);
            return (
              <li key={row.to} className="border-b border-ink/[0.06]">
                <Link
                  to={row.to}
                  onClick={onClose}
                  className="group flex items-start gap-[var(--space-4)] px-[var(--space-6)] py-[var(--space-5)] transition-colors hover:bg-ink/[0.02] focus:outline-none focus-visible:bg-ink/[0.03]"
                >
                  <span className="holo-text-display font-mono text-[12px] tabular-nums tracking-[0.1em] pt-1 shrink-0 text-ink/35">
                    {row.eyebrow}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[clamp(1.05rem,2vw,1.3rem)] font-light text-ink tracking-tight leading-tight">
                      {row.title}
                    </h3>
                    <p className="holo-text-body mt-[var(--space-2)] text-[12.5px] leading-relaxed text-ink/60">
                      {row.body}
                    </p>
                    <p className="holo-text-caption mt-[var(--space-2)] text-[10px] uppercase tracking-[0.24em] text-ink/40">
                      {count} {count === 1 ? 'compound' : 'compounds'} on file
                    </p>
                  </div>
                  <span aria-hidden="true" className="shrink-0 self-center text-lg text-ink/25 transition-colors group-hover:text-holo-light">
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="px-[var(--space-6)] py-[var(--space-4)]">
          <Link
            to="/laboratory-equipment"
            onClick={onClose}
            className="text-[11px] text-ink/50 hover:text-holo-light transition-colors"
          >
            Equipment &amp; consumables live under Laboratory Equipment →
          </Link>
        </div>
      </div>
    </div>
  );
}
