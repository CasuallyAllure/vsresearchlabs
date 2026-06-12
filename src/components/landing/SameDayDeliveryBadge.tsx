/**
 * SameDayDeliveryBadge
 *
 * Inline interactive token used in the Landing hero body copy. The
 * word "same-day" reads as a quietly underlined link; clicking opens
 * a small floating dossier listing the qualifying Bay Area zones plus
 * the $200 minimum-order requirement. Click outside (or click the
 * trigger again, or press Escape) to close.
 *
 * Holographic register matches the hologram carousel — cyan border,
 * mono caption, soft glow.
 */

import { useEffect, useRef, useState } from 'react';

const ZONES = [
  'Benicia, CA',
  'American Canyon, CA',
  'Vallejo, CA',
  'Fairfield, CA',
  'Napa, CA',
  'Hercules, CA',
  'Pinole, CA',
];

export function SameDayDeliveryBadge() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="View same-day delivery zones"
        className="cursor-pointer border-b border-dashed border-holo/45 font-medium text-holo-light transition-colors hover:border-holo/75 hover:text-holo focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/40 rounded-[1px]"
        style={{
          textShadow: '0 0 6px rgba(100,200,255,0.45), 0 0 14px rgba(100,200,255,0.2)',
        }}
      >
        same-day
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Same-day delivery zones"
          className="absolute left-0 top-full z-40 mt-2 w-[300px] max-w-[88vw] rounded-[3px] p-3"
          style={{
            backgroundColor: 'rgba(7, 16, 24, 0.95)',
            border: '1px solid rgba(120, 210, 255, 0.5)',
            boxShadow:
              '0 0 0 0.5px rgba(160, 225, 255, 0.35), 0 0 22px rgba(100, 200, 255, 0.35), 0 8px 28px rgba(0,0,0,0.6), inset 0 0 18px rgba(100, 200, 255, 0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Corner registration marks */}
          <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1 h-1.5 w-1.5 border-l border-t border-holo/55" />
          <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 border-r border-t border-holo/55" />
          <span aria-hidden="true" className="pointer-events-none absolute left-1 bottom-1 h-1.5 w-1.5 border-l border-b border-holo/55" />
          <span aria-hidden="true" className="pointer-events-none absolute right-1 bottom-1 h-1.5 w-1.5 border-r border-b border-holo/55" />

          <p
            className="mb-2 font-mono text-[8px] uppercase tracking-[0.28em] text-holo/70"
            style={{ textShadow: '0 0 4px rgba(100,200,255,0.45)' }}
          >
            Same-Day Delivery Zones
          </p>

          <ul className="mb-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
            {ZONES.map((z) => (
              <li
                key={z}
                className="font-mono text-[10px] text-white/80"
                style={{ textShadow: '0 0 4px rgba(100,200,255,0.3)' }}
              >
                <span className="text-holo/70">·</span> {z}
              </li>
            ))}
          </ul>

          <div className="border-t border-holo/20 pt-2">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/65">
              Minimum order: <span className="text-holo-light font-medium">$200</span>
            </p>
            <p className="mt-0.5 text-[9px] text-white/40">
              Orders below this threshold ship via next-day delivery.
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
