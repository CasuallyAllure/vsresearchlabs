/**
 * AdminCouponPicker — order discounts & shipping panel (admin order editor).
 *
 * Stacks multiple coupons on one order, a $10 shipping toggle, and a live
 * Subtotal / Discount / Shipping / Total breakdown. All writes go through the
 * SECURITY DEFINER RPCs from migration 036 (admin_apply_coupon /
 * admin_remove_coupon / admin_clear_coupons / set_order_shipping), each of
 * which recomputes the order totals server-side. NEVER sends email — the admin
 * re-sends the invoice manually; the invoice template already renders the
 * discount + shipping lines.
 *
 * Self-fetching: reads the order's applied coupons + totals so it stays correct
 * across line edits. Calls onChanged after every write so the parent reloads.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ActiveCoupon {
  code: string;
  kind: 'percent' | 'fixed' | 'free_item';
  percent: number | null;
  amount_cents: number | null;
  free_label: string | null;
  free_sku: string | null;
}
interface AppliedCoupon {
  code: string; kind: string; free_label: string | null;
  percent: number | null; amount_cents: number | null; discount_cents: number;
}
interface Totals { subtotal_cents: number; discount_cents: number; shipping_cents: number; invoice_amount_cents: number | null }

interface Props {
  orderId: string;
  /** Fired after any write so the parent can reload the order. */
  onChanged?: () => void;
}

const SHIP_CENTS = 1000; // $10 flat shipping

function usd(c: number | null | undefined): string {
  return c == null ? '—' : `$${(c / 100).toFixed(2)}`;
}
function summarize(c: ActiveCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `$${(c.amount_cents / 100).toFixed(2)} off`;
  return `Free ${c.free_label ?? c.free_sku ?? 'item'}`;
}
/** One-line label for an APPLIED coupon in the itemized breakdown. */
function appliedLabel(a: AppliedCoupon): string {
  if (a.kind === 'percent' && a.percent != null) return `${a.code} · ${a.percent}% off`;
  if (a.kind === 'fixed' && a.amount_cents != null) return `${a.code} · ${usd(a.amount_cents)} off`;
  return `${a.code} · Free ${a.free_label ?? 'item'}`;
}

const fieldCls =
  'w-full rounded-[8px] border border-ink/15 bg-base-700 px-3 py-2 text-[13px] text-ink ' +
  'focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15 disabled:opacity-60';

export function AdminCouponPicker({ orderId, onChanged }: Props) {
  const [active, setActive] = useState<ActiveCoupon[]>([]);
  const [applied, setApplied] = useState<AppliedCoupon[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [act, app, ord] = await Promise.all([
      supabase.from('coupons').select('code, kind, percent, amount_cents, free_label, free_sku').eq('active', true).order('code'),
      supabase.from('order_coupons').select('code, kind, free_label, percent, amount_cents, discount_cents').eq('order_id', orderId).order('created_at'),
      supabase.from('orders').select('subtotal_cents, discount_cents, shipping_cents, invoice_amount_cents').eq('id', orderId).single(),
    ]);
    if (act.data) setActive(act.data as ActiveCoupon[]);
    if (app.data) setApplied(app.data as AppliedCoupon[]);
    if (ord.data) setTotals(ord.data as Totals);
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, okMsg?: string) {
    if (!supabase) return;
    setBusy(true); setStatus(null);
    const { data, error } = await fn();
    setBusy(false);
    if (error) { setStatus({ ok: false, text: error.message }); return; }
    const res = data as { applied?: boolean; reason?: string } | null;
    if (res && res.applied === false && res.reason) { setStatus({ ok: false, text: res.reason }); }
    else if (okMsg) setStatus({ ok: true, text: okMsg });
    await load();
    onChanged?.();
  }

  const addCode = (code: string) => code && run(() => supabase!.rpc('admin_apply_coupon', { p_order_id: orderId, p_code: code }));
  const removeCode = (code: string) => run(() => supabase!.rpc('admin_remove_coupon', { p_order_id: orderId, p_code: code }), `${code} removed`);
  const setShipping = (cents: number) => run(() => supabase!.rpc('set_order_shipping', { p_order_id: orderId, p_cents: cents }), `Shipping set to ${usd(cents)}`);

  const appliedCodes = new Set(applied.map((a) => a.code));
  const addable = active.filter((c) => !appliedCodes.has(c.code));
  const shipping = totals?.shipping_cents ?? 0;

  return (
    <div className="space-y-[var(--space-3)]">
      <div className="text-[9px] uppercase tracking-[0.18em] text-ink/45">Discounts & shipping</div>

      {/* Applied coupon chips */}
      {applied.length > 0 && (
        <div className="flex flex-wrap gap-[var(--space-2)]">
          {applied.map((a) => (
            <span key={a.code} className="inline-flex items-center gap-1.5 rounded-full border border-holo/30 bg-holo/[0.08] px-2.5 py-1 text-[11px] text-holo-light">
              <span className="font-mono tracking-wide">{a.code}</span>
              <button type="button" onClick={() => void removeCode(a.code)} disabled={busy} aria-label={`Remove ${a.code}`} className="text-holo-light/70 hover:text-holo-light">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Add another code */}
      <select value="" onChange={(e) => void addCode(e.target.value)} disabled={busy} className={fieldCls}>
        <option value="">{applied.length ? '+ Add another code…' : '— Add a discount code —'}</option>
        {addable.map((c) => (<option key={c.code} value={c.code}>{c.code} — {summarize(c)}</option>))}
      </select>

      {/* Shipping — $10 flat, waivable */}
      <div className="flex items-center gap-[var(--space-2)]">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink/45">Shipping</span>
        <span className="font-mono text-[12px] tabular-nums text-ink/80">{shipping > 0 ? usd(shipping) : 'Free'}</span>
        <button type="button" onClick={() => void setShipping(shipping > 0 ? 0 : SHIP_CENTS)} disabled={busy}
          className="rounded-full border border-ink/15 px-3 py-1 text-[11px] text-ink/70 transition-colors hover:border-ink/30 disabled:opacity-60">
          {shipping > 0 ? 'Waive shipping' : 'Add $10 shipping'}
        </button>
      </div>

      {/* Live money breakdown */}
      {totals && (
        <div className="rounded-[8px] border border-ink/10 bg-base-800/40 px-3 py-2 text-[12px]">
          <Row label="Subtotal" value={usd(totals.subtotal_cents)} />
          {/* One line per coupon so each reduction (incl. the free bacwater) is visible. */}
          {applied.filter((a) => a.discount_cents > 0).map((a) => (
            <Row key={a.code} label={appliedLabel(a)} value={`−${usd(a.discount_cents)}`} accent />
          ))}
          {totals.discount_cents > 0 && (
            <Row label="Total discount" value={`−${usd(totals.discount_cents)}`} accent />
          )}
          <Row label="Shipping" value={shipping > 0 ? usd(shipping) : 'Free'} />
          <div className="mt-1 border-t border-ink/10 pt-1">
            <Row label="Total" value={usd(totals.invoice_amount_cents)} bold />
          </div>
        </div>
      )}

      {status && (<span className={`block text-[10px] ${status.ok ? 'text-holo/80' : 'text-red-400'}`}>{status.text}</span>)}
      <span className="block text-[10px] text-ink/40">Applies to this order only — no email is sent. Re-send the invoice manually when ready.</span>
    </div>
  );
}

function Row({ label, value, accent, bold }: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={accent ? 'text-holo/80' : bold ? 'text-ink' : 'text-ink/55'}>{label}</span>
      <span className={`font-mono tabular-nums ${accent ? 'text-holo/80' : bold ? 'text-ink text-[13px]' : 'text-ink/85'}`}>{value}</span>
    </div>
  );
}
