/**
 * useLinkedProfile — loads the customer_profiles row behind a member, keyed by
 * either the CRM customers.id (customer-detail page) or the auth user_id
 * (/admin/members rows). One fetch, one state machine, shared by both callers
 * so neither reimplements the lookup.
 *
 * Extracted from the former CustomerAccountPanels root; the customer_id path is
 * byte-for-byte the original query, with user_id added for the Members rows.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { isMissingBackend, type ProfileRow } from './shared';

export type ProfileLookup =
  | { by: 'customer_id'; value: string }
  | { by: 'user_id'; value: string };

export type LinkedProfileState = 'loading' | 'none' | 'ready' | 'unmigrated' | 'error';

interface UseLinkedProfileResult {
  state: LinkedProfileState;
  profile: ProfileRow | null;
  loadError: string | null;
  reload: () => void;
}

const PROFILE_COLUMNS = 'user_id, full_name, tier, status, account_type, business_name, free_shipping';

export function useLinkedProfile(lookup: ProfileLookup): UseLinkedProfileResult {
  const [state, setState] = useState<LinkedProfileState>('loading');
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
        .select(PROFILE_COLUMNS)
        .eq(lookup.by, lookup.value)
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
  }, [lookup.by, lookup.value, reloadCounter]);

  return { state, profile, loadError, reload };
}
