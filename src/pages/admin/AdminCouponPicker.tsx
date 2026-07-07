/**
 * AdminCouponPicker
 *
 * A dropdown of the shop's LIVE active coupon codes, shown in the admin order
 * editor so an admin applies a real code from a list instead of typing/guessing.
 *
 * Picking a code calls the admin_apply_coupon RPC (migration 034), which
 * re-validates it server-side against the order's current subtotal and stamps
 * discount_cents + coupon_code onto the order (re-deriving the billed total).
 * Choosing "No coupon" calls admin_clear_coupon.
 *
 * IMPORTANT: this NEVER sends email. It only writes the discount to the order.
 * The admin re-sends the invoice manually when ready — so editing/re-editing
 * never fires a customer email. The discount survives further line edits
 * because save_order_lines subtracts discount_cents on every save.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ActiveCoupon {
  code: string;
  kind: 'percent' | 'fixed' | 'free_item';
  percent: number | null;
  amount_cents: number | null;
  free_label: string | null;
  free_sku: string | null;
}

interface AdminCouponPickerProps {
  orderId: string;
  /** Code already on the order, if any — pre-selects the dropdown. */
  currentCode?: string | null;
  /** Fired after a successful apply/clear so the parent can reload the order. */
  onApplied?: () => void;
}

function summarize(c: ActiveCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `$${(c.amount_cents / 100).toFixed(2)} off`;
  return `Free ${c.free_label ?? c.free_sku ?? 'item'}`;
}

const fieldCls =
  'w-full rounded-[8px] border border-ink/15 bg-base-700 px-3 py-2 text-[13px] text-ink ' +
  'focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15 disabled:opacity-60';

export function AdminCouponPicker({ orderId, currentCode, onApplied }: AdminCouponPickerProps) {
  const [coupons, setCoupons] = useState<ActiveCoupon[]>([]);
  const [selected, setSelected] = useState<string>(currentCode ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    supabase
      .from('coupons')
      .select('code, kind, percent, amount_cents, free_label, free_sku')
      .eq('active', true)
      .order('code')
      .then(({ data }) => { if (alive && data) setCoupons(data as ActiveCoupon[]); });
    return () => { alive = false; };
  }, []);

  async function pick(code: string) {
    if (!supabase) return;
    setSelected(code);
    setStatus(null);
    setBusy(true);
    try {
      if (!code) {
        const { error } = await supabase.rpc('admin_clear_coupon', { p_order_id: orderId });
        if (error) throw error;
        setStatus({ ok: true, text: 'Coupon removed — full total restored.' });
      } else {
        const { data, error } = await supabase.rpc('admin_apply_coupon', { p_order_id: orderId, p_code: code });
        if (error) throw error;
        const res = data as { applied: boolean; reason?: string; discount_cents?: number; total_cents?: number; kind?: string; free_label?: string | null };
        if (!res.applied) {
          setSelected(currentCode ?? '');
          setStatus({ ok: false, text: res.reason ?? 'This code is not valid.' });
          setBusy(false);
          return;
        }
        const text = res.kind === 'free_item'
          ? `Free ${res.free_label ?? 'item'} — add it as a $0 line. New total $${((res.total_cents ?? 0) / 100).toFixed(2)}.`
          : `−$${((res.discount_cents ?? 0) / 100).toFixed(2)} applied · new total $${((res.total_cents ?? 0) / 100).toFixed(2)}.`;
        setStatus({ ok: true, text });
      }
      onApplied?.();
    } catch (e: unknown) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Could not apply the code.' });
    }
    setBusy(false);
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">
        Discount / coupon
      </span>
      <select value={selected} onChange={(e) => void pick(e.target.value)} disabled={busy} className={fieldCls}>
        <option value="">— No coupon —</option>
        {coupons.map((c) => (
          <option key={c.code} value={c.code}>{c.code} — {summarize(c)}</option>
        ))}
      </select>
      {status && (
        <span className={`mt-1 block text-[10px] tracking-wide ${status.ok ? 'text-holo/80' : 'text-red-400'}`}>
          {status.text}
        </span>
      )}
      {coupons.length === 0 && (
        <span className="mt-1 block text-[10px] text-ink/40">No active codes — create one at Admin → Coupons.</span>
      )}
      <span className="mt-1 block text-[10px] text-ink/40">Applies to this order only — no email is sent. Re-send the invoice manually when ready.</span>
    </label>
  );
}
