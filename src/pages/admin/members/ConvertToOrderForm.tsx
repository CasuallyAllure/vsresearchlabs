/**
 * ConvertToOrderForm — push a prepared cart through into a real order.
 *
 * The gap this closes: a prepared cart only becomes an order if the MEMBER
 * checks out. When they pay the owner directly instead (Zelle, off-site), no
 * order exists — nothing to fulfil, invoice or mark paid. This composer lets the
 * owner create that order himself, from the cart he already built.
 *
 * PRE-FILLED, NEVER RETYPED. Buyer identity comes off the roster row the panel
 * is already rendering (`MemberRow`) — no second PII read. The lines come off
 * the cart. The discount opens at the member's own standing rate, resolved the
 * same way the rest of the panel resolves it (`effectivePercent`, which the row
 * carries from `effective_customer_discount`).
 *
 * EDITABLE, BECAUSE THE MONEY IS ALREADY COLLECTED. Unlike the build composer —
 * where a bespoke price would make the order UNPLACEABLE, since place-order
 * fails closed on any client-supplied price — this path goes through
 * `admin_create_order`, the admin RPC that has always taken a hand-typed unit
 * price. The owner may have agreed a different number off-site, so he edits the
 * per-line prices and the discount, and what he sets is what the order records.
 *
 * THE TOTAL IS THE POINT. It is rendered large and live, and repeated verbatim
 * in the confirmation, because the owner is reconciling it against a payment he
 * has already received. All three figures come from one `convertTotals` call,
 * so the screen, the dialog and the order cannot disagree.
 *
 * Confirmation is ConfirmModal via `confirm`, never window.confirm — iOS
 * silently suppresses native dialogs once "Block Alerts" is tapped, which would
 * make a confirmed order look like it did nothing.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfirmFn } from '../../../components/admin/accountPanels';
import { Button } from '../../../components/ui/Button';
import { FIELD_DEFAULT, FIELD_LABEL_DENSE, FIELD_SURFACE_DENSE } from '../../../components/ui/Field';
import { formatPriceExact } from '../../../lib/pricing';
import type { VariantIndex } from '../../../lib/preparedCart';
import {
  ADMIN_DISCOUNT_CODE, convertConfirmMessage, convertTotals, parsePercentInput,
  parseQuantityInput, parseUsdToCents, prefillConvertLines, prefillDiscount,
  type ConvertLine, type DiscountDraft, type DiscountKind,
} from '../../../lib/convertPreparedCart';
import type { MemberRow } from '../membersView';
import { RowAction } from './ui';
import { useConvertPreparedCart, type ConvertResult } from './useConvertPreparedCart';
import type { PreparedCartSummary } from './usePreparedCart';

const fieldCls = `${FIELD_SURFACE_DENSE} ${FIELD_DEFAULT}`;

/** A line as the owner is editing it. Text, not numbers: a half-typed "1." is a
 *  legitimate keystroke, and coercing it to a number mid-edit fights the field. */
interface LineDraft {
  key: string;
  sku: string;
  dose: string;
  name: string;
  quantityText: string;
  unitUsdText: string;
}

const usd = (cents: number): string => (cents / 100).toFixed(2);

function toDrafts(lines: ConvertLine[]): LineDraft[] {
  return lines.map((l, i) => ({
    key: `${l.sku}|${l.dose}|${i}`,
    sku: l.sku,
    dose: l.dose,
    name: l.name,
    quantityText: String(l.quantity),
    unitUsdText: usd(l.unitPriceCents),
  }));
}

/** Parse a draft row. Null when either field is not a usable number — reported
 *  to the owner and blocking, never coerced into a price on a paid order. */
function resolveDraft(draft: LineDraft): ConvertLine | null {
  const quantity = parseQuantityInput(draft.quantityText);
  const unitPriceCents = parseUsdToCents(draft.unitUsdText);
  if (quantity == null || unitPriceCents == null) return null;
  return { sku: draft.sku, dose: draft.dose, name: draft.name, quantity, unitPriceCents };
}

/** What happened, in words. Success keeps the order number ON SCREEN with a link
 *  — the owner's next step is that order, and making him hunt for it would be a
 *  poor end to a flow whose whole purpose is not losing an order. */
function Outcome({ result }: { result: ConvertResult }) {
  const base = 'mt-[var(--space-3)] text-[11px] leading-[1.45]';

  if (result.status === 'converted') {
    return (
      <p className={`${base} text-ink/70`}>
        Order{' '}
        <Link to={`/admin/orders/${result.orderId}`} className="font-mono text-holo underline underline-offset-2">
          {result.orderNumber}
        </Link>{' '}
        created{result.totalCents != null ? ` for ${formatPriceExact(result.totalCents)}` : ''}. It starts at{' '}
        <strong className="font-medium">pending invoice</strong> — send the invoice from the order page. The cart
        link is revoked.
      </p>
    );
  }
  if (result.status === 'already_converted') {
    return (
      <p role="alert" className={`${base} text-[color:var(--color-status-warning)]`}>
        <strong className="font-medium">Nothing was created.</strong> This cart was already converted
        {result.orderNumber ? (
          <>
            {' '}into order{' '}
            <Link to={`/admin/orders/${result.orderId}`} className="font-mono underline underline-offset-2">
              {result.orderNumber}
            </Link>
          </>
        ) : null}
        . Reload the panel to see its current state.
      </p>
    );
  }
  if (result.status === 'not_found') {
    return (
      <p role="alert" className={`${base} text-[color:var(--color-status-warning)]`}>
        <strong className="font-medium">Nothing was created.</strong> This cart no longer exists — reload the panel.
      </p>
    );
  }
  return (
    <p role="alert" className={`${base} text-red-400`}>
      <strong className="font-medium">No order was created.</strong> {result.detail}
    </p>
  );
}

export function ConvertToOrderForm({
  cart, member, index, confirm, onConverted, onCancel,
}: {
  cart: PreparedCartSummary;
  member: MemberRow;
  index: VariantIndex;
  confirm: ConfirmFn;
  onConverted: () => void;
  onCancel: () => void;
}) {
  const seed = useMemo(() => prefillConvertLines(cart.lines, index), [cart.lines, index]);

  const [buyerName, setBuyerName] = useState(member.name);
  const [buyerContact, setBuyerContact] = useState(member.contact);
  const [organization, setOrganization] = useState(member.org ?? '');
  const [notes, setNotes] = useState(cart.note ?? '');
  const [drafts, setDrafts] = useState<LineDraft[]>(() => toDrafts(seed.lines));
  const [discount, setDiscount] = useState<DiscountDraft>(() =>
    prefillDiscount(member.effectivePercent, cart.coupon_code));
  const [result, setResult] = useState<ConvertResult | null>(null);

  const { converting, convert } = useConvertPreparedCart();

  const resolved = useMemo(() => drafts.map(resolveDraft), [drafts]);
  const lines = useMemo(() => resolved.filter((l): l is ConvertLine => l !== null), [resolved]);
  const invalidCount = resolved.length - lines.length;
  const totals = useMemo(() => convertTotals(lines, discount), [lines, discount]);

  const nameOk = buyerName.trim().length > 0;
  const contactOk = buyerContact.trim().length > 0;
  const done = result?.status === 'converted' || result?.status === 'already_converted';
  const canSubmit = nameOk && contactOk && lines.length > 0 && invalidCount === 0 && !converting && !done;

  function updateDraft(key: string, patch: Partial<LineDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function setKind(kind: DiscountKind) {
    setDiscount((d) => ({ ...d, kind }));
  }

  async function submit() {
    const ok = await confirm(
      convertConfirmMessage({ buyerName: buyerName.trim(), lines, totals, discount }),
      { confirmLabel: 'Create order' },
    );
    if (!ok) return;

    const outcome = await convert({
      cartId: cart.id,
      buyerName: buyerName.trim(),
      buyerContact: buyerContact.trim(),
      buyerOrganization: organization.trim() || null,
      notes: notes.trim() || null,
      lines,
      discount,
    });
    setResult(outcome);
    // Reload on any terminal answer: 'already_converted' means the panel is
    // stale, which is exactly when the owner needs it refreshed.
    if (outcome.status === 'converted' || outcome.status === 'already_converted') onConverted();
  }

  return (
    <div className="mt-[var(--space-2)] rounded-[12px] border border-holo/20 bg-holo/[0.03] p-[var(--space-3)]">
      <p className="mb-[var(--space-3)] text-[11px] leading-[1.45] text-ink/60">
        Creates a real order from this cart, at the prices below. Use this when {member.name.split(' ')[0]} has
        already paid you directly — the figures here are recorded as typed and are <strong className="font-medium">
        not re-priced</strong> against the catalog.
      </p>

      {/* ── Buyer, pre-filled from the roster row ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-[var(--space-2)] sm:grid-cols-2">
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>Buyer name</span>
          <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>Buyer email</span>
          <input value={buyerContact} onChange={(e) => setBuyerContact(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>Organization</span>
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_DENSE}>Internal note</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={fieldCls} />
        </label>
      </div>

      {/* ── Lines, with editable unit prices ──────────────────────────────── */}
      <div className="mt-[var(--space-3)] space-y-[var(--space-2)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        {drafts.map((draft, i) => {
          const line = resolved[i];
          return (
            <div key={draft.key} className="flex flex-wrap items-end justify-between gap-[var(--space-2)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-ink/75">{draft.name}</span>
                <span className="block font-mono text-[10px] tabular-nums text-ink/40">
                  {line ? formatPriceExact(line.unitPriceCents * line.quantity) : 'line unusable'}
                </span>
              </span>
              <span className="flex shrink-0 items-end gap-[var(--space-2)]">
                <label className="block w-[60px]">
                  <span className={FIELD_LABEL_DENSE}>Qty</span>
                  <input
                    type="number" min="1" max="9999" inputMode="numeric"
                    value={draft.quantityText}
                    onChange={(e) => updateDraft(draft.key, { quantityText: e.target.value })}
                    className={`${fieldCls} text-right`}
                  />
                </label>
                <label className="block w-[88px]">
                  <span className={FIELD_LABEL_DENSE}>Unit $</span>
                  <input
                    type="number" step="0.01" min="0" inputMode="decimal"
                    value={draft.unitUsdText}
                    onChange={(e) => updateDraft(draft.key, { unitUsdText: e.target.value })}
                    className={`${fieldCls} text-right`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setDrafts((ds) => (ds.length > 1 ? ds.filter((d) => d.key !== draft.key) : ds))}
                  disabled={drafts.length === 1}
                  aria-label={`Remove ${draft.name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/30 text-red-400/75 transition-colors hover:border-red-400/55 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ×
                </button>
              </span>
            </div>
          );
        })}
        {seed.dropped.length > 0 && (
          <p role="alert" className="text-[10.5px] text-[color:var(--color-status-warning)]">
            {seed.dropped.length} line(s) left the catalog and were not carried over — add them from the order page
            if they were paid for.
          </p>
        )}
      </div>

      {/* ── The discount, editable both ways ──────────────────────────────── */}
      <div className="mt-[var(--space-3)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <div className="flex flex-wrap items-end gap-[var(--space-2)]">
          <label className="block">
            <span className={FIELD_LABEL_DENSE}>Discount</span>
            <select
              value={discount.kind}
              onChange={(e) => setKind(e.target.value as DiscountKind)}
              className={fieldCls}
            >
              <option value="percent">Percent</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>
          {discount.kind === 'percent' ? (
            <label className="block w-[86px]">
              <span className={FIELD_LABEL_DENSE}>Percent</span>
              <input
                type="number" min="0" max="100" inputMode="numeric"
                value={String(discount.percent)}
                onChange={(e) =>
                  setDiscount((d) => ({ ...d, percent: parsePercentInput(e.target.value) ?? 0 }))}
                className={`${fieldCls} text-right`}
              />
            </label>
          ) : (
            <label className="block w-[110px]">
              <span className={FIELD_LABEL_DENSE}>Amount $</span>
              <input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={usd(discount.amountCents)}
                onChange={(e) =>
                  setDiscount((d) => ({ ...d, amountCents: parseUsdToCents(e.target.value) ?? 0 }))}
                className={`${fieldCls} text-right`}
              />
            </label>
          )}
          <label className="block min-w-[140px] flex-1">
            <span className={FIELD_LABEL_DENSE}>Shown on the invoice as</span>
            <input
              value={discount.code}
              onChange={(e) => setDiscount((d) => ({ ...d, code: e.target.value }))}
              placeholder={ADMIN_DISCOUNT_CODE}
              className={`${fieldCls} font-mono uppercase`}
            />
          </label>
        </div>
        <p className="mt-1 text-[10.5px] leading-[1.4] text-ink/40">
          Opens at {member.name.split(' ')[0]}&rsquo;s standing {member.effectivePercent}% rate. A negotiated
          fraction of a percent goes in as a fixed amount — percents are recorded whole.
        </p>
      </div>

      {/* ── The number he is reconciling against ──────────────────────────── */}
      <dl className="mt-[var(--space-3)] space-y-1 border-t border-ink/[0.06] pt-[var(--space-3)] font-mono text-[11px] tabular-nums">
        <div className="flex justify-between text-ink/45">
          <dt>Subtotal</dt>
          <dd>{formatPriceExact(totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between text-ink/45">
          <dt>Discount</dt>
          <dd>−{formatPriceExact(totals.discountCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between pt-1">
          <dt className="text-[10px] uppercase tracking-[0.22em] text-ink/50">Order total</dt>
          <dd aria-live="polite" className="text-holo text-[clamp(1.2rem,2.4vw,1.5rem)] font-light leading-none">
            {formatPriceExact(totals.totalCents)}
          </dd>
        </div>
      </dl>

      {invalidCount > 0 && (
        <p role="alert" className="mt-[var(--space-2)] text-[10.5px] text-red-400">
          {invalidCount} line(s) have an unusable quantity or price. Fix them before creating the order.
        </p>
      )}

      <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)]">
        <Button type="button" variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
          {converting ? 'Working…' : 'Create order'}
        </Button>
        <RowAction onClick={onCancel}>{done ? 'Close' : 'Cancel'}</RowAction>
      </div>

      {result && <Outcome result={result} />}
    </div>
  );
}
