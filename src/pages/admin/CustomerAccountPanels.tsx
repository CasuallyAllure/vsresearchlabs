/**
 * CustomerAccountPanels
 *
 * "Linked account" section for AdminCustomerDetail. When a portal profile
 * (customer_profiles, migration 028/043) is soft-linked to this CRM customer
 * (customer_profiles.customer_id), renders three admin panels:
 *
 *   1. Profile flags — tier / status / account_type / business_name, edited
 *      atomically via admin_set_profile_flags (043).
 *   2. Rewards — reward_ledger balance + recent entries, manual credit/debit
 *      via admin_adjust_reward_points (044).
 *   3. Discounts — customer_discounts rules, set via
 *      admin_set_customer_discount, soft-off via
 *      admin_deactivate_customer_discount (045).
 *
 * Migrations 043–045 are NOT applied to prod yet: every query/RPC failure
 * that looks like a missing table/column/function renders a calm
 * "backend not migrated" note instead of crashing.
 *
 * No window.confirm/prompt — those silently no-op on the owner's iPhone
 * after "Block Alerts"; all confirmations go through useConfirm/ConfirmModal.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useConfirm } from '../../components/admin/ConfirmModal';
import { Button } from '../../components/ui/Button';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../components/ui/Field';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';

// ── Domain types ─────────────────────────────────────────────────────────────

type ProfileTier = 'member' | 'pro';
type ProfileStatus = 'active' | 'waitlisted' | 'suspended';
type AccountType = 'individual' | 'business';

interface ProfileRow {
  user_id: string;
  full_name: string;
  tier: ProfileTier;
  status: ProfileStatus;
  account_type: AccountType;
  business_name: string | null;
  free_shipping: boolean;
}

interface RewardEntry {
  kind: 'earn' | 'reversal' | 'adjustment';
  points: number;
  note: string | null;
  created_at: string;
  order_id: string | null;
}

interface DiscountRow {
  id: string;
  scope: 'lifetime' | 'business';
  percent: number;
  label: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

const RECENT_REWARD_ENTRIES = 10;

// ── Shared helpers ───────────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/**
 * True when the failure smells like migrations 043–045 not being applied:
 * undefined table (42P01), undefined column (42703), or PostgREST's
 * missing-function code (PGRST202).
 */
function isMissingBackend(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42P01' || code === '42703' || code === 'PGRST202') return true;
  const msg = getErrorMessage(error);
  return /does not exist|could not find the function|schema cache/i.test(msg);
}

const NOT_MIGRATED_NOTE =
  'Portal backend not migrated yet — apply migrations 043–045 (and 049 for free shipping) to enable this panel.';

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtSignedPoints(points: number): string {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

/** Active AND not past its expiry (module-scope so render stays pure). */
function isLiveDiscount(row: DiscountRow): boolean {
  if (!row.active) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

// ── Shared UI atoms (AdminCoupons house style) ───────────────────────────────

const inputCls = [
  FIELD_SURFACE,
  FIELD_DEFAULT,
  'mb-[var(--space-3)] disabled:opacity-40 disabled:cursor-not-allowed',
].join(' ');

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-2)]">{children}</label>;
}

function PanelCaption({ children }: { children: React.ReactNode }) {
  return <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">{children}</p>;
}

function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
      {children}
    </Button>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mb-[var(--space-3)] text-[12px] text-red-400">{children}</p>;
}

function InlineSuccess({ children }: { children: React.ReactNode }) {
  return <p className="mb-[var(--space-3)] text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-status-success)]">{children}</p>;
}

function MutedNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink/40">{children}</p>;
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

// ── Section root ─────────────────────────────────────────────────────────────

interface CustomerAccountPanelsProps {
  /** CRM customers.id — matched against customer_profiles.customer_id. */
  customerId: string;
  /** CRM contact (email) — shown as identity context next to the profile. */
  customerContact: string;
}

type SectionState = 'loading' | 'none' | 'ready' | 'unmigrated' | 'error';

export function CustomerAccountPanels({ customerId, customerContact }: CustomerAccountPanelsProps) {
  const { confirm, modal } = useConfirm();
  const [state, setState] = useState<SectionState>('loading');
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const reload = () => setReloadCounter((c) => c + 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setState('error');
        setLoadError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('user_id, full_name, tier, status, account_type, business_name, free_shipping')
        .eq('customer_id', customerId)
        .limit(1);
      if (cancelled) return;
      if (error) {
        if (isMissingBackend(error)) {
          setState('unmigrated');
        } else {
          setState('error');
          setLoadError(error.message);
        }
        return;
      }
      const row = (data ?? [])[0] as ProfileRow | undefined;
      if (!row) {
        setState('none');
        setProfile(null);
        return;
      }
      setProfile(row);
      setState('ready');
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadCounter]);

  return (
    <section className="mb-[var(--space-8)]">
      <PanelCaption>Linked portal account</PanelCaption>

      {state === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {state === 'none' && <MutedNote>No portal account linked.</MutedNote>}

      {state === 'unmigrated' && <MutedNote>{NOT_MIGRATED_NOTE}</MutedNote>}

      {state === 'error' && loadError && <InlineError>{loadError}</InlineError>}

      {state === 'ready' && profile && (
        <div className="flex flex-col gap-[var(--space-5)]">
          <ProfileFlagsPanel
            profile={profile}
            contact={customerContact}
            confirm={confirm}
            onSaved={reload}
          />
          <RewardsPanel userId={profile.user_id} confirm={confirm} />
          <DiscountsPanel userId={profile.user_id} accountType={profile.account_type} confirm={confirm} />
        </div>
      )}

      {modal}
    </section>
  );
}

type ConfirmFn = (
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string },
) => Promise<boolean>;

// ── Panel 1: Profile flags ───────────────────────────────────────────────────

interface ProfileFlagsPanelProps {
  profile: ProfileRow;
  contact: string;
  confirm: ConfirmFn;
  onSaved: () => void;
}

function ProfileFlagsPanel({ profile, contact, confirm, onSaved }: ProfileFlagsPanelProps) {
  const [tier, setTier] = useState<ProfileTier>(profile.tier);
  const [status, setStatus] = useState<ProfileStatus>(profile.status);
  const [accountType, setAccountType] = useState<AccountType>(profile.account_type);
  const [businessName, setBusinessName] = useState(profile.business_name ?? '');
  const [freeShipping, setFreeShipping] = useState(profile.free_shipping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty =
    tier !== profile.tier ||
    status !== profile.status ||
    accountType !== profile.account_type ||
    (accountType === 'business' ? businessName.trim() : '') !== (profile.business_name ?? '') ||
    freeShipping !== profile.free_shipping;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !supabase) return;
    setError(null);
    setSuccess(null);

    if (accountType === 'business' && businessName.trim() === '') {
      setError('Business accounts need a business name.');
      return;
    }

    const ok = await confirm(
      `Set profile flags for ${profile.full_name}: tier ${tier}, status ${status}, ${accountType}${accountType === 'business' ? ` (${businessName.trim()})` : ''}${freeShipping ? ', free shipping' : ''}?`,
      { confirmLabel: 'Save flags' },
    );
    if (!ok) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_set_profile_flags', {
      p_user_id: profile.user_id,
      p_tier: tier,
      p_status: status,
      p_account_type: accountType,
      p_business_name: accountType === 'business' ? businessName.trim() : null,
      p_free_shipping: freeShipping,
    });
    setBusy(false);
    if (rpcError) {
      setError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    setSuccess('Profile flags saved.');
    onSaved();
  }

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <PanelCaption>Profile flags</PanelCaption>

      <div className="mb-[var(--space-4)]">
        <p className="text-[13px] text-ink">{profile.full_name}</p>
        <p className="font-mono text-[11px] text-ink/55">{contact}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={profile.tier === 'pro' ? 'good' : 'neutral'}>{profile.tier}</Badge>
          <Badge tone={profile.status === 'active' ? 'good' : profile.status === 'suspended' ? 'warn' : 'neutral'}>
            {profile.status}
          </Badge>
          <Badge>{profile.account_type}</Badge>
          {profile.business_name && <Badge>{profile.business_name}</Badge>}
          {profile.free_shipping && <Badge tone="good">free shipping</Badge>}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-x-[var(--space-3)] sm:grid-cols-3">
          <div>
            <Label>Tier</Label>
            <select value={tier} onChange={(e) => setTier(e.target.value as ProfileTier)} className={inputCls}>
              <option value="member">Member</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ProfileStatus)} className={inputCls}>
              <option value="active">Active</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div>
            <Label>Account type</Label>
            <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)} className={inputCls}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </select>
          </div>
        </div>

        <Label>Business name{accountType !== 'business' && ' (business accounts only)'}</Label>
        <input
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          disabled={accountType !== 'business'}
          placeholder={accountType === 'business' ? 'Acme Research LLC' : '—'}
          className={inputCls}
        />

        <label className="mb-[var(--space-3)] flex items-center gap-2 text-[12px] text-ink/75">
          <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} />
          Free shipping (lifetime)
        </label>

        {error && <InlineError>{error}</InlineError>}
        {success && <InlineSuccess>{success}</InlineSuccess>}

        <div className="flex items-center justify-end">
          <SubmitButton disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save flags'}</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ── Panel 2: Rewards ─────────────────────────────────────────────────────────

interface RewardsPanelProps {
  userId: string;
  confirm: ConfirmFn;
}

function RewardsPanel({ userId, confirm }: RewardsPanelProps) {
  const [entries, setEntries] = useState<RewardEntry[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'unmigrated' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const [pointsDraft, setPointsDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setLoadState('error');
        setLoadError('Backend not configured.');
        return;
      }
      const { data, error } = await supabase
        .from('reward_ledger')
        .select('kind, points, note, created_at, order_id')
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
      setEntries((data ?? []) as RewardEntry[]);
      setLoadState('ready');
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshCounter]);

  const balance = (entries ?? []).reduce((sum, e) => sum + e.points, 0);
  const recent = (entries ?? []).slice(0, RECENT_REWARD_ENTRIES);

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !supabase) return;
    setFormError(null);
    setFormSuccess(null);

    const points = Number(pointsDraft);
    if (!Number.isInteger(points) || points === 0) {
      setFormError('Points must be a non-zero whole number (negative to debit).');
      return;
    }
    const note = noteDraft.trim();
    if (note === '') {
      setFormError('A note is required for manual adjustments.');
      return;
    }

    const ok = await confirm(
      `Adjust reward balance by ${fmtSignedPoints(points)} points? Note: "${note}"`,
      { confirmLabel: 'Adjust points' },
    );
    if (!ok) return;

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_adjust_reward_points', {
      p_user_id: userId,
      p_points: points,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setFormError(isMissingBackend(rpcError) ? NOT_MIGRATED_NOTE : rpcError.message);
      return;
    }
    setPointsDraft('');
    setNoteDraft('');
    setFormSuccess('Adjustment recorded.');
    setRefreshCounter((c) => c + 1);
  }

  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <PanelCaption>Rewards</PanelCaption>

      {loadState === 'loading' && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}
      {loadState === 'unmigrated' && <MutedNote>{NOT_MIGRATED_NOTE}</MutedNote>}
      {loadState === 'error' && loadError && <InlineError>{loadError}</InlineError>}

      {loadState === 'ready' && entries && (
        <>
          <div className="mb-[var(--space-4)]">
            <p className="text-[10px] uppercase tracking-[0.2em] text-ink/40 mb-1">Balance</p>
            <p className="font-mono text-[18px] tabular-nums text-ink">{balance} pts</p>
          </div>

          {recent.length === 0 ? (
            <MutedNote>No reward activity yet.</MutedNote>
          ) : (
            <ul className="mb-[var(--space-4)] divide-y divide-ink/[0.04] border-y border-ink/[0.06]">
              {recent.map((entry, i) => (
                <li key={`${entry.created_at}-${i}`} className="py-[var(--space-2)] flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-0.5">
                  <span className={`font-mono text-[12px] tabular-nums w-[52px] shrink-0 ${entry.points > 0 ? 'text-[color:var(--color-status-success)]' : 'text-red-400/80'}`}>
                    {fmtSignedPoints(entry.points)}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-ink/45 w-[80px] shrink-0">{entry.kind}</span>
                  <span className="font-mono text-[10.5px] text-ink/40 tabular-nums shrink-0">{fmtDateShort(entry.created_at)}</span>
                  {entry.note && <span className="min-w-0 w-full text-[11.5px] text-ink/60 sm:w-auto sm:flex-1">{entry.note}</span>}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdjust}>
            <div className="grid grid-cols-1 gap-x-[var(--space-3)] sm:grid-cols-[140px_1fr]">
              <div>
                <Label>Points (±)</Label>
                <input
                  type="number"
                  step="1"
                  value={pointsDraft}
                  onChange={(e) => setPointsDraft(e.target.value)}
                  placeholder="-25"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Note (required)</Label>
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Goodwill credit for shipping delay"
                  className={inputCls}
                />
              </div>
            </div>

            {formError && <InlineError>{formError}</InlineError>}
            {formSuccess && <InlineSuccess>{formSuccess}</InlineSuccess>}

            <div className="flex items-center justify-end">
              <SubmitButton disabled={busy}>{busy ? 'Adjusting…' : 'Adjust points'}</SubmitButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ── Panel 3: Discounts ───────────────────────────────────────────────────────

interface DiscountsPanelProps {
  userId: string;
  accountType: AccountType;
  confirm: ConfirmFn;
}

function DiscountsPanel({ userId, accountType, confirm }: DiscountsPanelProps) {
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
