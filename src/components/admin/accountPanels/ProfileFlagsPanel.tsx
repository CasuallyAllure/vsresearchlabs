/**
 * ProfileFlagsPanel — tier / status / account_type / business_name /
 * free_shipping, saved atomically via admin_set_profile_flags (043/049).
 *
 * Shared by the customer-detail page and the /admin/members rows. Behaviour is
 * unchanged from the original CustomerAccountPanels — this is a pure extraction.
 */

import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Badge, InlineError, InlineSuccess, Label, PanelCaption, SubmitButton } from './atoms';
import {
  NOT_MIGRATED_NOTE, inputCls, isMissingBackend,
  type AccountType, type ConfirmFn, type ProfileRow, type ProfileStatus, type ProfileTier,
} from './shared';

interface ProfileFlagsPanelProps {
  profile: ProfileRow;
  contact: string;
  confirm: ConfirmFn;
  onSaved: () => void;
}

export function ProfileFlagsPanel({ profile, contact, confirm, onSaved }: ProfileFlagsPanelProps) {
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
