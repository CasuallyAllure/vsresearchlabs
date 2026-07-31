/**
 * AccountTabs — the portal's section switcher.
 *
 * WS-5 (docs/MEMBERSHIP_EXPERIENCE_BLUEPRINT.md, "instrument, not boutique"):
 * AccountLayout previously rendered the six portal sections as gold-tinted
 * PillTabs — the catalog/document-filter idiom, and one of the "boutique"
 * surfaces the owner called out. This is the admin Members SubNav grammar
 * instead (src/pages/admin/members/ui.tsx `SubNav`): a quiet ink-toned
 * segmented strip, no gold wash.
 *
 * A dedicated component rather than a PillTabs prop-fork: PillTabs' gold pill
 * is a genuinely different visual language for a different job (catalog/
 * document filters), and four other surfaces (Catalog, Research,
 * Documentation, LaboratoryEquipment) consume it as-is — this leaves that
 * file, and their look, completely untouched.
 *
 * Six section labels don't reliably fit a 375px strip, so the strip scrolls
 * horizontally and shows a hairline edge shadow (an inset box-shadow, not a
 * solid overlay, so it reads correctly over any background/theme) on
 * whichever side still has hidden tabs — the "visible tab-overflow
 * affordance" the design direction calls for.
 *
 * Each tab's visible pill stays compact (10px label) but keeps a 44px
 * min-height hit area — the same "compact visual, padded hit area" technique
 * docs/DESIGN_2026_BLUEPRINT.md prescribes for AdminLayout nav — because this
 * is a touch-first customer surface, not an admin console.
 */

import { useEffect, useRef, useState } from 'react';

export interface AccountTabItem {
  id: string;
  label: string;
}

interface AccountTabsProps {
  items: AccountTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

/** Ink-toned edge shadow — reuses the existing --c-ink channel token rather
 *  than a new hardcoded color, so it recolors correctly across light/dark/lab. */
const EDGE_SHADOW = 'rgb(var(--c-ink) / 0.16)';

export function AccountTabs({ items, activeId, onChange, ariaLabel }: AccountTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function measure() {
      if (!el) return;
      setOverflow({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    }

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    // happy-dom/jsdom (unit tests) don't implement ResizeObserver — guard the
    // same way AuthCard.tsx already does, rather than adding a polyfill.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [items.length]);

  const shadow = [
    overflow.left ? `inset 12px 0 10px -10px ${EDGE_SHADOW}` : '',
    overflow.right ? `inset -12px 0 10px -10px ${EDGE_SHADOW}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label={ariaLabel}
      className="flex max-w-full gap-[2px] overflow-x-auto rounded-full border border-ink/10 bg-ink/[0.02] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={shadow ? { boxShadow: shadow } : undefined}
    >
      {items.map((item) => {
        const on = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              if (!on) onChange(item.id);
            }}
            className={[
              'flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-[var(--space-3)] text-[10px] uppercase tracking-[0.16em] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50',
              on ? 'bg-ink/[0.08] font-medium text-ink' : 'text-ink/50 hover:text-ink',
            ].join(' ')}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default AccountTabs;
