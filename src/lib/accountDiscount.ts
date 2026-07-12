/**
 * accountDiscount — the signed-in customer's own lifetime/business discount,
 * for CART PREVIEW ONLY.
 *
 * Mirrors effective_customer_discount() (migration 045) client-side over the
 * customer's OWN customer_discounts rows (RLS "Customers read own discounts"):
 * best = highest percent among active, in-window rows whose scope is valid for
 * the profile — 'business' requires customer_profiles.account_type ===
 * 'business' (read from the customer's own profile), 'lifetime' applies to any
 * account. Lifetime and business never stack; ties break to the newest rule.
 *
 * NOT authoritative for billing: place-order re-resolves the entitlement
 * server-side (service-role RPC) and materializes it on the order. Guests,
 * missing supabase env, and any query error all resolve to null — the preview
 * simply shows no account line while checkout still applies the discount
 * server-side when the customer qualifies.
 */

import { supabase } from './supabase';
import type { AccountDiscountPreview } from './coupons';

interface DiscountRow {
  scope: string;
  percent: number | string;
  label: string;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function fetchMyAccountDiscount(): Promise<AccountDiscountPreview | null> {
  if (!supabase) return null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return null;

    const [profileRes, rowsRes] = await Promise.all([
      supabase
        .from('customer_profiles')
        .select('account_type')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('customer_discounts')
        .select('scope, percent, label, starts_at, expires_at, created_at')
        .eq('user_id', userId)
        .eq('active', true),
    ]);
    if (rowsRes.error || !rowsRes.data || rowsRes.data.length === 0) return null;
    const isBusiness = profileRes.data?.account_type === 'business';

    // Same predicate as effective_customer_discount: active (queried above),
    // inside [starts_at, expires_at], scope valid for the profile.
    const now = Date.now();
    const eligible = (rowsRes.data as DiscountRow[]).filter((r) => {
      const pct = Number(r.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return false;
      if (r.starts_at && now < Date.parse(r.starts_at)) return false;
      if (r.expires_at && now > Date.parse(r.expires_at)) return false;
      if (r.scope === 'lifetime') return true;
      return r.scope === 'business' && isBusiness;
    });
    if (eligible.length === 0) return null;

    // Best-of: highest percent wins, ties break to the newest rule — the same
    // ORDER BY (percent desc, created_at desc) as the SQL function.
    const best = [...eligible].sort(
      (a, b) =>
        Number(b.percent) - Number(a.percent) ||
        Date.parse(b.created_at) - Date.parse(a.created_at),
    )[0];

    return {
      scope: best.scope === 'business' ? 'business' : 'lifetime',
      percent: Number(best.percent),
      label: best.label,
    };
  } catch {
    // Any unexpected failure downgrades to "no preview" — never blocks the cart.
    return null;
  }
}
