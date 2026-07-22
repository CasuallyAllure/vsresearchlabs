/**
 * BundlePairModal — the "what's in the paired supply" panel.
 *
 * The paired-supply slide sells TWO compounds as one requisition, so opening it
 * must never drop the visitor into a single compound's dossier (which reads as
 * if the bundle were only that one thing). This modal states plainly that you
 * receive one vial of EACH, lists both with a short plain-language line, and
 * links each to its full compound record — while previewing the pairing price.
 *
 * Self-contained: it owns the per-compound "full record" overlay so the parent
 * tile only toggles `open`. Pricing is computed by the parent (BundleOfferTile)
 * and passed in, so this panel never re-derives a price.
 */

import { useEffect, useState } from 'react';
import type { Product } from '../../types';
import { formatPrice } from '../../lib/pricing';
import { Button } from '../ui/Button';
import { CompoundIntelligenceOverlay } from './CompoundIntelligenceOverlay';

interface BundlePairModalProps {
  open: boolean;
  onClose: () => void;
  productA: Product;
  doseA: string;
  productB: Product;
  doseB: string;
  totalCents: number;
  bundleCents: number;
  discountCents: number;
  percent: number;
  onAddPair: () => void;
}

/** A clean one-line plain-language summary, markdown stripped. */
function plainSummary(p: Product): string {
  const short = p.shortDescription?.trim();
  if (short) return short;
  return (p.laymanSummary ?? '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function CompoundRow({
  product,
  dose,
  onInspect,
}: {
  product: Product;
  dose: string;
  onInspect: (id: string) => void;
}) {
  const image = product.images?.[0] ?? null;
  return (
    <div className="flex gap-3 border-b border-ink/[0.06] py-3 last:border-b-0">
      {image && (
        <img
          src={image}
          alt={`${product.name} research vial`}
          className="h-16 w-16 shrink-0 rounded-[10px] bg-[#ECEEEF] object-contain"
          loading="lazy"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] font-medium text-ink">
            {product.name} <span className="font-mono text-[11px] text-ink/55">{dose}</span>
          </p>
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink/45">
            1 vial
          </span>
        </div>
        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-ink/65">
          {plainSummary(product)}
        </p>
        <button
          type="button"
          onClick={() => onInspect(product.id)}
          className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.16em] text-holo/75 transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40"
        >
          <span>View full record</span>
          <span aria-hidden="true" className="text-holo/45">↗</span>
        </button>
      </div>
    </div>
  );
}

export function BundlePairModal({
  open,
  onClose,
  productA,
  doseA,
  productB,
  doseB,
  totalCents,
  bundleCents,
  discountCents,
  percent,
  onAddPair,
}: BundlePairModalProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  // ESC closes the panel (unless the full-record overlay is up — it owns ESC).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !inspectedId) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, inspectedId]);

  // Body scroll lock (skip while the full-record overlay manages its own).
  useEffect(() => {
    if (!open || inspectedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, inspectedId]);

  if (!open) return null;

  const inspectedProduct =
    inspectedId === productA.id ? productA : inspectedId === productB.id ? productB : null;

  function handleAdd() {
    onAddPair();
    setAdded(true);
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-[color:var(--scrim)] backdrop-blur-[3px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Paired supply — ${productA.name} and ${productB.name}`}
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      >
        <div
          className="glass-panel pointer-events-auto flex max-h-[90vh] w-full max-w-[540px] flex-col overflow-hidden rounded-[24px]"
          style={{ boxShadow: 'var(--glass-highlight), var(--elev-3)' }}
        >
          {/* Header */}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink/[0.08] px-[var(--space-5)] pb-[var(--space-4)] pt-[var(--space-5)]">
            <div className="min-w-0">
              <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-status-success)]">
                Paired supply
              </p>
              <h2 className="text-[clamp(1.05rem,2.4vw,1.35rem)] leading-[1.15] tracking-[-0.01em] text-ink">
                {productA.name} <span className="text-ink/45">+</span> {productB.name}
              </h2>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink/60">
                One requisition — you receive <span className="text-ink/85">one vial of each</span>{' '}
                compound below.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close paired supply details"
              className="-mr-1.5 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/55 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          {/* Both compounds */}
          <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-2)]">
            <CompoundRow product={productA} dose={doseA} onInspect={setInspectedId} />
            <CompoundRow product={productB} dose={doseB} onInspect={setInspectedId} />
          </div>

          {/* Price + add */}
          <footer className="shrink-0 border-t border-ink/[0.08] px-[var(--space-5)] py-[var(--space-4)]">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-mono text-[13px] tabular-nums text-ink/40 line-through">
                {formatPrice(totalCents)}
              </span>
              <span className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">
                {formatPrice(bundleCents)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink/50">
                {percent}% pairing reduction ({formatPrice(discountCents)})
              </span>
            </div>
            <p className="mb-3.5 mt-2 max-w-[48ch] text-[10.5px] leading-relaxed text-ink/45">
              Applied automatically when both compounds are on the same requisition. Final price —
              not combinable with discount codes.
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleAdd}
              className="w-full md:w-auto md:min-w-[240px]"
              aria-label={`Add ${productA.name} ${doseA} and ${productB.name} ${doseB} to inquiry`}
            >
              {added ? '✓ Added' : 'Add pair to inquiry'}
            </Button>
          </footer>
        </div>
      </div>

      {/* Full record — renders above the panel; its own focus trap + ESC. */}
      {inspectedProduct && (
        <CompoundIntelligenceOverlay
          product={inspectedProduct}
          onClose={() => setInspectedId(null)}
        />
      )}
    </>
  );
}
