/**
 * PreparedCartPanel — a member's prepared carts, inside the expanded roster row.
 *
 * WHAT YOU HAVE ALREADY SENT COMES FIRST. This panel used to be a composer with
 * a list nailed to the bottom of it, reachable only by opening a form headed
 * "build a new cart" — so the owner had to start building one to find out what
 * he had already sent. His words: "To access the stuff that I built a cart, I
 * have to press Build a cart, which then I see a list of the ones I see."
 * The carts are now the panel; the composer is one explicit action below them,
 * open by default only when there is nothing else to show.
 *
 * AND EACH ONE OPENS. A row that can say a cart exists but not what is in it or
 * when it went out is no use at the only moment it is read — a member on the
 * phone about an order. Tapping a row expands PreparedCartDetail in place:
 * lines, the total at this member's rate, delivery, expiry, opens, coupon, note
 * and the order it became.
 *
 * The owner picks compounds and doses the same way the `+ New order` screen
 * does — TWO DEPENDENT DROPDOWNS, compound then dose, never a typed SKU — adds
 * a quantity, optionally attaches a one-off coupon code, and builds the cart.
 * The enumeration and all the money math are pure and live in
 * src/lib/preparedCart.ts; this file is the house-style shell around them.
 *
 * WHAT THE OWNER SEES IS WHAT THE MEMBER PAYS. Every price shown is
 * `effectiveTierPriceCents` (an admin per-dose override wins over the
 * placeholder formula) reduced by THIS member's own effective rate, which the
 * roster row already carries from `effective_customer_discount` — the same
 * function place-order calls at checkout. No extra read, no second opinion.
 *
 * NO PRICE IS EVER SENT. There is deliberately no unit-price input: place-order
 * fails closed on a client-supplied price, so a bespoke number would make the
 * order unplaceable rather than cheaper. A negotiated price travels as a coupon
 * CODE, which the server re-prices at checkout.
 *
 * HE READS THE SUMMARY FIRST. Composing used to build and send in one press,
 * which left him pricing a real client's cart blind to two of the three
 * discounts that reach it — the one-off coupon and the member's reward voucher.
 * Submitting the composer now opens PreparedCartReview and creates NOTHING; the
 * cart is built only from "Send to member" there, and "Back to edit" returns
 * here with every field intact because they never left this component's state.
 *
 * BUILD AND SEND ARE STILL ONE ACTION, because the link token exists for exactly
 * one moment: admin_create_prepared_cart returns the plaintext once and stores
 * only its digest, so a cart whose token was not mailed there and then can never
 * be mailed at all — only rebuilt. The delivery outcome is reported LITERALLY (see
 * DeliveryNote): sent, already sent, suppressed because the member opted out of
 * marketing, or failed. A failed send says so and the copyable link stays on
 * screen, because "the client was emailed" is the one thing this panel must
 * never claim falsely.
 *
 * CONVERTING IS THE OTHER HALF, and it inverts the price rule above. A prepared
 * cart only becomes an order if the MEMBER checks out; when they pay the owner
 * directly instead and never do, no order exists at all — the bug this panel
 * shipped with, found after a real client had already paid. "Convert to order"
 * (ConvertToOrderForm) creates that order from the cart, through
 * admin_create_order rather than place-order, which is why prices ARE editable
 * there: that RPC has always recorded a hand-typed price, and the money has
 * already been collected off-site. Converting revokes the link in the same
 * transaction, so a cart cannot become an order and then also be claimed.
 *
 * Confirmation uses ConfirmModal, never window.confirm — iOS silently
 * suppresses native dialogs once "Block Alerts" is tapped, which makes a
 * confirmed admin action look like it did nothing.
 *
 * The roster layout is otherwise untouched: this is a Panel rendered inside the
 * already-expanded row, from the same atoms every other Members sub-view uses.
 * No new page, no nav entry.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfirmFn } from '../../../components/admin/accountPanels';
import { Button } from '../../../components/ui/Button';
import { FIELD_DEFAULT, FIELD_LABEL_DENSE, FIELD_SURFACE_DENSE } from '../../../components/ui/Field';
import { formatPriceExact } from '../../../lib/pricing';
import {
  compoundTierLabel, doseTierLabel, doseTierShort, findVariantOption, priceLines, variantOptionKey,
  type PreparedCartLine, type VariantIndex,
} from '../../../lib/preparedCart';
import { opensNote, stampLabel } from '../../../lib/preparedCartDetail';
import { reviewPreparedCart } from '../../../lib/preparedCartReview';
import type { MemberRow } from '../membersView';
import { Chip, Panel, RowAction } from './ui';
import { ConvertToOrderForm } from './ConvertToOrderForm';
import { PreparedCartDetail } from './PreparedCartDetail';
import { PreparedCartReview, PreparedCartTotals } from './PreparedCartReview';
import { loadActiveVoucher } from './useConvertPreparedCart';
import {
  CATALOG, preparedCartClaimUrl, usePreparedCart, useVariantIndex,
  type CreatedPreparedCart, type PreparedCartStatus, type PreparedCartSummary, type SendResult,
} from './usePreparedCart';

const fieldCls = `${FIELD_SURFACE_DENSE} ${FIELD_DEFAULT}`;

// Status answers ONE question — will this link still work? — so there are three
// states, not four. "Opened" is not a status: 082 made the link re-openable
// (the member's cart is device-local, so opening on a phone and buying on a
// laptop must both work), and a chip reading "claimed" would tell the owner a
// live link was spent. Opens are a COUNT, rendered beside the chip.
// 'converted' is the fourth: not a failure and not merely revoked — the cart
// became a real order, which is the one outcome the owner most needs to see.
const STATUS_TONE: Record<PreparedCartStatus, 'good' | 'warn' | 'neutral' | 'info'> = {
  live: 'good',
  expired: 'neutral',
  revoked: 'warn',
  converted: 'info',
};

/** A composer row. `compound` drives the dose list; `optionKey` is the picked
 *  dose's "<sku>|<dose>" identity — the SKU is never typed or parsed. */
interface DraftRow {
  key: string;
  compound: string;
  optionKey: string;
  quantity: string;
}

const emptyRow = (key: string): DraftRow => ({ key, compound: '', optionKey: '', quantity: '1' });

/** The rows that resolve to a real, priced (sku, dose, quantity). */
function draftLines(rows: DraftRow[], index: VariantIndex): PreparedCartLine[] {
  const lines: PreparedCartLine[] = [];
  for (const row of rows) {
    const option = findVariantOption(index, row.optionKey);
    const quantity = parseInt(row.quantity, 10);
    if (!option || !Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({ sku: option.sku, dose: option.dose, quantity });
  }
  return lines;
}

/**
 * What actually happened to the email, in words.
 *
 * Every branch is a DIFFERENT sentence with a different next step, because
 * collapsing them would mislead in the two cases that matter: an opted-out
 * member was never contacted (and the owner must use another channel), and a
 * failed send was never contacted either (and the owner must hand the link over
 * or rebuild). `null` is the in-flight state and says "Sending…" — it is never
 * rendered as nothing, which would read as success.
 */
function DeliveryNote({ delivery, member }: { delivery: SendResult | null; member: string }) {
  const base = 'mt-[var(--space-2)] text-[10.5px] leading-[1.45]';
  const first = member.split(' ')[0];

  if (delivery === null) {
    return <p className={`${base} text-ink/40`}>Sending the email…</p>;
  }
  if (delivery.status === 'sent') {
    return <p className={`${base} text-ink/55`}>Emailed to {delivery.recipient}.</p>;
  }
  if (delivery.status === 'already_sent') {
    return (
      <p className={`${base} text-ink/55`}>
        Already emailed{delivery.recipient ? ` to ${delivery.recipient}` : ''} — not sent twice. Use the
        link above if {first} needs it again.
      </p>
    );
  }
  if (delivery.status === 'opted_out') {
    return (
      <p role="alert" className={`${base} text-[color:var(--color-status-warning)]`}>
        <strong className="font-medium">Not emailed.</strong> {first} has opted out of marketing email,
        so nothing was sent. The cart is built — send the link above by a channel they agreed to.
      </p>
    );
  }
  return (
    <p role="alert" className={`${base} text-red-400`}>
      <strong className="font-medium">The email did not go out.</strong> {delivery.detail} The cart is
      built and the link above works — send it yourself, or revoke and rebuild.
    </p>
  );
}

export function PreparedCartPanel({ member, confirm }: { member: MemberRow; confirm: ConfirmFn }) {
  const index = useVariantIndex();
  const { carts, loading, busy, error, unmigrated, create, revoke, send, reload } = usePreparedCart(member.userId);

  const [rows, setRows] = useState<DraftRow[]>([emptyRow('r0')]);
  const [couponCode, setCouponCode] = useState('');
  const [note, setNote] = useState('');
  const [built, setBuilt] = useState<CreatedPreparedCart | null>(null);
  const [copied, setCopied] = useState(false);
  // The cart whose "Convert to order" composer is open. One at a time — two open
  // composers over one payment is exactly the confusion this feature exists to
  // end.
  const [convertingId, setConvertingId] = useState<string | null>(null);
  // The cart whose detail is expanded. One at a time, like the roster row this
  // panel lives inside — two open carts on a 375px screen is a scroll, not a
  // comparison.
  const [openCartId, setOpenCartId] = useState<string | null>(null);
  // null while the send is in flight — rendered as "Sending…", never as a
  // silent gap that could be mistaken for "done".
  const [delivery, setDelivery] = useState<SendResult | null>(null);
  // `null` = the owner has not said either way, so the data decides: a member
  // with no carts has nothing to read and the empty state IS the build form,
  // while a member who has carts gets to see them first. Once he touches the
  // toggle his choice sticks.
  const [composerOpen, setComposerOpen] = useState<boolean | null>(null);
  // The composer's second screen. Purely local: entering it does no I/O, and
  // leaving it keeps every field because none of them live in the review.
  const [reviewing, setReviewing] = useState(false);
  // The member's active voucher, from the loader ConvertToOrderForm already
  // uses — one query shape for the whole Members surface. `loaded` is tracked
  // separately because "no voucher" and "not read yet" must not both render as
  // a total with no reward line in it.
  const [voucher, setVoucher] = useState<{ id: string; percent: number } | null>(null);
  const [voucherLoaded, setVoucherLoaded] = useState(false);
  // Gated on `loading` so the composer never flashes open and then collapses
  // under a member who does have carts.
  const showComposer = composerOpen ?? (!loading && carts.length === 0);

  useEffect(() => {
    let cancelled = false;
    loadActiveVoucher(member.userId).then((v) => {
      if (cancelled) return;
      setVoucher(v);
      setVoucherLoaded(true);
    });
    return () => { cancelled = true; };
  }, [member.userId]);

  const lines = useMemo(() => draftLines(rows, index), [rows, index]);
  // ONE call, feeding both screens: the editor's per-unit prices and the
  // review's total come from the same `priceLines` result, so the number the
  // owner reads while building cannot drift from the one he sends.
  const review = useMemo(
    () => reviewPreparedCart({
      lines,
      index,
      products: CATALOG,
      accountPercent: member.effectivePercent,
      voucherPercent: voucher?.percent ?? null,
    }),
    [lines, index, member.effectivePercent, voucher],
  );
  const pricing = review.pricing;
  // Every listed cart's total, at THIS member's rate, from the same `priceLines`
  // the composer quotes with — so a cart summarised in the list, opened in the
  // detail and re-quoted in the composer can only ever show one number.
  const cartTotals = useMemo(
    () => new Map(carts.map((c) => [c.id, priceLines(c.lines, index, member.effectivePercent).memberTotalCents])),
    [carts, index, member.effectivePercent],
  );

  function update(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function pickCompound(key: string, compound: string) {
    // Changing the compound invalidates the dose — never leave a stale pairing.
    update(key, { compound, optionKey: '' });
  }

  async function build() {
    // The same total the review screen states, including the reward credit —
    // a confirmation that quoted a different figure two inches below the one
    // he just read is worse than no confirmation at all.
    const ok = await confirm(
      `Build a prepared cart for ${member.name} and email them the link — ` +
        `${lines.length} line${lines.length === 1 ? '' : 's'}, ` +
        `${formatPriceExact(review.totalCents)} at their ${member.effectivePercent}% rate` +
        `${review.reward ? ` · ${voucher?.percent}% reward credit on ${review.reward.name}` : ''}` +
        `${couponCode.trim() ? ` · coupon ${couponCode.trim().toUpperCase()}` : ''}. ` +
        'The link is valid for 14 days and can be revoked at any time.',
      { confirmLabel: 'Build & send' },
    );
    if (!ok) return;

    const result = await create({
      lines,
      couponCode: couponCode.trim() || null,
      note: note.trim() || null,
    });
    if (!result) return;
    setBuilt(result);
    setCopied(false);
    setDelivery(null);
    // Pin the composer open: the reload that follows makes `carts` non-empty,
    // and a derived-open composer would collapse — taking the once-shown link
    // and the delivery report down with it at the exact moment they matter.
    setComposerOpen(true);
    // Back to an empty form, with the once-shown link below it. Staying on the
    // review of a cart that has already gone out would invite a second send.
    setReviewing(false);
    setRows([emptyRow(`r${Date.now()}`)]);
    setCouponCode('');
    setNote('');

    // The ONLY moment the mail can be composed: `result.token` is the plaintext
    // and it is never readable again. `send` reports rather than throws, so the
    // link box below survives a failed send — which is exactly when the owner
    // needs it.
    setDelivery(await send(result));
  }

  async function killCart(cart: PreparedCartSummary) {
    const ok = await confirm(
      `Revoke this prepared cart? The link stops working immediately. Built ${stampLabel(cart.created_at)}.`,
      { confirmLabel: 'Revoke' },
    );
    if (ok) await revoke(cart.id);
  }

  // The calm "not migrated" note NAMES THE UNDERLYING FAILURE. PGRST202 means
  // both "081 was never applied" and "081 was applied a minute ago and
  // PostgREST's schema cache is still stale" — showing only the placeholder
  // made the second case a dead end with nothing to act on.
  if (unmigrated) {
    return (
      <Panel caption="Prepared cart">
        <p className="text-[12px] text-ink/40">
          Prepared-cart data layer not migrated yet — apply migration 081 to enable this. If 081 was
          just applied, PostgREST&rsquo;s schema cache is still stale; reload in a moment.
        </p>
        {error && <p role="alert" className="mt-[var(--space-2)] font-mono text-[10.5px] text-ink/50">{error}</p>}
      </Panel>
    );
  }

  return (
    <Panel caption="Prepared cart">
      {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

      {/* ── What he has already sent. FIRST, and each one opens ───────────── */}
      <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/40">Built carts</p>
      {loading ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : carts.length === 0 ? (
        <p className="text-[12px] text-ink/40">
          Nothing built for {member.name.split(' ')[0]} yet — put one together below.
        </p>
      ) : (
        <ul className="divide-y divide-ink/[0.04]">
          {carts.map((cart) => {
            const open = openCartId === cart.id;
            const opens = opensNote(cart);
            return (
              <li key={cart.id} className="py-[var(--space-2)]">
                <div className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)]">
                  {/* basis-full below `sm`: on a phone the summary owns its own
                      line and the actions wrap underneath at full tap size,
                      instead of being squeezed into a 60px column. */}
                  <button
                    type="button"
                    onClick={() => setOpenCartId(open ? null : cart.id)}
                    aria-expanded={open}
                    className="flex min-w-0 basis-full items-center gap-[var(--space-2)] text-left transition-colors hover:text-ink sm:flex-1 sm:basis-auto"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink/75">
                        <Chip tone={STATUS_TONE[cart.status]}>{cart.status}</Chip>
                        <span>{cart.lines.length} line{cart.lines.length === 1 ? '' : 's'}</span>
                        <span className="font-mono tabular-nums text-holo">
                          {formatPriceExact(cartTotals.get(cart.id) ?? 0)}
                        </span>
                        {opens && <span className="text-[10.5px] text-ink/45">{opens}</span>}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-ink/40">
                        {cart.lines.map((l) => `${l.sku}${l.dose ? ` ${l.dose}` : ''} ×${l.quantity}`).join(' · ')}
                      </span>
                      {/* stampLabel, not shortDate: created_at is a timestamptz
                          and shortDate renders one as the literal "Invalid
                          Date" — the one field the owner asked for by name. */}
                      <span className="block font-mono text-[10px] tabular-nums text-ink/35">
                        Built {stampLabel(cart.created_at)}
                      </span>
                    </span>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                      className={`shrink-0 text-ink/30 transition-transform ${open ? 'rotate-90' : ''}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {/* The order it became, named and linked. A converted cart
                      whose order the owner cannot reach is the same lost order
                      this feature exists to prevent. Outside the toggle button:
                      a link nested in a button is not operable either way. */}
                  {cart.converted_order_number && (
                    <Link
                      to={`/admin/orders/${cart.converted_order_id}`}
                      className="shrink-0 font-mono text-[10.5px] text-holo underline underline-offset-2"
                    >
                      → {cart.converted_order_number}
                    </Link>
                  )}
                  {/* Offered for every cart that is not already an order —
                      INCLUDING expired and revoked ones. The member paying
                      off-site is precisely why the link went unused, and
                      refusing to convert a lapsed cart would leave the owner
                      retyping the order he already built. */}
                  {cart.status !== 'converted' ? (
                    <RowAction
                      disabled={busy}
                      onClick={() => setConvertingId((id) => (id === cart.id ? null : cart.id))}
                    >
                      {convertingId === cart.id ? 'Close' : 'Convert to order'}
                    </RowAction>
                  ) : null}
                  {cart.status === 'live' ? (
                    <RowAction danger disabled={busy} onClick={() => killCart(cart)}>Revoke</RowAction>
                  ) : null}
                </div>

                {open && (
                  <PreparedCartDetail
                    cart={cart}
                    member={member}
                    index={index}
                    // Only the cart built in THIS session has a readable token
                    // — every other one stores nothing but its digest.
                    claimUrl={
                      built && built.cart_id === cart.id
                        ? preparedCartClaimUrl(built.token, window.location.origin)
                        : null
                    }
                    copied={copied}
                    onCopyLink={() => {
                      if (!built) return;
                      void navigator.clipboard?.writeText(preparedCartClaimUrl(built.token, window.location.origin));
                      setCopied(true);
                    }}
                  />
                )}

                {convertingId === cart.id && (
                  <ConvertToOrderForm
                    cart={cart}
                    member={member}
                    index={index}
                    confirm={confirm}
                    onConverted={reload}
                    onCancel={() => setConvertingId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Building a new one is an ACTION, not the way in ───────────────── */}
      <div className="mt-[var(--space-4)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <RowAction onClick={() => { setComposerOpen(!showComposer); setReviewing(false); }}>
          {showComposer ? 'Close builder' : '+ Build a new cart'}
        </RowAction>
      </div>

      {showComposer && (
      <>
      {reviewing ? (
        <PreparedCartReview
          member={member}
          review={review}
          voucherPercent={voucher?.percent ?? null}
          voucherPending={!voucherLoaded}
          couponCode={couponCode}
          note={note}
          busy={busy}
          onSend={build}
          onBack={() => setReviewing(false)}
        />
      ) : (
      <>
      {/* ── Line editor: compound → dose → qty ─────────────────────────────── */}
      <div className="mt-[var(--space-3)] space-y-[var(--space-2)]">
        {rows.map((row) => {
          const doseOptions = index.byCompound.get(row.compound) ?? [];
          const picked = findVariantOption(index, row.optionKey);
          const memberUnit = picked
            ? pricing.lines.find((l) => l.sku === picked.sku && l.dose === picked.dose)?.memberUnitCents ?? null
            : null;
          return (
            <div key={row.key} className="border-b border-ink/[0.05] pb-[var(--space-2)] last:border-b-0 last:pb-0">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                <label className="block">
                  <span className={FIELD_LABEL_DENSE}>Compound</span>
                  <select
                    value={row.compound}
                    onChange={(e) => pickCompound(row.key, e.target.value)}
                    className={fieldCls}
                  >
                    <option value="">— Select compound —</option>
                    {index.compoundNames.map((c) => {
                      // Only ever "all X" when every dose agrees; otherwise
                      // "mixed tiers" — the dose dropdown carries the truth.
                      const summary = compoundTierLabel(index.byCompound.get(c) ?? []);
                      return <option key={c} value={c}>{summary ? `${c} · ${summary}` : c}</option>;
                    })}
                  </select>
                </label>
                <label className="block">
                  <span className={FIELD_LABEL_DENSE}>Dose / size</span>
                  <select
                    value={row.optionKey}
                    onChange={(e) => update(row.key, { optionKey: e.target.value })}
                    disabled={!row.compound}
                    className={`${fieldCls} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <option value="">{row.compound ? '— Select dose —' : '— Pick compound first —'}</option>
                    {doseOptions.map((o) => {
                      // The tier is per (sku, dose) and changes both the price
                      // and whether B2G1 can ever apply — the admin must not
                      // have to guess which one they are picking.
                      const tier = doseTierLabel(o.tier);
                      return (
                        <option key={variantOptionKey(o)} value={variantOptionKey(o)}>
                          {`${o.dose || o.name} · ${formatPriceExact(o.priceCents)}${tier ? ` · ${tier}` : ''}`}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>

              <div className="mt-1.5 flex items-end justify-between gap-[var(--space-2)]">
                {/* The tier stays on the row after selection — re-opening the
                    dropdown to check what was picked is the bug this fixes. */}
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {picked && doseTierShort(picked.tier) ? (
                    <Chip tone={picked.tier === 'in_stock' ? 'good' : 'neutral'}>{doseTierShort(picked.tier)}</Chip>
                  ) : null}
                  <span className="min-w-0 font-mono text-[10px] tabular-nums text-ink/45">
                    {picked && memberUnit != null ? (
                      <>
                        <span className="line-through text-ink/25">{formatPriceExact(picked.priceCents)}</span>
                        {' → '}
                        <span className="text-holo">{formatPriceExact(memberUnit)}</span>
                        <span className="text-ink/30"> / unit</span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-end gap-[var(--space-2)]">
                  <label className="block w-[64px]">
                    <span className={FIELD_LABEL_DENSE}>Qty</span>
                    <input
                      type="number" min="1" max="9999" inputMode="numeric"
                      value={row.quantity}
                      onChange={(e) => update(row.key, { quantity: e.target.value })}
                      className={`${fieldCls} text-right`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== row.key) : rs))}
                    disabled={rows.length === 1}
                    aria-label="Remove line"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/30 text-red-400/75 transition-colors hover:border-red-400/55 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
          );
        })}

        <RowAction onClick={() => setRows((rs) => [...rs, emptyRow(`r${Date.now()}-${rs.length}`)])}>
          + Add line
        </RowAction>
      </div>

      {/* ── Coupon + note ──────────────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)] space-y-[var(--space-2)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>One-off coupon code (optional)</span>
          <input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            placeholder="e.g. SPRING20"
            autoComplete="off"
            className={`${fieldCls} font-mono uppercase`}
          />
          <span className="mt-1 block text-[10.5px] leading-[1.4] text-ink/40">
            Only for a bespoke price on THIS cart. {member.name.split(' ')[0]}&rsquo;s standing{' '}
            {member.effectivePercent}% account discount is automatic and needs nothing here.
          </span>
        </label>
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>Note to the member (optional)</span>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why you put this together"
            className={`${fieldCls} resize-y`}
          />
        </label>
      </div>

      {/* ── Totals at the member's own rate ────────────────────────────────── */}
      {/* The SAME component the review renders, so the running total he watches
          while adding lines and the one he sends cannot be two numbers. */}
      {pricing.lines.length > 0 && (
        <PreparedCartTotals member={member} review={review} voucherPercent={voucher?.percent ?? null} />
      )}
      <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/35">
        Prices resolve live when the member opens the cart and again at checkout — nothing is locked
        in. Wholesale packs, the paired bundle and a B2G1 promo all replace the account discount
        rather than stacking with it. B2G1 reaches <strong className="font-medium text-ink/50">Sourced
        lines only</strong> — a 24 Hour line never earns a free third unit.
      </p>

      <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        {/* Creates NOTHING. The cart is built from the review screen only. */}
        <Button
          type="button" variant="primary" size="sm"
          disabled={lines.length === 0 || busy}
          onClick={() => setReviewing(true)}
        >
          Review cart
        </Button>
        {pricing.unpriced.length > 0 && (
          <span className="text-[10.5px] text-[color:var(--color-status-warning)]">
            {pricing.unpriced.length} line(s) left the catalog and will be dropped.
          </span>
        )}
      </div>
      </>
      )}

      {/* ── The link, shown once ───────────────────────────────────────────── */}
      {built && (
        <div className="mt-[var(--space-4)] rounded-[12px] border border-holo/25 bg-holo/[0.04] p-[var(--space-3)]">
          <p className="mb-1.5 text-[11px] text-ink">
            Cart built. This link is shown <strong>once</strong> — only its hash is stored, so it
            cannot be read back.
          </p>
          <p className="mb-[var(--space-2)] break-all font-mono text-[10.5px] text-ink/60">
            {preparedCartClaimUrl(built.token, window.location.origin)}
          </p>
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <RowAction
              onClick={() => {
                void navigator.clipboard?.writeText(preparedCartClaimUrl(built.token, window.location.origin));
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </RowAction>
            <span className="text-[10.5px] text-ink/40">Expires {stampLabel(built.expires_at)}.</span>
          </div>
          <DeliveryNote delivery={delivery} member={member.name} />
        </div>
      )}

      </>
      )}
    </Panel>
  );
}
