/**
 * RedemptionsView — the admin window into reward_vouchers that did not exist
 * before Phase 2. Lists every voucher with its member, status and consuming
 * order, and exposes the one new write verb: voiding an active voucher (with an
 * optional, audited points refund). Reuses the Members house-style atoms.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminFilterBar } from '../AdminFilterBar';
import { Button } from '../../../components/ui/Button';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../../components/ui/Field';
import { Chip, RowAction, Tile, type ChipTone } from './ui';
import { shortDate } from './format';
import {
  useVouchers, voidVoucher, type VoucherFilter, type VoucherRow, type VoucherStatus,
} from './useVouchers';

const STATUS_OPTIONS: Array<{ value: VoucherFilter; label: string }> = [
  { value: 'all', label: 'All vouchers' },
  { value: 'active', label: 'Active' },
  { value: 'used', label: 'Used' },
  { value: 'void', label: 'Voided' },
];

const STATUS_TONE: Record<VoucherStatus, ChipTone> = { active: 'info', used: 'neutral', void: 'warn' };

export function RedemptionsView() {
  const [filter, setFilter] = useState<VoucherFilter>('all');
  const { rows, total, summary, loading, error, unmigrated, reload } = useVouchers(filter);
  const [voiding, setVoiding] = useState<VoucherRow | null>(null);

  if (unmigrated) {
    return (
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="text-[13px] text-ink/55">
          Redemptions data layer not migrated yet — apply migration 073 to enable this view.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {/* Summary tiles */}
      <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
        <Tile emphasis label="Active" value={String(summary?.active ?? 0)} meta={['outstanding vouchers']} />
        <Tile label="Used" value={String(summary?.used ?? 0)} meta={['redeemed on an order']} />
        <Tile label="Voided" value={String(summary?.void ?? 0)} meta={['cancelled by admin']} />
        <Tile label="Points at stake" value={(summary?.outstandingPoints ?? 0).toLocaleString()} meta={['refundable if voided']} />
      </div>

      {/* Reconcile posture — the voucher↔order ledger is auto-checked every 15
          min by the uptime probe (migration 067). */}
      <p className="mb-[var(--space-4)] font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
        Voucher ledger auto-reconciled every 15 min · voiding an active voucher never creates drift
      </p>

      <div className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
        <AdminFilterBar label="" dense options={STATUS_OPTIONS} value={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {rows.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-1 px-[var(--space-5)] py-[var(--space-4)]">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] text-ink">
                  <span className="truncate">{v.memberName}</span>
                  <Chip tone={STATUS_TONE[v.status]}>{v.status}</Chip>
                </span>
                <span className="block truncate font-mono text-[11px] text-ink/55">{v.contact}</span>
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-ink/70">
                <span className="block">{v.percent}% off · {v.pointsSpent} pts</span>
                <span className="block text-[10px] text-ink/40">
                  issued {shortDate(v.createdIso)}
                  {v.status === 'used' && v.orderNumber && v.orderId && (
                    <> · <Link to={`/admin/orders/${v.orderId}`} className="text-holo-light/70 hover:text-holo">{v.orderNumber}</Link></>
                  )}
                  {v.status === 'void' && v.voidReason && <> · {v.voidReason}</>}
                </span>
              </span>
              {v.status === 'active' && (
                <RowAction danger onClick={() => setVoiding(v)}>Void</RowAction>
              )}
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
              No vouchers{filter !== 'all' ? ` with status “${filter}”` : ''} yet.
            </li>
          )}
          {rows.length > 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-3)] font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">
              Showing {rows.length} of {total}
            </li>
          )}
        </ul>
      )}

      {voiding && (
        <VoidVoucherDialog
          voucher={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => { setVoiding(null); reload(); }}
        />
      )}
    </div>
  );
}

/* ── Void dialog — reason required, refund optional (audited RPC) ──────────── */

function VoidVoucherDialog({ voucher, onClose, onDone }: { voucher: VoucherRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVoid() {
    if (reason.trim() === '') { setError('A reason is required.'); return; }
    setBusy(true);
    setError(null);
    const res = await voidVoucher(voucher.id, refund, reason.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone();
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" aria-label="Void voucher" className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[420px] research-surface-solid p-[var(--space-5)]">
          <p className="holo-text-caption mb-[var(--space-1)] text-[10px] uppercase tracking-[0.3em]">Void reward voucher</p>
          <p className="mb-[var(--space-4)] font-mono text-[11px] text-holo-light/70">
            {voucher.memberName} · {voucher.percent}% off · {voucher.pointsSpent} pts
          </p>

          <label className="mb-0.5 block text-[10px] uppercase tracking-[0.22em] text-ink/45">Reason (required)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. issued in error"
            className={`${FIELD_SURFACE} ${FIELD_DEFAULT} mb-[var(--space-3)]`}
          />

          <label className="mb-[var(--space-4)] flex items-center gap-2 text-[12px] text-ink/75">
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            Refund {voucher.pointsSpent} points to the member
          </label>

          {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-[var(--space-2)]">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" size="sm" onClick={handleVoid} disabled={busy}>
              {busy ? 'Voiding…' : 'Void voucher'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
