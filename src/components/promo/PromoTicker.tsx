/**
 * PromoTicker — the standing-offer bar that sits directly under the header on
 * shop surfaces.
 *
 * Offers drift past separated by dots. Hovering, focusing or TAPPING one
 * pauses the drift and opens a detail panel beneath the bar explaining the
 * term. Tap matters as much as hover: the design blueprint hard-bans
 * hover-only affordances, and a phone has no hover at all.
 *
 * Three things worth knowing before editing:
 *
 *   - The strip is rendered TWICE and translated -50%, which is what makes the
 *     loop seamless. The second copy is `aria-hidden` + untabbable so screen
 *     readers and the tab order see each offer exactly once.
 *   - Motion is `transform` only (never width/left) and stops dead under
 *     `prefers-reduced-motion`, where the offers simply wrap as static text.
 *   - The detail panel is absolutely positioned so opening it never reflows
 *     the page underneath.
 *
 * Content comes from lib/promoOffers — this file decides nothing about which
 * offers are live or what they mean.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  activeOffers,
  isPromoSurface,
  offersSignature,
  type PromoOffer,
} from '../../lib/promoOffers';
import { usePromoSettings, isB2G1LiveFrom } from '../../lib/promoSettings';
import { useCustomerAuth } from '../../lib/customerAuth';

const DISMISS_KEY = 'vsrl_promo_ticker_dismissed_v1';
/** Seconds of travel per character of strip content — keeps the drift at a
 *  constant reading speed no matter how many offers are live. */
const SECONDS_PER_CHAR = 0.34;

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null; // Private mode / storage disabled — just show the bar.
  }
}

function writeDismissed(signature: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, signature);
  } catch {
    // Non-fatal: the bar reappears next visit, which is the safe direction.
  }
}

export function PromoTicker() {
  const { pathname } = useLocation();
  const { user, profile } = useCustomerAuth();
  // Subscribing keeps the bar in step with the promo store: when B2G1 loads in
  // as live, the offer list (and its signature) updates without a reload.
  const b2g1Enabled = usePromoSettings((s) => s.b2g1Enabled);
  const b2g1EndsAt = usePromoSettings((s) => s.b2g1EndsAt);
  const load = usePromoSettings((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const offers = useMemo(
    () =>
      activeOffers(
        { isMember: !!user, tier: profile?.tier ?? null },
        // Evaluated from the SUBSCRIBED values, so the bar picks the promo up
        // the moment the store loads rather than reading a stale getState().
        isB2G1LiveFrom(b2g1Enabled, b2g1EndsAt),
      ),
    [user, profile?.tier, b2g1Enabled, b2g1EndsAt],
  );
  const signature = useMemo(() => offersSignature(offers), [offers]);

  // Read once during the first render — this is a client-only SPA, so there is
  // no server pass to guard against, and a lazy initial value avoids the
  // dismissed bar flashing in before an effect could hide it.
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const [activeId, setActiveId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Escape closes the detail panel. Capture phase + stopPropagation so it does
  // not also close whatever drawer or modal is open behind the bar.
  useEffect(() => {
    if (!activeId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setActiveId(null);
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [activeId]);

  // A click anywhere else closes the panel — the bar is chrome, not a modal.
  useEffect(() => {
    if (!activeId) return;
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setActiveId(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activeId]);

  if (!isPromoSurface(pathname)) return null;
  if (offers.length === 0) return null;
  if (dismissed === signature) return null;

  const active = offers.find((o) => o.id === activeId) ?? null;
  const stripChars = offers.reduce((n, o) => n + o.label.length + 3, 0);
  const duration = Math.max(18, Math.round(stripChars * SECONDS_PER_CHAR));

  return (
    <div
      ref={barRef}
      className="promo-ticker relative border-b border-ink/[0.07] bg-base-800/70"
      data-open={active ? 'true' : 'false'}
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 sm:px-5">
        <div className="promo-ticker-viewport relative min-w-0 flex-1 overflow-hidden py-[7px]">
          <div className="promo-ticker-track" style={{ animationDuration: `${duration}s` }}>
            <OfferStrip offers={offers} activeId={activeId} onSelect={setActiveId} />
            <OfferStrip offers={offers} activeId={activeId} onSelect={setActiveId} duplicate />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            writeDismissed(signature);
            setDismissed(signature);
          }}
          aria-label="Hide offers"
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/35 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Detail panel — absolutely positioned so opening it never reflows the
          page. Width is capped so a long term stays readable on desktop. */}
      {active && (
        <div
          role="region"
          aria-label={`${active.title} — details`}
          className="absolute left-0 right-0 top-full z-30 px-3 sm:px-5"
        >
          <div className="mx-auto mt-1 max-w-[520px] rounded-[10px] border border-ink/[0.12] bg-display p-3.5 shadow-[0_18px_40px_-16px_rgba(26,23,20,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-holo">
                {active.title}
              </p>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                aria-label="Close details"
                className="-mr-2 -mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink/70">{active.detail}</p>
          </div>
        </div>
      )}

      <style>{`
        .promo-ticker-track {
          display: flex;
          width: max-content;
          animation-name: promoTickerDrift;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform;
        }
        /* Pause while the reader is engaged — hovering, tabbing through, or
           with a detail panel open. */
        .promo-ticker-viewport:hover .promo-ticker-track,
        .promo-ticker-viewport:focus-within .promo-ticker-track,
        .promo-ticker[data-open='true'] .promo-ticker-track {
          animation-play-state: paused;
        }
        @keyframes promoTickerDrift {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .promo-ticker-track {
            animation: none;
            width: 100%;
            flex-wrap: wrap;
          }
          /* The duplicate strip exists only to make the loop seamless; with no
             loop it is pure noise. */
          .promo-ticker-track > [data-duplicate='true'] { display: none; }
        }
      `}</style>
    </div>
  );
}

interface OfferStripProps {
  offers: ReadonlyArray<PromoOffer>;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  duplicate?: boolean;
}

/** One pass of the offer list. The duplicate copy is hidden from assistive
 *  tech and the tab order — it is a visual seam-filler, not content. */
function OfferStrip({ offers, activeId, onSelect, duplicate = false }: OfferStripProps) {
  return (
    <div
      className="flex shrink-0 items-center"
      data-duplicate={duplicate ? 'true' : undefined}
      aria-hidden={duplicate || undefined}
    >
      {offers.map((offer) => (
        <span key={offer.id} className="flex items-center whitespace-nowrap">
          <button
            type="button"
            tabIndex={duplicate ? -1 : undefined}
            onClick={() => onSelect(activeId === offer.id ? null : offer.id)}
            onMouseEnter={() => !duplicate && onSelect(offer.id)}
            onFocus={() => !duplicate && onSelect(offer.id)}
            aria-expanded={activeId === offer.id}
            className={`rounded-full px-1 py-1 font-mono text-[10.5px] uppercase tracking-[0.2em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 ${
              activeId === offer.id ? 'text-ink' : 'text-ink/60 hover:text-ink'
            }`}
          >
            {offer.label}
          </button>
          <span aria-hidden="true" className="px-3 text-[10px] text-holo/50">
            ·
          </span>
        </span>
      ))}
    </div>
  );
}
