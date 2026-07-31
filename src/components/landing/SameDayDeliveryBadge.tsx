/**
 * SameDayDeliveryBadge
 *
 * Inline interactive token used in the Landing hero body copy. The word
 * "same-day" reads as a clearly clickable link; clicking opens a small
 * centered dossier (above everything, never clipped) listing the qualifying
 * Bay Area zones, the $300 minimum order, and the shipping windows. Click
 * the backdrop, click the trigger again, or press Escape to close.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SAME_DAY_ZONES as ZONES } from '../../lib/sameDayDelivery';

export function SameDayDeliveryBadge() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="View same-day delivery zones"
        className="sdd-trigger inline-flex items-center gap-1 cursor-pointer align-baseline font-semibold text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/60"
      >
        same-day
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mb-[1px] text-holo">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Glowing "void" highlight — a teal-lit pill that gently breathes so the
          eye lands on the delivery offer. Motion is idle-only + reduced-motion safe. */}
      <style>{`
        .sdd-trigger {
          position: relative;
          border-radius: 999px;
          padding: 0.06em 0.55em;
          background: rgb(var(--c-teal) / 0.10);
          box-shadow: inset 0 0 0 1px rgb(var(--c-teal) / 0.40), 0 0 10px 0 rgb(var(--c-teal) / 0.28);
          animation: sddGlow 2.6s ease-in-out infinite;
          transition: transform 160ms ease, box-shadow 200ms ease, background-color 200ms ease;
        }
        .sdd-trigger:hover { background: rgb(var(--c-teal) / 0.17); }
        @keyframes sddGlow {
          0%, 100% {
            box-shadow: inset 0 0 0 1px rgb(var(--c-teal) / 0.35), 0 0 7px 0 rgb(var(--c-teal) / 0.22);
            transform: scale(1);
          }
          50% {
            box-shadow: inset 0 0 0 1px rgb(var(--c-teal) / 0.60), 0 0 18px 2px rgb(var(--c-teal) / 0.55);
            transform: scale(1.02);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sdd-trigger { animation: none; }
        }
      `}</style>

      {open && createPortal(
        <>
          {/* Backdrop — closes on click, sits above page content */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70]"
            style={{ backgroundColor: 'rgba(26,23,20,0.28)', backdropFilter: 'blur(2px)' }}
          />

          {/* Centered dossier — always on top, fully visible */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Same-day delivery zones"
            className="fixed left-1/2 top-1/2 z-[71] w-[340px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-[6px] p-4 text-left"
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid rgba(26, 23, 20, 0.14)',
              boxShadow: '0 24px 60px -18px rgba(26,23,20,0.45), 0 0 0 0.5px rgba(26,23,20,0.05)',
            }}
          >
            {/* Corner registration marks */}
            <span aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t border-holo/55" />
            <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t border-holo/55" />
            <span aria-hidden="true" className="pointer-events-none absolute left-1.5 bottom-1.5 h-2 w-2 border-l border-b border-holo/55" />
            <span aria-hidden="true" className="pointer-events-none absolute right-1.5 bottom-1.5 h-2 w-2 border-r border-b border-holo/55" />

            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-holo">
                Same-Day Delivery Zones
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 -mt-1 p-1 text-ink/40 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-sm"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <ul className="mt-3 mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {ZONES.map((z) => (
                <li key={z} className="font-mono text-[10.5px] text-ink/80">
                  <span className="text-holo">·</span> {z}
                </li>
              ))}
            </ul>

            <div className="border-t border-holo/20 pt-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/70">
                Minimum order: <span className="text-holo font-semibold">$300</span>
                <span className="mx-1.5 text-ink/25">·</span>
                Wholesale excluded
              </p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink/55">
                Orders over <span className="text-ink/80 font-medium">$300</span> in these zones qualify for{' '}
                <span className="text-ink/80 font-medium">same- to next-day delivery</span> — wholesale case orders excluded.
                Everywhere else, in-stock <span className="text-ink/80 font-medium">24 Hour</span> items still ship within 24 hours; standard items in 7–10 business days.
              </p>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
