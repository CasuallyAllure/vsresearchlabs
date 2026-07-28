/**
 * accountDiscount — the signed-in customer's own lifetime/business discount,
 * for CART PREVIEW ONLY.
 *
 * Mirrors effective_customer_discount() (migration 074) client-side over the
 * customer's OWN customer_discounts rows (RLS "Customers read own discounts"):
 * best = highest percent among active, in-window rows whose scope is valid for
 * the profile — 'business' requires customer_profiles.account_type ===
 * 'business' (read from the customer's own profile), 'lifetime' applies to any
 * account. Lifetime and business never stack; ties break to the newest rule.
 *
 * Migration 069 made a 15% discount AUTOMATIC for every account holder;
 * migration 074 made the floor TIER-AWARE — customer_profiles.tier 'member'
 * floors at 15%, 'pro' at 20% (TIER_FLOOR_PERCENTS in memberPricing.ts). An
 * assigned rule that meets or beats the caller's tier floor is honored
 * verbatim; any account holder with no rule, or a rule below their floor,
 * gets the automatic tier floor instead (never averaged with it). Only a
 * signed-in user with NO customer_profiles row at all gets nothing, exactly
 * like the SQL function's "not exists" branch.
 *
 * NOT authoritative for billing: place-order re-resolves the entitlement
 * server-side (service-role RPC) and materializes it on the order. Guests,
 * a missing profile row, missing supabase env, and any unexpected error all
 * resolve to null. A customer_discounts query error is treated as "no
 * explicit rule" rather than null — the automatic floor below is guaranteed
 * correct regardless (it never exceeds what the server would actually bill),
 * so it's safe to show even when the explicit rows couldn't be read.
 */

import { supabase } from './supabase';
import type { AccountDiscountPreview } from './coupons';
import { TIER_FLOOR_PERCENTS, type TierKey } from './memberPricing';

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
        .select('account_type, tier')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('customer_discounts')
        .select('scope, percent, label, starts_at, expires_at, created_at')
        .eq('user_id', userId)
        .eq('active', true),
    ]);
    // No customer_profiles row (or the lookup itself failed) → not a
    // confirmed account holder → no entitlement at all, mirroring
    // effective_customer_discount's "not exists" branch.
    if (profileRes.error || !profileRes.data) return null;
    const isBusiness = profileRes.data.account_type === 'business';

    // Tier-aware floor (074): anything other than a literal 'pro' degrades to
    // the base member floor — always safe, it never exceeds what the server
    // would actually bill.
    const tier: TierKey = profileRes.data.tier === 'pro' ? 'pro' : 'member';
    const floorPercent = TIER_FLOOR_PERCENTS[tier] ?? TIER_FLOOR_PERCENTS.member;
    const floorLabel = tier === 'pro' ? 'Pro member 20%' : 'Account-holder 15%';

    // Same predicate as effective_customer_discount: active (queried above),
    // inside [starts_at, expires_at], scope valid for the profile. A rows
    // query error degrades to "no explicit rule" — see the floor note above.
    const now = Date.now();
    const rows = !rowsRes.error && rowsRes.data ? (rowsRes.data as DiscountRow[]) : [];
    const eligible = rows.filter((r) => {
      const pct = Number(r.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return false;
      if (r.starts_at && now < Date.parse(r.starts_at)) return false;
      if (r.expires_at && now > Date.parse(r.expires_at)) return false;
      if (r.scope === 'lifetime') return true;
      return r.scope === 'business' && isBusiness;
    });

    // Best-of: highest percent wins, ties break to the newest rule — the same
    // ORDER BY (percent desc, created_at desc) as the SQL function.
    const best = eligible.length > 0
      ? [...eligible].sort(
          (a, b) =>
            Number(b.percent) - Number(a.percent) ||
            Date.parse(b.created_at) - Date.parse(a.created_at),
        )[0]
      : null;

    // An assigned rate that meets or beats the tier floor is honored verbatim;
    // a rule below the floor (or no rule at all) is REPLACED by the automatic
    // tier floor — every confirmed account holder gets a row now.
    if (best && Number(best.percent) >= floorPercent) {
      return {
        scope: best.scope === 'business' ? 'business' : 'lifetime',
        percent: Number(best.percent),
        label: best.label,
      };
    }
    return { scope: 'lifetime', percent: floorPercent, label: floorLabel };
  } catch {
    // Any unexpected failure downgrades to "no preview" — never blocks the cart.
    return null;
  }
}
