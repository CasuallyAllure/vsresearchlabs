/**
 * useAutomations — the Automations sub-view data source.
 *
 * Reads automation_settings (admin RLS select, migration 075) for the per-kind
 * enabled switches and admin_email_log for the sent history + per-kind counts.
 * The single write verb is admin_set_automation_kind (audited RPC). The stack
 * ships DARK — every kind is seeded disabled — and this hook only reports;
 * candidate evaluation and sending live server-side in the member-automations
 * edge function. Missing 075 degrades to `unmigrated` (calm note).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getErrorMessage, isMissingBackend } from './backend';

export type AutomationKind =
  | 'reward_ready'
  | 'invite_followup'
  | 'winback'
  | 'discount_expiry'
  | 'welcome';

export interface AutomationKindMeta {
  kind: AutomationKind;
  name: string;
  description: string;
}

/** Display order + one-line descriptions (the server owns the actual rules). */
export const AUTOMATION_KIND_META: AutomationKindMeta[] = [
  {
    kind: 'reward_ready',
    name: 'Reward ready',
    description: 'Account notice when a member reaches the 300-point redemption threshold with no voucher out.',
  },
  {
    kind: 'invite_followup',
    name: 'Invite follow-up',
    description: 'One reminder ever per unconverted invite, sent 7–30 days after the original.',
  },
  {
    kind: 'winback',
    name: 'Winback',
    description: 'Marketing note to members 60–120 days since their last paid order — honors the customer opt-out, max one per quarter.',
  },
  {
    kind: 'discount_expiry',
    name: 'Discount expiry',
    description: 'Factual notice when an account discount rule expires within 14 days.',
  },
  {
    kind: 'welcome',
    name: 'Welcome',
    description: 'One-time benefits orientation for accounts created in the last 3 days.',
  },
];

export interface EmailLogRow {
  id: string;
  userId: string | null;
  recipient: string;
  kind: string;
  periodKey: string;
  sentIso: string;
}

interface EmailLogResponse {
  rows: EmailLogRow[];
  total: number;
  summary: Record<string, number>;
}

interface UseAutomationsResult {
  /** kind → enabled, from automation_settings. */
  enabled: Record<string, boolean>;
  logRows: EmailLogRow[];
  logTotal: number;
  /** kind → emails sent, from admin_email_log's summary. */
  sentByKind: Record<string, number>;
  loading: boolean;
  error: string | null;
  unmigrated: boolean;
  reload: () => void;
}

export function useAutomations(): UseAutomationsResult {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<EmailLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setError('Backend not configured.'); setLoading(false); return; }
      setLoading(true);

      const settingsRes = await supabase.from('automation_settings').select('kind, enabled');
      if (cancelled) return;
      if (settingsRes.error) {
        if (isMissingBackend(settingsRes.error)) setUnmigrated(true);
        else setError(settingsRes.error.message);
        setLoading(false);
        return;
      }
      const byKind: Record<string, boolean> = {};
      for (const row of (settingsRes.data ?? []) as Array<{ kind: string; enabled: boolean }>) {
        byKind[row.kind] = row.enabled;
      }

      const logRes = await supabase.rpc('admin_email_log', { p_limit: 100, p_offset: 0 });
      if (cancelled) return;
      if (logRes.error) {
        if (isMissingBackend(logRes.error)) setUnmigrated(true);
        else setError(logRes.error.message);
        setLoading(false);
        return;
      }

      setEnabled(byKind);
      setLog(logRes.data as EmailLogResponse);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    enabled,
    logRows: log?.rows ?? [],
    logTotal: log?.total ?? 0,
    sentByKind: log?.summary ?? {},
    loading,
    error,
    unmigrated,
    reload,
  };
}

/** Toggle one automation kind via the audited RPC (behind a ConfirmModal). */
export async function setAutomationKind(
  kind: AutomationKind,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Backend not configured.' };
  const { error } = await supabase.rpc('admin_set_automation_kind', {
    p_kind: kind,
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: getErrorMessage(error) };
  return { ok: true };
}

/** Mask a recipient for on-screen display: `ada@example.com` → `a***@example.com`. */
export function maskRecipient(recipient: string): string {
  const at = recipient.indexOf('@');
  if (at <= 0) return recipient.length > 0 ? `${recipient[0]}***` : '***';
  return `${recipient[0]}***${recipient.slice(at)}`;
}
