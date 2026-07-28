/**
 * ProPriorityChip — quiet "pro · priority" marker on the admin order view.
 *
 * Shown when the order's `user_id` belongs to a `customer_profiles` row with
 * tier='pro', so fulfillment can spot priority-handling orders at a glance.
 * Fail-silent by design: no user_id, no profile, or any query error renders
 * nothing — this chip must never break the order page.
 */

import { useEffect, useState } from 'react';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import { supabase } from '../../lib/supabase';

export function ProPriorityChip({ userId }: { userId: string | null }) {
  // The user_id the chip has CONFIRMED as pro — comparing against the current
  // prop makes a stale confirmation self-invalidate when the order changes,
  // with no synchronous state reset inside the effect.
  const [proUserId, setProUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    supabase
      .from('customer_profiles')
      .select('tier')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        if ((data as { tier?: string } | null)?.tier === 'pro') setProUserId(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (userId == null || proUserId !== userId) return null;
  return (
    <span className={`${CHIP_BASE} border-ink/15 text-ink/55 bg-ink/[0.02]`}>pro · priority</span>
  );
}
