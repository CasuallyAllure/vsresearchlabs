/**
 * Reconcile response planning — the Deno-free half of the `reconcile` edge
 * function (same split as place-order/priceCheck.ts: this module has no
 * Deno globals or remote imports, so the vitest suite drives it directly).
 *
 * Input: the raw result of the reconcile_reward_vouchers(p_repair) RPC
 * (migration 067). Output: everything the handler needs — the public
 * response (minimal by design: the endpoint is an unauthenticated probe,
 * so mismatch DETAILS stay in the structured server log, never the body)
 * and the log line to write.
 *
 * Contract with .github/workflows/uptime.yml: the probe greps the body for
 * `"clean":true` — any open mismatch flips clean to false and fails the
 * workflow, which is the operator's pager (GitHub's failure email), same
 * as every other probe in that file. Auto-repaired rows do NOT fail the
 * probe (the incident is already resolved) but are logged and surfaced in
 * the body as `repaired`.
 */

export interface ReconcilePlan {
  /** HTTP status for the public response. */
  status: number;
  /** Public response body — deliberately free of order/voucher ids. */
  body: { ok: boolean; clean: boolean; repaired: number };
  /** Structured log to write; null when there is nothing worth a line. */
  log: { severity: 'warn' | 'error' | 'fatal'; message: string } | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Decide the public response + log line for one reconciliation run.
 * Never throws — a malformed RPC result degrades to a failed probe
 * (ok:false), which is the fail-loud direction.
 */
export function planReconcileResponse(
  rpcData: unknown,
  rpcError: { message?: string } | null,
): ReconcilePlan {
  if (rpcError) {
    return {
      status: 503,
      body: { ok: false, clean: false, repaired: 0 },
      log: {
        severity: 'error',
        message: `reconcile_reward_vouchers RPC failed: ${rpcError.message ?? 'unknown error'}`,
      },
    };
  }

  const summary = asRecord(rpcData);
  if (!summary || summary.ok !== true) {
    return {
      status: 503,
      body: { ok: false, clean: false, repaired: 0 },
      log: { severity: 'error', message: 'reconcile_reward_vouchers returned a malformed summary' },
    };
  }

  const mismatches = asCount(summary.mismatches);
  const repaired = asCount(summary.repaired);

  if (mismatches > 0) {
    return {
      status: 200,
      body: { ok: true, clean: false, repaired },
      log: {
        severity: 'fatal',
        message:
          `Reward reconciliation found ${mismatches} open mismatch${mismatches === 1 ? '' : 'es'} ` +
          `needing a human (repaired ${repaired} automatically) — see summary in ctx`,
      },
    };
  }

  if (repaired > 0) {
    return {
      status: 200,
      body: { ok: true, clean: true, repaired },
      log: {
        severity: 'warn',
        message: `Reward reconciliation auto-repaired ${repaired} missing reward row${repaired === 1 ? '' : 's'} (crash-window incident occurred and was healed)`,
      },
    };
  }

  return { status: 200, body: { ok: true, clean: true, repaired: 0 }, log: null };
}
