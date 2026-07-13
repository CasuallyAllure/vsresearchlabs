/**
 * customerProfile — types + data access for a logged-in customer's profile.
 *
 * A profile is one row in `customer_profiles`, keyed to the Supabase auth
 * user. RLS guarantees a customer can only ever read/write their OWN row, so
 * these queries never need an explicit user_id filter — the policy applies it.
 */

import { supabase } from './supabase';

export type CustomerTier = 'member' | 'pro';
export type CustomerStatus = 'active' | 'waitlisted' | 'suspended';

export interface CustomerProfile {
  user_id: string;
  full_name: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  tier: CustomerTier;
  status: CustomerStatus;
  /** Admin-granted perk (049) — guarded column, customers can't set it themselves. */
  free_shipping: boolean;
  created_at: string;
  updated_at: string;
}

/** Mutable subset a customer may edit on their own profile. */
export type CustomerProfilePatch = Partial<
  Pick<
    CustomerProfile,
    | 'full_name'
    | 'phone'
    | 'address_line1'
    | 'address_line2'
    | 'city'
    | 'state'
    | 'postal_code'
    | 'country'
  >
>;

/**
 * Load the current user's profile. Returns null when no profile row exists
 * yet (e.g. the auth.users trigger hasn't fired, or this is an admin-only
 * account). Throws only on an unexpected backend error.
 */
export async function loadMyProfile(): Promise<CustomerProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return (data as CustomerProfile | null) ?? null;
}

/** Update the current user's profile and return the new row. */
export async function updateMyProfile(
  userId: string,
  patch: CustomerProfilePatch,
): Promise<CustomerProfile> {
  if (!supabase) {
    throw new Error('Backend not configured.');
  }
  const { data, error } = await supabase
    .from('customer_profiles')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update profile.');
  }
  return data as CustomerProfile;
}
