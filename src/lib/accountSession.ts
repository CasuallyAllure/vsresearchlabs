/**
 * accountSession — the ONE `useCustomerAuth()` instance for the portal.
 *
 * WS-1 (docs/MEMBERSHIP_EXPERIENCE_BLUEPRINT.md): every portal page called
 * `useCustomerAuth()` directly, and some pages called it more than once —
 * on `/account/profile`, `AccountLayout` + `ProfileSection` +
 * `EmailPreferencesSection` were THREE separate instances, each
 * independently re-running getSession → loadMyProfile() (a
 * customer_profiles select) → claimGuestOrders() (the link_my_orders RPC)
 * on mount. Worse: a `reloadProfile()` called from one instance (e.g. the
 * profile edit form) never updated a sibling instance's state (e.g. the
 * read-only display), leaving stale profile data on screen after a save
 * until the next full remount.
 *
 * `AccountLayout` is still the one place that calls `useCustomerAuth()` —
 * unchanged, so sign-in/up/OTP/sign-out/session-expiry behavior is
 * identical to before this change — and it now provides that same value
 * through this context. Every descendant reads it via `useAccountSession()`
 * instead of calling the hook again: a context read, never a fetch. This
 * mirrors `authPresence.ts`'s own note ("anything needing profile data
 * should use useCustomerAuth() once, high in the tree") — this module is
 * that "once", formalized and shared.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { CustomerAuthApi } from './customerAuth';

const AccountSessionContext = createContext<CustomerAuthApi | null>(null);

/** Wrap the signed-in portal tree with the auth/profile value `AccountLayout` already holds. */
export function AccountSessionProvider({
  value,
  children,
}: {
  value: CustomerAuthApi;
  children: ReactNode;
}) {
  return createElement(AccountSessionContext.Provider, { value }, children);
}

/**
 * Read the shared portal auth/profile state. Must render under
 * `AccountSessionProvider` — every `/account/*` page already renders
 * inside `AccountLayout`, which is the only place that mounts it.
 */
export function useAccountSession(): CustomerAuthApi {
  const ctx = useContext(AccountSessionContext);
  if (!ctx) {
    throw new Error('useAccountSession() must be used within AccountLayout.');
  }
  return ctx;
}
