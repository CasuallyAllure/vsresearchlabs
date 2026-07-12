/**
 * HeroSegmentMenu — a hero CTA that opens a small popover "bubble" letting
 * the user pick a pillar (Biopeptide · Nootropics · Skin-Care) before routing.
 *
 * Mirrors the SameDayDeliveryBadge interaction: click toggles; click-outside
 * or Escape closes; selecting an item navigates and closes. The trigger pill
 * styling is passed in via `triggerClassName` + `children` so it reuses the
 * existing .hero-cta-* pills.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface SegmentItem {
  label: string;
  caption?: string;
  to: string;
}

interface HeroSegmentMenuProps {
  /** Pill classes for the trigger button (reuse .hero-cta-* etc.). */
  triggerClassName: string;
  /** Trigger inner content (sheen span + label + optional arrow). */
  children: ReactNode;
  items: SegmentItem[];
  heading?: string;
  /** Anchor the bubble to the right edge of the trigger instead of the left. */
  alignRight?: boolean;
}

export function HeroSegmentMenu({
  triggerClassName,
  children,
  items,
  heading = 'Choose a segment',
  alignRight = false,
}: HeroSegmentMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClassName}
      >
        {children}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={heading}
          className={`absolute top-full z-50 mt-2 w-[238px] max-w-[82vw] rounded-[10px] p-1.5 ${
            alignRight ? 'right-0' : 'left-0'
          }`}
          style={{
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid rgba(26, 23, 20, 0.12)',
            boxShadow: '0 14px 38px -14px rgba(26,23,20,0.32)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* caret */}
          <span
            aria-hidden="true"
            className={`absolute -top-[5px] h-2.5 w-2.5 rotate-45 ${alignRight ? 'right-5' : 'left-5'}`}
            style={{ backgroundColor: 'var(--color-surface-elevated)', borderLeft: '1px solid var(--color-border-default)', borderTop: '1px solid var(--color-border-default)' }}
          />
          <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.26em] text-ink/40">
            {heading}
          </p>
          {items.map((it) => (
            <Link
              key={`${it.label}-${it.to}`}
              to={it.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="group flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 transition-colors hover:bg-ink/[0.05] focus:outline-none focus-visible:bg-ink/[0.05]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-[12.5px] tracking-tight text-ink">{it.label}</span>
                {it.caption && (
                  <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
                    {it.caption}
                  </span>
                )}
              </span>
              <span aria-hidden="true" className="shrink-0 text-ink/30 transition-colors group-hover:text-holo">
                →
              </span>
            </Link>
          ))}
        </div>
      )}
    </span>
  );
}
