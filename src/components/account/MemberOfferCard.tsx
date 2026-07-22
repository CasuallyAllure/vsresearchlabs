/**
 * MemberOfferCard — the account-holder pricing term card
 * (src/config/memberOffers.ts). Shown on Benefits (top of page, always when
 * offers exist) and compact on the Overview dashboard when the customer has
 * no per-customer `customer_discounts`.
 *
 * Presented as a term of the account, not an offer: a `.floating-module`
 * base, a quiet header rule, the percentage set as a tabular mono figure,
 * and the code stated on a hairline row. No foil wash, no accent pill, no
 * urgency — the term is a fact about the account, so it reads as one.
 */

import type { MemberOffer } from '../../config/memberOffers';

interface MemberOfferCardProps {
  offer: MemberOffer;
  compact?: boolean;
}

/** Splits a leading "NN% " off the headline so the figure can be set tabular. */
function splitPercent(headline: string): { percent: string | null; rest: string } {
  const match = headline.match(/^(\d+%)\s*(.*)$/);
  if (!match) return { percent: null, rest: headline };
  return { percent: match[1], rest: match[2] };
}

export function MemberOfferCard({ offer, compact }: MemberOfferCardProps) {
  const { percent, rest } = splitPercent(offer.headline);

  return (
    <article className={`floating-module ${compact ? 'p-[var(--space-5)]' : 'p-[var(--space-6)]'}`}>
      <div className="flex items-baseline justify-between gap-[var(--space-3)] border-b border-ink/[0.09] pb-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-ink/45">Pricing term</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/30">{offer.expiresLabel}</p>
      </div>

      <div className="flex items-baseline justify-between gap-[var(--space-4)] pt-[var(--space-4)]">
        <p className={`leading-snug text-ink/80 ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
          {percent ? rest : offer.headline}
        </p>
        {percent && (
          <p
            className={`shrink-0 font-mono font-light tabular-nums text-ink ${
              compact ? 'text-[1.35rem]' : 'text-[1.7rem]'
            }`}
          >
            {percent}
          </p>
        )}
      </div>

      {!compact && (
        <p className="mt-[var(--space-2)] text-[12.5px] leading-relaxed text-ink/55">{offer.detail}</p>
      )}

      <div className="mt-[var(--space-4)] flex items-baseline justify-between gap-[var(--space-3)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/40">Applied</span>
        <span className="font-mono text-[12px] tracking-[0.06em] text-ink/75">Automatically at checkout</span>
      </div>
    </article>
  );
}

export default MemberOfferCard;
