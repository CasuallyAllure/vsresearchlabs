/**
 * useVouchers — the Redemptions sub-view data source.
 *
 * Reads admin_member_vouchers (migration 073) — the admin window into
 * reward_vouchers that did not exist before Phase 2 — and exposes the single
 * new write verb admin_void_voucher. Formats, never estimates. Missing 073
 * degrades to `unmigrated` (calm note) rather than crashing.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getErrorMessage, isMissingBackend } from './backend';

export type VoucherStatus = 'active' | 'used' | 'void';
export type VoucherFilter = 'all' | VoucherStatus;

export interface VoucherRow {
  id: string;
  userId: string;
  customerId: string | null;
  memberName: string;
  contact: string;
  percent: number;
  pointsSpent: number;
  status: VoucherStatus;
  createdIso: string;
  usedIso: string | null;
  voidedIso: string | null;
  voidReason: string | null;
  orderNumber: string | null;
  orderId: string | null;
}

export interface VoucherSummary {
  active: number;
  used: number;
  void: number;
  outstandingPoints: number;
}

interface VoucherResponse {
  rows: VoucherRow[];
  total: number;
  summary: VoucherSummary;
}

interface UseVouchersResult {
  rows: VoucherRow[];
  total: number;
  summary: VoucherSummary | null;
  loading: boolean;
  error: string | null;
  unmigrated: boolean;
  reload: () => void;
}

export function useVouchers(filter: VoucherFilter): UseVouchersResult {
  const [data, setData] = useState<VoucherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); setLoading(false); return; }
      setLoading(true);
      const { data: res, error: rpcError } = await supabase.rpc('admin_member_vouchers', {
        p_status: filter, p_limit: 200, p_offset: 0,
      });
      if (cancelled) return;
      if (rpcError) {
        if (isMissingBackend(rpcError)) setUnmigrated(true);
        else setError(rpcError.message);
        setLoading(false);
        return;
      }
      setData(res as VoucherResponse);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [filter, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    summary: data?.summary ?? null,
    loading,
    error,
    unmigrated,
    reload,
  };
}

/** Void an active voucher via the audited RPC. Returns refunded points or an
 *  error message — the caller (behind a ConfirmModal) surfaces both. */
export async function voidVoucher(
  voucherId: string,
  refundPoints: boolean,
  reason: string,
): Promise<{ ok: true; refundedPoints: number } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Backend not configured.' };
  const { data, error } = await supabase.rpc('admin_void_voucher', {
    p_voucher_id: voucherId,
    p_refund_points: refundPoints,
    p_reason: reason,
  });
  if (error) return { ok: false, error: getErrorMessage(error) };
  const refunded = (data as { refunded_points?: number } | null)?.refunded_points ?? 0;
  return { ok: true, refundedPoints: refunded };
}
