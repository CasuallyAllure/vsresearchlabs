/**
 * AdminCouponPicker
 *
 * A dropdown of the shop's LIVE active coupon codes, for the admin order
 * editor's invoice stage — so an admin applies a real code from a list
 * instead of typing/guessing. Picking a code re-validates it server-side
 * against the current subtotal via the same `validate_coupon` RPC the cart
 * uses (pricing stays server-side), then reports the computed discount back
 * to the parent, which lowers the Invoice total and stamps `coupon_code`.
 *
 * percent / fixed  → returns a discountCents the parent subtracts.
 * free_item        → discount is $0 (the value is a free line); we surface the
 *                    label so the admin can add it as a $0 line by hand.
 *
 * Note: this does NOT write the coupon_redemptions ledger (that RPC is
 * service-role-only, fired by place-order for customer checkouts). An
 * admin-applied code adjusts the invoice but won't create an affiliate
 * commission row — acceptable for manual/ops orders.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkCoupon, couponDiscountCents } from '../../lib/coupons';

interface ActiveCoupon {
  code: string;
  kind: 'percent' | 'fixed' | 'free_item';
  percent: number | null;
  amount_cents: number | null;
  free_label: string | null;
  free_sku: string | null;
}

export interface AppliedCouponResult {
  code: string;
  discountCents: number;
  freeLabel: string | null;
  note: string;
}

interface AdminCouponPickerProps {
  /** Pre-discount subtotal the coupon is validated against (cents). */
  subtotalCents: number;
  /** Code already on the order, if any — pre-selects the dropdown. */
  initialCode?: string | null;
  /** Fired on every change. null = "no coupon" (parent should reset the total). */
  onApply: (applied: AppliedCouponResult | null) => void;
}

function summarize(c: ActiveCoupon): string {
  if (c.kind === 'percent' && c.percent != null) return `${c.percent}% off`;
  if (c.kind === 'fixed' && c.amount_cents != null) return `$${(c.amount_cents / 100).toFixed(2)} off`;
  return `Free ${c.free_label ?? c.free_sku ?? 'item'}`;
}

const fieldCls =
  'w-full rounded-[8px] border border-ink/15 bg-base-700 px-3 py-2 text-[13px] text-ink ' +
  'focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15';

export function AdminCouponPicker({ subtotalCents, initialCode, onApply }: AdminCouponPickerProps) {
  const [coupons, setCoupons] = useState<ActiveCoupon[]>([]);
  const [selected, setSelected] = useState<string>(initialCode ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the live active codes once.
  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    supabase
      .from('coupons')
      .select('code, kind, percent, amount_cents, free_label, free_sku')
      .eq('active', true)
      .order('code')
      .then(({ data }) => {
        if (alive && data) setCoupons(data as ActiveCoupon[]);
      });
    return () => { alive = false; };
  }, []);

  async function pick(code: string) {
    setSelected(code);
    setStatus(null);
    if (!code) { onApply(null); return; }

    setLoading(true);
    const res = await checkCoupon(code, subtotalCents);
    setLoading(false);

    if (!res.ok) {
      setStatus({ ok: false, text: res.reason });
      onApply(null);
      return;
    }

    const discountCents = couponDiscountCents(res.coupon, subtotalCents);
    const isFreeItem = res.coupon.kind === 'free_item';
    const note = isFreeItem
      ? `Free ${res.coupon.freeLabel ?? res.coupon.freeSku ?? 'item'} — add it as a $0 line`
      : `−$${(discountCents / 100).toFixed(2)} applied`;
    setStatus({ ok: true, text: note });
    onApply({ code: res.coupon.code, discountCents, freeLabel: res.coupon.freeLabel, note });
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.18em] text-ink/45">
        Coupon (optional)
      </span>
      <select
        value={selected}
        onChange={(e) => void pick(e.target.value)}
        disabled={loading}
        className={fieldCls}
      >
        <option value="">— No coupon —</option>
        {coupons.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {summarize(c)}
          </option>
        ))}
      </select>
      {status && (
        <span
          className={`mt-1 block text-[10px] tracking-wide ${status.ok ? 'text-holo/80' : 'text-red-400'}`}
        >
          {status.text}
        </span>
      )}
      {!loading && coupons.length === 0 && (
        <span className="mt-1 block text-[10px] text-ink/40">
          No active codes. Create one at Admin → Coupons.
        </span>
      )}
    </label>
  );
}
