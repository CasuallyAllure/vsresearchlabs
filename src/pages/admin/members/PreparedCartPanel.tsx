/**
 * PreparedCartPanel — "Build cart" inside the expanded roster row.
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
 * Confirmation uses ConfirmModal, never window.confirm — iOS silently
 * suppresses native dialogs once "Block Alerts" is tapped, which makes a
 * confirmed admin action look like it did nothing.
 *
 * The roster layout is otherwise untouched: this is a Panel rendered inside the
 * already-expanded row, behind a RowAction toggle. No new page, no nav entry.
 */

import { useMemo, useState } from 'react';
import type { ConfirmFn } from '../../../components/admin/accountPanels';
import { Button } from '../../../components/ui/Button';
import { FIELD_DEFAULT, FIELD_LABEL_DENSE, FIELD_SURFACE_DENSE } from '../../../components/ui/Field';
import { formatPriceExact } from '../../../lib/pricing';
import {
  compoundTierLabel, doseTierLabel, doseTierShort, findVariantOption, priceLines, variantOptionKey,
  type PreparedCartLine, type VariantIndex,
} from '../../../lib/preparedCart';
import type { MemberRow } from '../membersView';
import { Chip, Panel, RowAction } from './ui';
import { shortDate } from './format';
import {
  preparedCartClaimUrl, usePreparedCart, useVariantIndex,
  type CreatedPreparedCart, type PreparedCartStatus, type PreparedCartSummary,
} from './usePreparedCart';

const fieldCls = `${FIELD_SURFACE_DENSE} ${FIELD_DEFAULT}`;

const STATUS_TONE: Record<PreparedCartStatus, 'good' | 'warn' | 'neutral' | 'info'> = {
  live: 'good',
  claimed: 'info',
  expired: 'neutral',
  revoked: 'warn',
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

export function PreparedCartPanel({ member, confirm }: { member: MemberRow; confirm: ConfirmFn }) {
  const index = useVariantIndex();
  const { carts, loading, busy, error, unmigrated, create, revoke } = usePreparedCart(member.userId);

  const [rows, setRows] = useState<DraftRow[]>([emptyRow('r0')]);
  const [couponCode, setCouponCode] = useState('');
  const [note, setNote] = useState('');
  const [built, setBuilt] = useState<CreatedPreparedCart | null>(null);
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => draftLines(rows, index), [rows, index]);
  const pricing = useMemo(() => priceLines(lines, index, member.effectivePercent), [lines, index, member.effectivePercent]);

  function update(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function pickCompound(key: string, compound: string) {
    // Changing the compound invalidates the dose — never leave a stale pairing.
    update(key, { compound, optionKey: '' });
  }

  async function build() {
    const ok = await confirm(
      `Build a prepared cart for ${member.name} — ${lines.length} line${lines.length === 1 ? '' : 's'}, ` +
        `${formatPriceExact(pricing.memberTotalCents)} at their ${member.effectivePercent}% rate` +
        `${couponCode.trim() ? ` · coupon ${couponCode.trim().toUpperCase()}` : ''}. ` +
        'The link is valid for 14 days and can be revoked at any time.',
      { confirmLabel: 'Build cart' },
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
    setRows([emptyRow(`r${Date.now()}`)]);
    setCouponCode('');
    setNote('');
  }

  async function killCart(cart: PreparedCartSummary) {
    const ok = await confirm(
      `Revoke this prepared cart? The link stops working immediately. Built ${shortDate(cart.created_at)}.`,
      { confirmLabel: 'Revoke' },
    );
    if (ok) await revoke(cart.id);
  }

  if (unmigrated) {
    return (
      <Panel caption="Prepared cart">
        <p className="text-[12px] text-ink/40">
          Prepared-cart data layer not migrated yet — apply migration 081 to enable this.
        </p>
      </Panel>
    );
  }

  return (
    <Panel caption="Prepared cart">
      {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

      {/* ── Line editor: compound → dose → qty ─────────────────────────────── */}
      <div className="space-y-[var(--space-2)]">
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
      {pricing.lines.length > 0 && (
        <dl className="mt-[var(--space-3)] space-y-1 font-mono text-[11px] tabular-nums">
          <div className="flex justify-between text-ink/45">
            <dt>List</dt>
            <dd>{formatPriceExact(pricing.listTotalCents)}</dd>
          </div>
          <div className="flex justify-between text-ink/45">
            <dt>{member.discountLabel ?? `Account-holder ${member.effectivePercent}%`}</dt>
            <dd>−{formatPriceExact(pricing.savingsCents)}</dd>
          </div>
          <div className="flex justify-between text-[12px] text-ink">
            <dt>{member.name.split(' ')[0]} pays</dt>
            <dd className="text-holo">{formatPriceExact(pricing.memberTotalCents)}</dd>
          </div>
        </dl>
      )}
      <p className="mt-[var(--space-2)] text-[10.5px] leading-[1.4] text-ink/35">
        Prices resolve live when the member opens the cart and again at checkout — nothing is locked
        in. Wholesale packs, the paired bundle and a B2G1 promo all replace the account discount
        rather than stacking with it. B2G1 reaches <strong className="font-medium text-ink/50">Sourced
        lines only</strong> — a 24 Hour line never earns a free third unit.
      </p>

      <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        <Button
          type="button" variant="primary" size="sm"
          disabled={lines.length === 0 || busy}
          onClick={build}
        >
          {busy ? 'Working…' : 'Build cart'}
        </Button>
        {pricing.unpriced.length > 0 && (
          <span className="text-[10.5px] text-[color:var(--color-status-warning)]">
            {pricing.unpriced.length} line(s) left the catalog and will be dropped.
          </span>
        )}
      </div>

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
            <span className="text-[10.5px] text-ink/40">
              Expires {shortDate(built.expires_at)}. Automatic email delivery lands with the next
              workstream — send this link yourself for now.
            </span>
          </div>
        </div>
      )}

      {/* ── Previously built carts ─────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)] border-t border-ink/[0.06] pt-[var(--space-3)]">
        <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] text-ink/40">Built carts</p>
        {loading ? (
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
        ) : carts.length === 0 ? (
          <p className="text-[12px] text-ink/40">None yet.</p>
        ) : (
          <ul className="divide-y divide-ink/[0.04]">
            {carts.map((cart) => (
              <li key={cart.id} className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-1 py-[var(--space-2)]">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink/75">
                    <Chip tone={STATUS_TONE[cart.status]}>{cart.status}</Chip>
                    <span>{cart.lines.length} line{cart.lines.length === 1 ? '' : 's'}</span>
                    {cart.coupon_code && <span className="font-mono text-[10.5px] text-ink/50">{cart.coupon_code}</span>}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ink/40">
                    {cart.lines.map((l) => `${l.sku}${l.dose ? ` ${l.dose}` : ''} ×${l.quantity}`).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink/35">
                  {shortDate(cart.created_at)} → {shortDate(cart.expires_at)}
                </span>
                {cart.status === 'live' || cart.status === 'claimed' ? (
                  <RowAction danger disabled={busy} onClick={() => killCart(cart)}>Revoke</RowAction>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
