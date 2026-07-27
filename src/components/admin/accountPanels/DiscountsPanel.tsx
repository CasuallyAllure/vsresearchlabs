/**
 * DiscountsPanel — customer_discounts rules, set via admin_set_customer_discount
 * and soft-off via admin_deactivate_customer_discount (045). The percent is the
 * only discount business logic and it lives in the RPC; this panel just
 * validates input and shows the current rules.
 *
 * Shared by the customer-detail page and the /admin/members rows. Pure
 * extraction from the original CustomerAccountPanels — behaviour unchanged.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Button } from '../../ui/Button';
import { Badge, InlineError, InlineSuccess, Label, MutedNote, PanelCaption, SubmitButton } from './atoms';
import {
  NOT_MIGRATED_NOTE, fmtDateShort, inputCls, isLiveDiscount, isMissingBackend,
  type AccountType, type ConfirmFn, type DiscountRow,
} from './shared';

interface DiscountsPanelProps {
  userId: string;
  accountType: AccountType;
  confirm: ConfirmFn;
}

export function DiscountsPanel({ userId, accountType, confirm }: DiscountsPanelProps) {
  const [rows, setRows] = useState<DiscountRow[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unmigrated' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refresh = () => setRefreshCounter((c) => c + 1);

  const [scope, setScope] = useState<'lifetime' | 'business'>('lifetime');
  const [percentDraft, setPercentDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [expiresDraft, setExpiresDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setLoadState('error');
        setLoadError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('customer_discounts')
        .select('id, scope, percent, label, active, expires_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        if (isMissingBackend(error)) setLoadState('unmigrated');
        else {
          setLoadState('error');
          setLoadError(error.message);
        }
        return;
      }
      setRows((data ?? []) as DiscountRow[]);
      setLoadState('ready');
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshCounter]);

  async function handleSet(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !supabase) return;
    setFormError(null);
    setFormSuccess(null);

    const percent = Math.round(parseFloat(percentDraft) * 100) / 100;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setFormError('Percent must be greater than 0 and at most 100.');
      return;
    }
    const label = labelDraft.trim();
    if (label === '') {
      setFormError('A label is required — it appears on invoices.');
      return;
    }
    if (scope === 'business' && accountType !== 'business') {
      setFormError('Business discounts require a business account profile.');
      return;
    }
    // End-of-day local so the discount stays valid through the chosen date.
    const expiresAtIso = expiresDraft.trim() === ''
      ? null
      : new Date(`${expiresDraft}T23:59:59`).toISOString();

    const ok = await confirm(
      `Set ${scope} discount to ${percent}% ("${label}")${expiresAtIso ? ` expiring ${fmtDateShort(expiresAtIso)}` : ''}? Any existing active ${scope} rule is replaced.`,
      { confirmLabel: 'Set discount' },
    );
    if (!ok) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_set_customer_discount', {
      p_user_id: userId,
      p_scope: scope,
      p_percent: percent,
      p_label: label,
      p_expires_at: expiresAtIso,
    });
    setBusy(false);
    if (rpcError) {
      setFormError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    setPercentDraft('');
    setLabelDraft('');
    setExpiresDraft('');
    setFormSuccess('Discount rule set.');
    refresh();
  }

  async function handleDeactivate(row: DiscountRow) {
    if (!supabase || busyRowId) return;
    setRowError(null);

    const ok = await confirm(
      `Deactivate ${row.scope} discount ${row.percent}% ("${row.label}")?`,
      { confirmLabel: 'Deactivate' },
    );
    if (!ok) return;

    setBusyRowId(row.id);
    const { error: rpcError } = await supabase.rpc('admin_deactivate_customer_discount', {
      p_id: row.id,
    });
    setBusyRowId(null);
    if (rpcError) {
      setRowError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    refresh();
  }

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <PanelCaption>Account discounts</PanelCaption>

      {loadState === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}
      {loadState === 'unmigrated' && <MutedNote>{NOT_MIGRATED_NOTE}</MutedNote>}
      {loadState === 'error' && loadError && <InlineError>{loadError}</InlineError>}

      {loadState === 'ready' && rows && (
        <>
          {rowError && <InlineError>{rowError}</InlineError>}

          {rows.length === 0 ? (
            <MutedNote>No discount rules on file.</MutedNote>
          ) : (
            <ul className="mb-[var(--space-4)] divide-y divide-ink/[0.04] border-y border-ink/[0.06]">
              {rows.map((row) => {
                const live = isLiveDiscount(row);
                return (
                  <li
                    key={row.id}
                    className={`py-[var(--space-3)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-1 ${live ? '' : 'opacity-55'}`}
                  >
                    <span className="font-mono text-[13px] tabular-nums text-ink w-[64px] shrink-0">{row.percent}%</span>
                    <Badge tone={live ? 'good' : 'neutral'}>{live ? 'active' : row.active ? 'expired' : 'inactive'}</Badge>
                    <Badge>{row.scope}</Badge>
                    <span className="min-w-0 w-full text-[12px] text-ink/70 sm:w-auto sm:flex-1">{row.label}</span>
                    <span className="font-mono text-[10.5px] text-ink/40 tabular-nums">
                      {row.expires_at ? `to ${fmtDateShort(row.expires_at)}` : 'no expiry'}
                    </span>
                    {live && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeactivate(row)}
                        disabled={busyRowId === row.id}
                        className="border border-red-400/35 text-red-400/80 hover:bg-red-400/[0.06] hover:border-red-400/55 hover:text-red-400/80"
                      >
                        Deactivate
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form onSubmit={handleSet}>
            <div className="grid grid-cols-1 gap-x-[var(--space-3)] sm:grid-cols-3">
              <div>
                <Label>Scope</Label>
                <select value={scope} onChange={(e) => setScope(e.target.value as 'lifetime' | 'business')} className={inputCls}>
                  <option value="lifetime">Lifetime</option>
                  <option value="business" disabled={accountType !== 'business'}>
                    Business{accountType !== 'business' ? ' — needs business account' : ''}
                  </option>
                </select>
              </div>
              <div>
                <Label>Percent</Label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  value={percentDraft}
                  onChange={(e) => setPercentDraft(e.target.value)}
                  placeholder="10"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Expires (optional)</Label>
                <input
                  type="date"
                  value={expiresDraft}
                  onChange={(e) => setExpiresDraft(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <Label>Label (shown on invoices)</Label>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="Lifetime 10%"
              className={inputCls}
            />

            {accountType !== 'business' && scope === 'business' && (
              <p className="mb-[var(--space-3)] text-[11px] text-ink/45">
                Business scope requires the profile's account type to be business (set it in Profile flags above).
              </p>
            )}

            {formError && <InlineError>{formError}</InlineError>}
            {formSuccess && <InlineSuccess>{formSuccess}</InlineSuccess>}

            <div className="flex items-center justify-end">
              <SubmitButton disabled={busy}>{busy ? 'Setting…' : 'Set discount'}</SubmitButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
