/**
 * MemberOfferCard — the "shiny" limited-time member offer promo
 * (src/config/memberOffers.ts). Shown on Benefits (top of page, always when
 * offers exist) and compact on the Overview dashboard when the customer has
 * no per-customer `customer_discounts`.
 *
 * Premium foil/gloss treatment, not neon: a `.floating-module` base with a
 * gold-tinted radial wash + the standard inset top highlight + a lifted
 * elevation. Gold is used sparingly — the percent, the top hairline, and the
 * code chip only.
 */

import type { MemberOffer } from '../../config/memberOffers';

interface MemberOfferCardProps {
  offer: MemberOffer;
  compact?: boolean;
}

/** Splits a leading "NN% " off the headline so the percent can carry the gold accent. */
function splitPercent(headline: string): { percent: string | null; rest: string } {
  const match = headline.match(/^(\d+%)\s*(.*)$/);
  if (!match) return { percent: null, rest: headline };
  return { percent: match[1], rest: match[2] };
}

export function MemberOfferCard({ offer, compact }: MemberOfferCardProps) {
  const { percent, rest } = splitPercent(offer.headline);

  return (
    <article
      className={`floating-module relative overflow-hidden ${compact ? 'p-[var(--space-5)]' : 'p-[var(--space-6)]'}`}
      style={{ boxShadow: 'var(--surface-highlight-strong), var(--elev-2)' }}
    >
      {/* Gold-tinted gloss wash — tasteful foil, not neon/glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 100% at 100% 0%, rgb(var(--c-gold) / 0.14) 0%, transparent 55%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
      />

      <div className="relative">
        <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.24em] text-gold-dark/80">
          {offer.expiresLabel}
        </p>
        <p className={`font-light leading-snug text-ink ${compact ? 'text-[1.1rem]' : 'text-[1.4rem]'}`}>
          {percent && <span className="font-medium text-gold-dark">{percent}</span>}
          {percent ? ' ' : ''}
          {rest}
        </p>
        {!compact && (
          <p className="mt-[var(--space-2)] text-[12.5px] leading-relaxed text-ink/60">{offer.detail}</p>
        )}
        <div className="mt-[var(--space-3)] inline-flex items-center gap-[var(--space-2)] rounded-full border border-gold/30 bg-gold/[0.08] px-[var(--space-3)] py-[var(--space-1)]">
          <span className="text-[10px] uppercase tracking-[0.16em] text-ink/50">Use code</span>
          <span className="font-mono text-[12px] tracking-[0.04em] text-gold-dark">{offer.code}</span>
        </div>
      </div>
    </article>
  );
}

export default MemberOfferCard;
