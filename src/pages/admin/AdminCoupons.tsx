/**
 * AdminCoupons
 *
 * Discount-code + affiliate + commission-ledger control center (migration
 * 031_coupons_affiliates.sql). Three tabs:
 *
 *   Codes       — create/list/toggle/delete coupons (percent, fixed, free_item)
 *   Affiliates  — create/list affiliates + their codes + earned commission
 *   Commissions — the payout ledger (coupon_redemptions), filter/mark paid/void
 *
 * All three tables are RLS'd for the authenticated admin (select/insert/
 * update/delete on coupons + affiliates; select/update only on
 * coupon_redemptions — rows are created by the place-order Edge Function).
 *
 * No window.confirm/alert/prompt — those silently no-op on the owner's
 * iPhone after "Block Alerts". Every destructive or state-changing action
 * routes through the in-page ConfirmModal below.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import { Button } from '../../components/ui/Button';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../components/ui/Field';

// ── Domain types ─────────────────────────────────────────────────────────────

type CouponKind = 'percent' | 'fixed' | 'free_item';
type CommissionStatus = 'none' | 'pending' | 'paid' | 'void';

interface CouponRow {
  id: string;
  code: string;
  kind: CouponKind;
  percent: number | null;
  amount_cents: number | null;
  free_sku: string | null;
  free_dose: string | null;
  free_label: string | null;
  min_subtotal_cents: number;
  max_uses: number | null;
  used_count: number;
  once_per_contact: boolean;
  requires_account: boolean;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  affiliate_id: string | null;
  commission_percent: number | null;
  created_at: string;
  updated_at: string;
}

interface AffiliateRow {
  id: string;
  name: string;
  contact: string | null;
  default_commission_percent: number;
  active: boolean;
  notes: string | null;
  created_at: string;
}

interface RedemptionRow {
  id: string;
  coupon_id: string;
  order_id: string | null;
  affiliate_id: string | null;
  code: string;
  buyer_contact: string | null;
  discount_cents: number;
  order_net_cents: number;
  commission_cents: number;
  commission_status: CommissionStatus;
  created_at: string;
}

type TabKey = 'codes' | 'affiliates' | 'commissions';

const TABS: Array<{ value: TabKey; label: string }> = [
  { value: 'codes', label: 'Codes' },
  { value: 'affiliates', label: 'Affiliates' },
  { value: 'commissions', label: 'Commissions' },
];

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtUSD(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExpired(row: CouponRow): boolean {
  return !!row.expires_at && new Date(row.expires_at).getTime() < Date.now();
}

function valueSummary(row: CouponRow): string {
  if (row.kind === 'percent') return `${row.percent ?? 0}% off`;
  if (row.kind === 'fixed') return `${fmtUSD(row.amount_cents)} off`;
  return `Free — ${row.free_label ?? row.free_sku ?? 'item'}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

// ── In-page confirm modal (no window.confirm — see file header) ────────────

interface ConfirmState {
  message: string;
  danger?: boolean;
  onConfirm: () => void;
}

function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  function confirm(message: string, onConfirm: () => void, danger = false) {
    setState({ message, onConfirm, danger });
  }

  const modal = state && (
    <>
      <div aria-hidden="true" onClick={() => setState(null)} className="fixed inset-0 z-50 bg-[color:var(--scrim)] backdrop-blur-[3px]" />
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[400px] research-surface-solid p-[var(--space-6)]">
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">Confirm</p>
          <p className="text-[13px] leading-relaxed text-ink/85 mb-[var(--space-6)]">{state.message}</p>
          <div className="flex items-center justify-end gap-[var(--space-3)]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setState(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { const fn = state.onConfirm; setState(null); fn(); }}
              className={state.danger ? 'border-red-400/40 bg-red-400/[0.08] text-red-300/90 hover:bg-red-400/[0.15] hover:border-red-400/55' : undefined}
            >
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  return { confirm, modal };
}

// ── Shared field styling ─────────────────────────────────────────────────────

const inputCls = [FIELD_SURFACE, FIELD_DEFAULT, 'mb-[var(--space-3)]'].join(' ');

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]">{children}</label>;
}

function ActionButton({
  children, onClick, disabled, danger, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="button"
      variant={danger ? 'ghost' : 'secondary'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={danger ? 'border border-red-400/35 text-red-400/80 hover:bg-red-400/[0.06] hover:border-red-400/55 hover:text-red-400/80' : undefined}
    >
      {children}
    </Button>
  );
}

function ToolButton({
  children, onClick, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'good' }) {
  const cls =
    tone === 'good' ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    tone === 'warn' ? 'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]' :
                       'border-ink/15 text-ink/60 bg-ink/[0.03]';
  return (
    <span className={`${CHIP_BASE} ${cls}`}>
      {children}
    </span>
  );
}

// ── Top-level page ───────────────────────────────────────────────────────────

export function AdminCoupons() {
  const [tab, setTab] = useState<TabKey>('codes');
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refresh = () => setRefreshCounter((c) => c + 1);

  const [coupons, setCoupons] = useState<CouponRow[] | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateRow[] | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { confirm, modal } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      setError(null);
      const [couponsRes, affiliatesRes, redemptionsRes] = await Promise.all([
        supabase
          .from('coupons')
          .select('id, code, kind, percent, amount_cents, free_sku, free_dose, free_label, min_subtotal_cents, max_uses, used_count, once_per_contact, requires_account, starts_at, expires_at, active, affiliate_id, commission_percent, created_at, updated_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('affiliates')
          .select('id, name, contact, default_commission_percent, active, notes, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('coupon_redemptions')
          .select('id, coupon_id, order_id, affiliate_id, code, buyer_contact, discount_cents, order_net_cents, commission_cents, commission_status, created_at')
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);
      if (cancelled) return;
      const firstError = couponsRes.error ?? affiliatesRes.error ?? redemptionsRes.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setCoupons((couponsRes.data ?? []) as CouponRow[]);
      setAffiliates((affiliatesRes.data ?? []) as AffiliateRow[]);
      setRedemptions((redemptionsRes.data ?? []) as RedemptionRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshCounter]);

  const loading = coupons === null && affiliates === null && redemptions === null && !error;

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Coupons</h2>
        </div>
        <div className="inline-flex w-fit items-center gap-0.5 rounded-full border border-ink/[0.12] bg-ink/[0.03] p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-current={tab === t.value ? 'page' : undefined}
              className={[
                'inline-flex min-h-[40px] items-center rounded-full px-[var(--space-4)] text-[10px] uppercase tracking-[0.18em] transition-colors',
                tab === t.value
                  ? 'bg-display text-ink shadow-[0_1px_3px_-1px_rgba(26,23,20,0.25)]'
                  : 'text-ink/45 hover:text-ink',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {loading && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {!error && !loading && tab === 'codes' && (
        <CodesTab
          coupons={coupons ?? []}
          affiliates={affiliates ?? []}
          onChanged={refresh}
          confirm={confirm}
        />
      )}

      {!error && !loading && tab === 'affiliates' && (
        <AffiliatesTab
          affiliates={affiliates ?? []}
          coupons={coupons ?? []}
          redemptions={redemptions ?? []}
          onChanged={refresh}
        />
      )}

      {!error && !loading && tab === 'commissions' && (
        <CommissionsTab
          redemptions={redemptions ?? []}
          affiliates={affiliates ?? []}
          onChanged={refresh}
          confirm={confirm}
        />
      )}

      {modal}
    </AdminLayout>
  );
}

// ── Tab 1: Codes ─────────────────────────────────────────────────────────────

interface CodesTabProps {
  coupons: CouponRow[];
  affiliates: AffiliateRow[];
  onChanged: () => void;
  confirm: (message: string, onConfirm: () => void, danger?: boolean) => void;
}

function CodesTab({ coupons, affiliates, onChanged, confirm }: CodesTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const affiliateName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of affiliates) m.set(a.id, a.name);
    return m;
  }, [affiliates]);

  async function toggleActive(row: CouponRow) {
    if (!supabase) return;
    setBusyId(row.id);
    setRowError(null);
    const { error } = await supabase.from('coupons').update({ active: !row.active }).eq('id', row.id);
    setBusyId(null);
    if (error) {
      setRowError(error.message);
      return;
    }
    onChanged();
  }

  async function doDelete(row: CouponRow) {
    if (!supabase) return;
    setBusyId(row.id);
    setRowError(null);
    const { error } = await supabase.from('coupons').delete().eq('id', row.id);
    setBusyId(null);
    if (error) {
      const isFkViolation = error.code === '23503' || /foreign key/i.test(error.message);
      setRowError(
        isFkViolation
          ? `${row.code} has redemptions on record and can't be deleted. Deactivate it instead.`
          : error.message,
      );
      return;
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink/45">{coupons.length} code{coupons.length === 1 ? '' : 's'}</p>
        <ToolButton onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : '+ New code'}</ToolButton>
      </div>

      {rowError && <p role="alert" className="text-[12px] text-red-400">{rowError}</p>}

      {showForm && (
        <NewCouponForm
          affiliates={affiliates}
          onCreated={() => { setShowForm(false); onChanged(); }}
        />
      )}

      {coupons.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">No coupon codes yet. Create one above.</p>
        </div>
      )}

      {coupons.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {coupons.map((row) => {
            const expired = isExpired(row);
            const busy = busyId === row.id;
            return (
              <li key={row.id} className="p-[var(--space-4)] sm:px-[var(--space-5)]">
                <div className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-[13px] text-ink tracking-[0.04em]">{row.code}</span>
                      <Badge tone={row.active && !expired ? 'good' : 'neutral'}>
                        {row.active ? (expired ? 'expired' : 'active') : 'inactive'}
                      </Badge>
                      {row.once_per_contact && <Badge>1 / contact</Badge>}
                      {row.requires_account && <Badge>Members</Badge>}
                      {row.affiliate_id && (
                        <Badge>{affiliateName.get(row.affiliate_id) ?? 'affiliate'}</Badge>
                      )}
                    </div>
                    <p className="text-[12.5px] text-ink/80 mb-1">{valueSummary(row)}</p>
                    <p className="font-mono text-[10.5px] text-ink/45 tabular-nums">
                      used {row.used_count} / {row.max_uses ?? '∞'}
                      {row.min_subtotal_cents > 0 && <> · min {fmtUSD(row.min_subtotal_cents)}</>}
                      {(row.starts_at || row.expires_at) && (
                        <>
                          {' · '}
                          {row.starts_at ? fmtDateShort(row.starts_at) : 'open'}
                          {' → '}
                          {row.expires_at ? fmtDateShort(row.expires_at) : 'open'}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ActionButton onClick={() => toggleActive(row)} disabled={busy} title={row.active ? 'Deactivate' : 'Activate'}>
                      {row.active ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                    <ActionButton
                      danger
                      disabled={busy}
                      title="Delete"
                      onClick={() =>
                        confirm(
                          `Delete code ${row.code}? This can't be undone.`,
                          () => doDelete(row),
                          true,
                        )
                      }
                    >
                      Delete
                    </ActionButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface NewCouponFormProps {
  affiliates: AffiliateRow[];
  onCreated: () => void;
}

function NewCouponForm({ affiliates, onCreated }: NewCouponFormProps) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<CouponKind>('percent');
  const [percent, setPercent] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [freeSku, setFreeSku] = useState('');
  const [freeDose, setFreeDose] = useState('');
  const [freeLabel, setFreeLabel] = useState('');
  const [minSubtotalUsd, setMinSubtotalUsd] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [oncePerContact, setOncePerContact] = useState(false);
  const [requiresAccount, setRequiresAccount] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [affiliateId, setAffiliateId] = useState<string>('');
  const [commissionPercent, setCommissionPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    const upper = code.trim().toUpperCase();
    if (upper.length < 3) return 'Code must be at least 3 characters.';
    if (kind === 'percent') {
      const p = Number(percent);
      if (!Number.isFinite(p) || p < 1 || p > 100) return 'Percent must be between 1 and 100.';
    }
    if (kind === 'fixed') {
      const cents = Math.round(parseFloat(amountUsd || '0') * 100);
      if (!Number.isFinite(cents) || cents <= 0) return 'Amount must be greater than $0.';
    }
    if (kind === 'free_item') {
      if (!freeSku.trim()) return 'Free item needs a SKU.';
      if (!freeLabel.trim()) return 'Free item needs a label.';
    }
    if (commissionPercent.trim() !== '') {
      const cp = Number(commissionPercent);
      if (!Number.isFinite(cp) || cp < 0 || cp > 100) return 'Commission override must be between 0 and 100.';
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !supabase) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);

    const minSubtotalCents = minSubtotalUsd.trim() === '' ? 0 : Math.round(parseFloat(minSubtotalUsd) * 100);
    const maxUsesValue = maxUses.trim() === '' ? null : Math.round(Number(maxUses));

    const payload = {
      code: code.trim().toUpperCase(),
      kind,
      percent: kind === 'percent' ? Math.round(Number(percent)) : null,
      amount_cents: kind === 'fixed' ? Math.round(parseFloat(amountUsd) * 100) : null,
      free_sku: kind === 'free_item' ? freeSku.trim() : null,
      free_dose: kind === 'free_item' ? (freeDose.trim() || null) : null,
      free_label: kind === 'free_item' ? freeLabel.trim() : null,
      min_subtotal_cents: minSubtotalCents,
      max_uses: maxUsesValue,
      once_per_contact: oncePerContact,
      requires_account: requiresAccount,
      starts_at: startsAt.trim() === '' ? null : new Date(startsAt).toISOString(),
      expires_at: expiresAt.trim() === '' ? null : new Date(expiresAt).toISOString(),
      affiliate_id: affiliateId === '' ? null : affiliateId,
      commission_percent: commissionPercent.trim() === '' ? null : Math.round(Number(commissionPercent)),
    };

    const { error } = await supabase.from('coupons').insert(payload);
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="research-surface-solid p-[var(--space-5)]">
      <Label>Code</Label>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="SUMMER25"
        className={`${inputCls} font-mono uppercase`}
      />

      <Label>Kind</Label>
      <select value={kind} onChange={(e) => setKind(e.target.value as CouponKind)} className={inputCls}>
        <option value="percent">Percent off</option>
        <option value="fixed">Fixed amount off</option>
        <option value="free_item">Free item</option>
      </select>

      {kind === 'percent' && (
        <>
          <Label>Percent off</Label>
          <input type="number" min="1" max="100" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="20" className={inputCls} />
        </>
      )}

      {kind === 'fixed' && (
        <>
          <Label>Amount off (USD)</Label>
          <input type="number" step="0.01" min="0.01" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="15.00" className={inputCls} />
        </>
      )}

      {kind === 'free_item' && (
        <>
          <Label>Free item SKU</Label>
          <input type="text" value={freeSku} onChange={(e) => setFreeSku(e.target.value)} placeholder="VSR-RS-BAC-030" className={`${inputCls} font-mono`} />
          <Label>Dose (optional)</Label>
          <input type="text" value={freeDose} onChange={(e) => setFreeDose(e.target.value)} placeholder="10 mL" className={inputCls} />
          <Label>Label</Label>
          <input type="text" value={freeLabel} onChange={(e) => setFreeLabel(e.target.value)} placeholder="Bacteriostatic Water — 10 mL" className={inputCls} />
        </>
      )}

      <Label>Minimum subtotal (USD, optional)</Label>
      <input type="number" step="0.01" min="0" value={minSubtotalUsd} onChange={(e) => setMinSubtotalUsd(e.target.value)} placeholder="0.00" className={inputCls} />

      <Label>Max uses (blank = unlimited)</Label>
      <input type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" className={inputCls} />

      <label className="mb-[var(--space-3)] flex items-center gap-2 text-[12px] text-ink/75">
        <input type="checkbox" checked={oncePerContact} onChange={(e) => setOncePerContact(e.target.checked)} />
        Once per contact
      </label>

      <label className="mb-1 flex items-center gap-2 text-[12px] text-ink/75">
        <input type="checkbox" checked={requiresAccount} onChange={(e) => setRequiresAccount(e.target.checked)} />
        Members only (requires account)
      </label>
      <p className="mb-[var(--space-3)] text-[11px] text-ink/45">
        Only signed-in account holders can redeem.
      </p>

      <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
        <div>
          <Label>Starts (optional)</Label>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
        </div>
        <div>
          <Label>Expires (optional)</Label>
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
        </div>
      </div>

      <Label>Affiliate (optional)</Label>
      <select value={affiliateId} onChange={(e) => setAffiliateId(e.target.value)} className={inputCls}>
        <option value="">— none —</option>
        {affiliates.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      {affiliateId !== '' && (
        <>
          <Label>Commission % override (blank = affiliate default)</Label>
          <input type="number" min="0" max="100" value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} placeholder="Affiliate default" className={inputCls} />
        </>
      )}

      {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

      <div className="flex items-center justify-end">
        <Button type="submit" variant="secondary" size="sm" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create code'}
        </Button>
      </div>
    </form>
  );
}

// ── Tab 2: Affiliates ────────────────────────────────────────────────────────

interface AffiliateAggregate {
  totalUses: number;
  totalOrderNetCents: number;
  commissionPendingCents: number;
  commissionPaidCents: number;
}

interface AffiliatesTabProps {
  affiliates: AffiliateRow[];
  coupons: CouponRow[];
  redemptions: RedemptionRow[];
  onChanged: () => void;
}

function AffiliatesTab({ affiliates, coupons, redemptions, onChanged }: AffiliatesTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const aggregates = useMemo(() => {
    const m = new Map<string, AffiliateAggregate>();
    for (const r of redemptions) {
      if (!r.affiliate_id) continue;
      const agg = m.get(r.affiliate_id) ?? {
        totalUses: 0, totalOrderNetCents: 0, commissionPendingCents: 0, commissionPaidCents: 0,
      };
      agg.totalUses += 1;
      agg.totalOrderNetCents += r.order_net_cents;
      if (r.commission_status === 'pending') agg.commissionPendingCents += r.commission_cents;
      if (r.commission_status === 'paid') agg.commissionPaidCents += r.commission_cents;
      m.set(r.affiliate_id, agg);
    }
    return m;
  }, [redemptions]);

  const codesByAffiliate = useMemo(() => {
    const m = new Map<string, CouponRow[]>();
    for (const c of coupons) {
      if (!c.affiliate_id) continue;
      const list = m.get(c.affiliate_id) ?? [];
      list.push(c);
      m.set(c.affiliate_id, list);
    }
    return m;
  }, [coupons]);

  async function toggleActive(row: AffiliateRow) {
    if (!supabase) return;
    setBusyId(row.id);
    setRowError(null);
    const { error } = await supabase.from('affiliates').update({ active: !row.active }).eq('id', row.id);
    setBusyId(null);
    if (error) {
      setRowError(error.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink/45">{affiliates.length} affiliate{affiliates.length === 1 ? '' : 's'}</p>
        <ToolButton onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : '+ New affiliate'}</ToolButton>
      </div>

      {rowError && <p role="alert" className="text-[12px] text-red-400">{rowError}</p>}

      {showForm && <NewAffiliateForm onCreated={() => { setShowForm(false); onChanged(); }} />}

      {affiliates.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">No affiliates on file yet. Create one above.</p>
        </div>
      )}

      {affiliates.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {affiliates.map((row) => {
            const agg = aggregates.get(row.id);
            const codes = codesByAffiliate.get(row.id) ?? [];
            const busy = busyId === row.id;
            return (
              <li key={row.id} className="p-[var(--space-4)] sm:px-[var(--space-5)]">
                <div className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[13px] text-ink">{row.name}</span>
                      <Badge tone={row.active ? 'good' : 'neutral'}>{row.active ? 'active' : 'inactive'}</Badge>
                      <span className="font-mono text-[10.5px] text-ink/45">{row.default_commission_percent}% default</span>
                    </div>
                    {row.contact && <p className="font-mono text-[11px] text-ink/55 mb-1">{row.contact}</p>}
                    <p className="font-mono text-[10.5px] text-ink/45 tabular-nums">
                      {agg?.totalUses ?? 0} uses · {fmtUSD(agg?.totalOrderNetCents ?? 0)} net ·
                      {' '}pending {fmtUSD(agg?.commissionPendingCents ?? 0)} · paid {fmtUSD(agg?.commissionPaidCents ?? 0)}
                    </p>
                    {codes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {codes.map((c) => (
                          <span key={c.id} className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm border border-ink/15 text-ink/60 bg-ink/[0.03]">
                            {c.code}
                          </span>
                        ))}
                      </div>
                    )}
                    {row.notes && <p className="mt-2 text-[11.5px] text-ink/50 leading-relaxed">{row.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ActionButton onClick={() => toggleActive(row)} disabled={busy} title={row.active ? 'Deactivate' : 'Activate'}>
                      {row.active ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface NewAffiliateFormProps {
  onCreated: () => void;
}

const DEFAULT_COMMISSION_PERCENT = 10;

function NewAffiliateForm({ onCreated }: NewAffiliateFormProps) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [defaultCommission, setDefaultCommission] = useState(String(DEFAULT_COMMISSION_PERCENT));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !supabase) return;
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    const pct = Number(defaultCommission);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('Default commission must be between 0 and 100.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from('affiliates').insert({
      name: name.trim(),
      contact: contact.trim() || null,
      default_commission_percent: Math.round(pct),
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="research-surface-solid p-[var(--space-5)]">
      <Label>Name</Label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={inputCls} />
      <Label>Contact (optional)</Label>
      <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="email / handle" className={inputCls} />
      <Label>Default commission %</Label>
      <input type="number" min="0" max="100" value={defaultCommission} onChange={(e) => setDefaultCommission(e.target.value)} className={inputCls} />
      <Label>Notes (optional)</Label>
      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} resize-y`} />
      {error && <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{error}</p>}
      <div className="flex items-center justify-end">
        <Button type="submit" variant="secondary" size="sm" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create affiliate'}
        </Button>
      </div>
    </form>
  );
}

// ── Tab 3: Commissions ───────────────────────────────────────────────────────

type AffiliateFilter = 'all' | string;
type StatusFilter = 'all' | CommissionStatus;

interface CommissionsTabProps {
  redemptions: RedemptionRow[];
  affiliates: AffiliateRow[];
  onChanged: () => void;
  confirm: (message: string, onConfirm: () => void, danger?: boolean) => void;
}

function CommissionsTab({ redemptions, affiliates, onChanged, confirm }: CommissionsTabProps) {
  const [affiliateFilter, setAffiliateFilter] = useState<AffiliateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<string | null>(null);

  const affiliateName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of affiliates) m.set(a.id, a.name);
    return m;
  }, [affiliates]);

  const affiliateOptions = useMemo(
    () => [
      { value: 'all', label: 'All affiliates' },
      ...affiliates.map((a) => ({ value: a.id, label: a.name })),
    ],
    [affiliates],
  );

  const filtered = useMemo(() => {
    return redemptions.filter((r) => {
      if (affiliateFilter !== 'all' && r.affiliate_id !== affiliateFilter) return false;
      if (statusFilter !== 'all' && r.commission_status !== statusFilter) return false;
      return true;
    });
  }, [redemptions, affiliateFilter, statusFilter]);

  const totals = useMemo(() => {
    let pending = 0;
    let paid = 0;
    for (const r of filtered) {
      if (r.commission_status === 'pending') pending += r.commission_cents;
      if (r.commission_status === 'paid') paid += r.commission_cents;
    }
    return { pending, paid };
  }, [filtered]);

  const pendingRows = useMemo(() => filtered.filter((r) => r.commission_status === 'pending'), [filtered]);
  const bulkEligible = affiliateFilter !== 'all' && pendingRows.length > 0;

  async function updateStatus(ids: string[], status: CommissionStatus) {
    if (!supabase || ids.length === 0) return;
    setBusyIds((prev) => new Set([...prev, ...ids]));
    setRowError(null);
    const { error } = await supabase.from('coupon_redemptions').update({ commission_status: status }).in('id', ids);
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (error) {
      setRowError(getErrorMessage(error));
      return;
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:gap-[var(--space-3)]">
          <AdminFilterBar
            label="Affiliate"
            dense
            options={affiliateOptions}
            value={affiliateFilter}
            onChange={setAffiliateFilter}
          />
          <AdminFilterBar
            label="Status"
            dense
            options={[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'void', label: 'Void' },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
        {bulkEligible && (
          <ToolButton
            onClick={() =>
              confirm(
                `Mark ${pendingRows.length} pending commission${pendingRows.length === 1 ? '' : 's'} paid — total ${fmtUSD(pendingRows.reduce((s, r) => s + r.commission_cents, 0))}?`,
                () => updateStatus(pendingRows.map((r) => r.id), 'paid'),
              )
            }
          >
            Mark all pending paid — {fmtUSD(pendingRows.reduce((s, r) => s + r.commission_cents, 0))}
          </ToolButton>
        )}
      </div>

      <div className="research-surface-solid flex flex-wrap gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-4)]">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-ink/40 mb-1">Pending</p>
          <p className="font-mono text-[15px] tabular-nums text-ink">{fmtUSD(totals.pending)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-ink/40 mb-1">Paid</p>
          <p className="font-mono text-[15px] tabular-nums text-ink">{fmtUSD(totals.paid)}</p>
        </div>
      </div>

      {rowError && <p role="alert" className="text-[12px] text-red-400">{rowError}</p>}

      {filtered.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">No commission records match this filter.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="research-surface-solid rounded-[14px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-ink/[0.10]">
                  <th className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Date</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Code</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Buyer</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Order</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Order net</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Commission</th>
                  <th className="py-[var(--space-3)] px-[var(--space-3)] text-center text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Status</th>
                  <th className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/45 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const busy = busyIds.has(row.id);
                  return (
                    <tr key={row.id} className="border-b border-ink/[0.04] hover:bg-ink/[0.015] transition-colors">
                      <td className="py-[var(--space-3)] pl-[var(--space-4)] pr-[var(--space-3)] align-middle font-mono text-[11px] text-ink/60 whitespace-nowrap">
                        {fmtDateShort(row.created_at)}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle font-mono text-[11.5px] text-ink/80">{row.code}</td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-[11.5px] text-ink/70 truncate max-w-[160px]">{row.buyer_contact ?? '—'}</td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle">
                        {row.order_id ? (
                          <Link to={`/admin/orders/${row.order_id}`} className="text-[10.5px] uppercase tracking-[0.16em] text-ink/70 underline decoration-ink/20 hover:text-ink">
                            View
                          </Link>
                        ) : (
                          <span className="text-[11px] text-ink/30">—</span>
                        )}
                      </td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[11.5px] tabular-nums text-ink">{fmtUSD(row.order_net_cents)}</td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-right font-mono text-[11.5px] tabular-nums text-ink">{fmtUSD(row.commission_cents)}</td>
                      <td className="py-[var(--space-3)] px-[var(--space-3)] align-middle text-center">
                        <CommissionChip status={row.commission_status} />
                      </td>
                      <td className="py-[var(--space-3)] pl-[var(--space-3)] pr-[var(--space-4)] align-middle">
                        {row.commission_status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <ActionButton
                              disabled={busy}
                              title="Mark paid"
                              onClick={() =>
                                confirm(
                                  `Mark commission for ${row.code} (${fmtUSD(row.commission_cents)}) as paid?`,
                                  () => updateStatus([row.id], 'paid'),
                                )
                              }
                            >
                              Mark paid
                            </ActionButton>
                            <ActionButton
                              danger
                              disabled={busy}
                              title="Void"
                              onClick={() =>
                                confirm(
                                  `Void commission for ${row.code} (${fmtUSD(row.commission_cents)})?`,
                                  () => updateStatus([row.id], 'void'),
                                  true,
                                )
                              }
                            >
                              Void
                            </ActionButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] uppercase tracking-[0.16em] text-ink/30">
        {affiliateFilter !== 'all' ? affiliateName.get(affiliateFilter) ?? '' : ''}
      </p>
    </div>
  );
}

function CommissionChip({ status }: { status: CommissionStatus }) {
  const cls =
    status === 'paid'    ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    status === 'pending' ? 'border-ink/25 text-ink/70 bg-ink/[0.05]' :
    status === 'void'    ? 'border-ink/10 text-[color:var(--color-status-error)] bg-[color:var(--color-status-errorMuted)]' :
                            'border-ink/15 text-ink/40 bg-ink/[0.02]';
  return (
    <span className={`${CHIP_BASE} ${cls}`}>
      {status}
    </span>
  );
}
