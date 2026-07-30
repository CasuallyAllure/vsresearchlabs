/**
 * authPresence — a zero-query "is anyone signed in?" signal for leaf
 * components that render many times per page (catalog tiles, price chips).
 *
 * WHY NOT useCustomerAuth(): that hook is a full per-instance auth state —
 * every mount runs getSession → loadMyProfile() (a select) and, when signed
 * in, claimGuestOrders() (the link_my_orders RPC, guarded per-instance). One
 * instance per page is fine; one per CATALOG TILE fired ~50 duplicate RPCs
 * for signed-in shoppers (release-audit finding). This module holds ONE
 * process-wide subscription and answers synchronously.
 *
 * Presence only — no profile, no tier. Anything needing profile data should
 * use useCustomerAuth() once, high in the tree.
 */

import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

let signedIn = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

if (supabase) {
  // getSession reads the locally persisted session — no network round-trip.
  void supabase.auth.getSession().then(({ data }) => {
    const next = !!data.session;
    if (next !== signedIn) {
      signedIn = next;
      emit();
    }
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = !!session;
    if (next !== signedIn) {
      signedIn = next;
      emit();
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True when a customer session exists. Before the first session read
 *  resolves this returns false — a guest-safe default. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, () => signedIn, () => false);
}
