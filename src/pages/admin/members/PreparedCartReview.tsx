/**
 * PreparedCartReview — the summary the owner reads before a cart is sent.
 *
 * THE COMPLAINT THIS ANSWERS, verbatim: "Why don't you just add an apply/redeem
 * coupon button at the end of my cart building? Once I press build a cart, it
 * should show the summary first instead of build-and-send. So I could see the
 * summary. That should activate and trigger all discounts to actually be put
 * on." Building and sending used to be ONE press, so the owner priced a real
 * client's cart while blind to two of the three discounts that reach it.
 *
 * NOTHING IS CREATED BY GETTING HERE. This screen is reached by a press that
 * does no I/O at all; `admin_create_prepared_cart` still runs from exactly one
 * place, "Send to member". "Back to edit" returns to the composer with every
 * field intact, because it never left React state.
 *
 * THE COUPON IS A CODE, NOT A NUMBER. It is named and never priced: only the
 * code travels with the cart (081), and validate_coupon re-resolves it
 * server-side at checkout. A percent or an amount computed here would be a
 * client-supplied price, which is the one thing this whole feature refuses to
 * send.
 *
 * THE REWARD IS SHOWN BUT NOT CHOSEN. `prepared_carts` has no column for a
 * chosen reward line (081), so a line picker here would be a promise the cart
 * cannot keep — the voucher lands on the highest-priced item at checkout
 * whatever this screen offered. It is stated as a fact rather than presented as
 * a control, and the copy says so in one line. (Picking a line IS possible at
 * conversion, where ConvertToOrderForm can persist the choice.)
 *
 * EVERY FIGURE IS A PREVIEW AND IS LABELLED ONE — see src/lib/preparedCartReview
 * .ts for the four ways the invoice can legitimately differ. Silent divergence
 * between this screen and the invoice is the only unacceptable outcome: the
 * point of the step is that the owner can trust the figure.
 */

import { Button } from '../../../components/ui/Button';
import { formatPriceExact } from '../../../lib/pricing';
import type { PreparedCartReviewTotals } from '../../../lib/preparedCartReview';
import type { MemberRow } from '../membersView';
import { RowAction } from './ui';

export interface PreparedCartReviewProps {
  member: MemberRow;
  review: PreparedCartReviewTotals;
  /** The percent of the member's active voucher; null when they hold none. */
  voucherPercent: number | null;
  /** True until the voucher read has come back. The total is not final while
   *  this is set, so sending is held rather than quoting a figure that is about
   *  to move under the owner. */
  voucherPending: boolean;
  /** As typed in the composer — echoed, never priced. */
  couponCode: string;
  note: string;
  busy: boolean;
  onSend: () => void;
  onBack: () => void;
}

/**
 * Every discount that reaches this cart, in one place — rendered BOTH while the
 * owner is still adding lines and on the review below it. One component rather
 * than two copies, because two "<name> pays" figures on the same panel that did
 * not agree would be worse than either of them being wrong on its own.
 */
export function PreparedCartTotals({
  member, review, voucherPercent,
}: Pick<PreparedCartReviewProps, 'member' | 'review' | 'voucherPercent'>) {
  const { pricing, reward } = review;

  return (
    <>
      <dl className="mt-[var(--space-3)] space-y-1 font-mono text-[11px] tabular-nums">
        <div className="flex justify-between text-ink/45">
          <dt>List</dt>
          <dd>{formatPriceExact(pricing.listTotalCents)}</dd>
        </div>
        <div className="flex justify-between text-ink/45">
          <dt>{member.discountLabel ?? `Account-holder ${member.effectivePercent}%`}</dt>
          <dd>−{formatPriceExact(review.accountCents)}</dd>
        </div>
        {reward && (
          <div className="flex justify-between text-ink/45">
            <dt>Reward credit · {voucherPercent}% off {reward.name}</dt>
            <dd>−{formatPriceExact(reward.cents)}</dd>
          </div>
        )}
        <div className="flex justify-between text-[12px] text-ink">
          <dt>{member.name.split(' ')[0]} pays</dt>
          <dd className="text-holo">{formatPriceExact(review.totalCents)}</dd>
        </div>
      </dl>
      {reward && (
        <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/40">
          The voucher always lands on the highest-priced item, and a prepared cart cannot carry a
          different choice — pick a line at conversion instead.
        </p>
      )}
    </>
  );
}

export function PreparedCartReview({
  member, review, voucherPercent, voucherPending, couponCode, note, busy, onSend, onBack,
}: PreparedCartReviewProps) {
  const { pricing } = review;
  const firstName = member.name.split(' ')[0];
  const coupon = couponCode.trim().toUpperCase();

  return (
    <div className="mt-[var(--space-3)] rounded-[12px] border border-ink/[0.08] bg-ink/[0.015] p-[var(--space-3)]">
      <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/40">
        Before this goes out
      </p>

      <ul>
        {pricing.lines.map((line) => (
          <li
            key={`${line.sku}|${line.dose}`}
            className="flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-0.5 border-b border-ink/[0.05] py-[var(--space-2)] last:border-b-0"
          >
            {/* basis-full below `sm`: on a 375px screen the compound owns its
                own line and the numbers fall underneath it. */}
            <span className="min-w-0 basis-full text-[12px] leading-[1.35] text-ink/80 sm:basis-auto sm:flex-1">
              {line.name}
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink/45">
              {line.quantity} × {formatPriceExact(line.memberUnitCents)}
            </span>
            <span className="font-mono text-[11.5px] tabular-nums text-ink/80">
              {formatPriceExact(line.memberLineCents)}
            </span>
          </li>
        ))}
      </ul>

      {pricing.unpriced.length > 0 && (
        <p role="alert" className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-[color:var(--color-status-warning)]">
          {pricing.unpriced.length} line(s) have left the catalog and will be dropped:{' '}
          {pricing.unpriced.map((l) => `${l.sku}${l.dose ? ` ${l.dose}` : ''}`).join(', ')}.
        </p>
      )}

      <div className="border-t border-ink/[0.06] pt-[var(--space-2)]">
        <PreparedCartTotals member={member} review={review} voucherPercent={voucherPercent} />
      </div>

      {coupon && (
        <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/40">
          Coupon <strong className="font-mono font-medium text-ink/65">{coupon}</strong> travels with the
          cart as a code only. Its value is resolved at checkout, so it is not in the total above.
        </p>
      )}

      {note.trim() && (
        <p className="mt-[var(--space-2)] whitespace-pre-wrap text-[11px] leading-[1.45] text-ink/55">
          <span className="text-ink/35">Note to {firstName}: </span>{note.trim()}
        </p>
      )}

      {/* The four honest caveats live in src/lib/preparedCartReview.ts; this is
          the short form the owner needs at the moment he presses send. */}
      <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/35">
        A preview, not a lock. Prices, the coupon and the reward credit all resolve again at checkout,
        and a wholesale pack, the paired bundle or a B2G1 promo replaces the account rate rather than
        stacking with it.
      </p>

      <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        <Button
          type="button" variant="primary" size="sm"
          disabled={busy || voucherPending || pricing.lines.length === 0}
          onClick={onSend}
        >
          {busy ? 'Working…' : 'Send to member'}
        </Button>
        <RowAction disabled={busy} onClick={onBack}>Back to edit</RowAction>
        {voucherPending && (
          <span className="text-[10.5px] text-ink/40">Checking {firstName}&rsquo;s reward voucher…</span>
        )}
      </div>
    </div>
  );
}
