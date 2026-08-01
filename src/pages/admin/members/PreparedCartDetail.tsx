/**
 * PreparedCartDetail — one built cart, opened.
 *
 * THE COMPLAINT THIS ANSWERS, verbatim: "I can't open it up and see the detail
 * of when I sent it and what's inside it. Kinda defeats the purpose." The
 * built-carts list could say a cart existed and nothing else, which is useless
 * at the one moment it matters — a member on the phone asking about an order the
 * owner put together for them three weeks ago.
 *
 * THE TOTAL IS THE COMPOSER'S TOTAL, BY CONSTRUCTION. It comes from the same
 * `priceLines(lines, index, member.effectivePercent)` call the composer makes,
 * with the same member percent off the same roster row. Recomputing it here any
 * other way would let the quote he sent and the figure he reads back drift, and
 * he would have no way of knowing which was wrong.
 *
 * PRICES ARE LIVE, NOT HISTORICAL. A prepared cart stores (sku, dose, quantity)
 * and no money at all (081) — deliberately, because place-order fails closed on
 * a client-supplied price. So this panel prices the stored list against TODAY's
 * catalog. It is what the member would pay now, which is also what they will
 * actually be charged; it is not an archive of what it cost when it was built,
 * and the footnote says so rather than letting the owner assume otherwise.
 *
 * NO TOKEN. The claim link is minted once and stored only as a SHA-256 digest,
 * so a cart from a previous session has no readable link and this component
 * cannot conjure one. It says that plainly instead of rendering a dead "copy"
 * affordance. The cart built in THIS session still has its plaintext in memory,
 * and that one is copyable.
 *
 * 375px FIRST. The owner runs admin on his phone. Every row here is a wrapping
 * flex line, never a table: the compound takes the full width and the numbers
 * fall underneath it, so nothing is clipped and nothing scrolls sideways.
 */

import { useMemo } from 'react';
import { formatPriceExact } from '../../../lib/pricing';
import { doseTierLabel, priceLines, type VariantIndex } from '../../../lib/preparedCart';
import {
  expiryNote, opensNote, stampLabel, type PreparedCartDelivery,
} from '../../../lib/preparedCartDetail';
import type { MemberRow } from '../membersView';
import { RowAction } from './ui';
import type { PreparedCartSummary } from './usePreparedCart';

/**
 * The status chip and the "→ ORDER-1042" link deliberately are NOT repeated
 * here: the summary row that opened this detail stays on screen directly above
 * it, and restating a verdict two inches below itself is how an owner ends up
 * reading a stale one.
 */
export interface PreparedCartDetailProps {
  cart: PreparedCartSummary;
  member: MemberRow;
  index: VariantIndex;
  /** The claim URL, ONLY for the cart built in this session — see the header. */
  claimUrl: string | null;
  onCopyLink: () => void;
  copied: boolean;
}

/** One label/value line. Wraps at 375px rather than truncating: every value
 *  here (a date, an address, an order number) is unreadable half-shown. */
function Fact({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-0.5 py-[3px]">
      <dt className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-ink/40">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-right font-mono text-[11px] tabular-nums text-ink/70">
        {children}
        {note && (
          <span className="mt-0.5 block text-left font-sans text-[10.5px] leading-[1.4] text-ink/40">{note}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * What the send ledger actually knows. Three answers, never two — `email_log`
 * records that a mail went out and nothing about why one did not, so "not on
 * record" is stated as the absence it is and the two ways it happens are named
 * rather than guessed between. See src/lib/preparedCartDetail.ts.
 */
function DeliveryFact({ delivery }: { delivery: PreparedCartDelivery }) {
  if (delivery.state === 'emailed') {
    return (
      <Fact label="Emailed">
        {stampLabel(delivery.at)}
        {delivery.to ? ` · ${delivery.to}` : ''}
      </Fact>
    );
  }
  if (delivery.state === 'unknown') {
    return (
      <Fact label="Emailed" note="The send history could not be read just now, so this is unknown — not a no.">
        <span className="text-ink/45">not known</span>
      </Fact>
    );
  }
  return (
    <Fact
      label="Emailed"
      note="No send is recorded for this cart. That is what an opted-out member and a failed delivery both look like — neither is stored separately."
    >
      <span className="text-[color:var(--color-status-warning)]">not on record</span>
    </Fact>
  );
}

export function PreparedCartDetail({
  cart, member, index, claimUrl, onCopyLink, copied,
}: PreparedCartDetailProps) {
  const pricing = useMemo(
    () => priceLines(cart.lines, index, member.effectivePercent),
    [cart.lines, index, member.effectivePercent],
  );
  // `new Date()` at render: expiry is a wall-clock fact, and a memoised "now"
  // would keep an open panel reporting a lapsed cart as live.
  const expiry = expiryNote(cart.expires_at, new Date());
  const opens = opensNote(cart);
  const firstName = member.name.split(' ')[0];

  return (
    <div className="mt-[var(--space-2)] rounded-[12px] border border-ink/[0.08] bg-ink/[0.015] p-[var(--space-3)]">
      {/* ── What is in it ────────────────────────────────────────────────── */}
      <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/40">In this cart</p>
      <ul>
        {pricing.lines.map((line) => {
          const tier = doseTierLabel(line.tier);
          return (
            <li
              key={`${line.sku}|${line.dose}`}
              className="flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-0.5 border-b border-ink/[0.05] py-[var(--space-2)] last:border-b-0"
            >
              {/* basis-full: on a 375px screen the compound owns its own line
                  and the two numbers sit underneath it, so neither is clipped. */}
              <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <span className="block text-[12px] leading-[1.35] text-ink/80">{line.name}</span>
                {tier && <span className="block text-[10px] leading-[1.35] text-ink/40">{tier}</span>}
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink/45">
                {line.quantity} × {formatPriceExact(line.memberUnitCents)}
              </span>
              <span className="font-mono text-[11.5px] tabular-nums text-ink/80">
                {formatPriceExact(line.memberLineCents)}
              </span>
            </li>
          );
        })}
      </ul>

      {pricing.unpriced.length > 0 && (
        <p role="alert" className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-[color:var(--color-status-warning)]">
          {pricing.unpriced.length} line(s) have left the catalog and cannot be priced:{' '}
          {pricing.unpriced.map((l) => `${l.sku}${l.dose ? ` ${l.dose}` : ''}`).join(', ')}. They are excluded from
          the total below.
        </p>
      )}

      {/* ── What it comes to, at HIS rate — the composer's own arithmetic ── */}
      <dl className="mt-[var(--space-3)] space-y-1 border-t border-ink/[0.06] pt-[var(--space-3)] font-mono text-[11px] tabular-nums">
        <div className="flex justify-between text-ink/45">
          <dt>List</dt>
          <dd>{formatPriceExact(pricing.listTotalCents)}</dd>
        </div>
        <div className="flex justify-between text-ink/45">
          <dt>{member.discountLabel ?? `Account-holder ${member.effectivePercent}%`}</dt>
          <dd>−{formatPriceExact(pricing.savingsCents)}</dd>
        </div>
        <div className="flex justify-between text-[12px] text-ink">
          <dt>{firstName} pays</dt>
          <dd className="text-holo">{formatPriceExact(pricing.memberTotalCents)}</dd>
        </div>
      </dl>
      <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/35">
        Priced against today&rsquo;s catalog at {firstName}&rsquo;s {member.effectivePercent}% rate — a prepared cart
        stores no money, so this is what they would pay now, not what it cost when it was built.
      </p>

      {/* ── When it was built, whether it went out, how long it has ──────── */}
      <dl className="mt-[var(--space-3)] divide-y divide-ink/[0.04] border-t border-ink/[0.06] pt-[var(--space-2)]">
        <Fact label="Built">{stampLabel(cart.created_at)}</Fact>
        <DeliveryFact delivery={cart.delivery} />
        <Fact label="Expiry">
          <span className={expiry.passed ? 'text-[color:var(--color-status-warning)]' : undefined}>
            {expiry.label}
          </span>
        </Fact>
        <Fact label="Opened">
          {opens ?? <span className="text-ink/40">never opened</span>}
        </Fact>
        {cart.coupon_code && <Fact label="Coupon">{cart.coupon_code}</Fact>}
        {cart.note && (
          <Fact label="Note to member">
            {/* Left-aligned against the right-aligned dd: a wrapped sentence
                ragged down its left edge is unreadable. */}
            <span className="block whitespace-pre-wrap text-left font-sans text-[11.5px] text-ink/70">
              {cart.note}
            </span>
          </Fact>
        )}
      </dl>

      {/* ── The link ─────────────────────────────────────────────────────── */}
      <div className="mt-[var(--space-3)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        {claimUrl ? (
          <>
            <p className="mb-[var(--space-2)] break-all font-mono text-[10.5px] text-ink/60">{claimUrl}</p>
            <RowAction onClick={onCopyLink}>{copied ? 'Copied' : 'Copy link'}</RowAction>
          </>
        ) : (
          <p className="text-[10.5px] leading-[1.45] text-ink/40">
            The claim link was shown once when this cart was built and only its hash is stored, so it cannot be
            read back. If {firstName} needs it again, build a new cart.
          </p>
        )}
      </div>
    </div>
  );
}
