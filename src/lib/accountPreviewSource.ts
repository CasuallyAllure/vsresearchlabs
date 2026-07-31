/**
 * accountPreviewSource — the DEV-ONLY injection seam for the customer-portal
 * preview (`/account/__preview`).
 *
 * Why this exists: every `/account/*` surface sits behind customer sign-in,
 * so the portal's visual work could not be reviewed without authenticating
 * against the live backend. This is the customer-side mirror of the pattern
 * the membership blueprint already established for the admin Members lens
 * (`AdminMembersPreview` + `membersPreviewData.ts`): fabricated, obviously
 * synthetic records fill the SAME contract the live source fills, and the
 * REAL components render them — no forked layout, no duplicate UI.
 *
 * Shape of the seam:
 *   - `session`  replaces the `useCustomerAuth()` value `AccountLayout` holds,
 *                so WS-1's architecture is untouched: `AccountLayout` is still
 *                the only `useCustomerAuth()` caller, `AccountSessionProvider`
 *                still publishes ONE value, and every leaf still reads it via
 *                `useAccountSession()`.
 *   - the reads  replace the `supabase` round trip inside each `accountData.ts`
 *                wrapper, so `accountQueryCache` still owns caching/staleness
 *                and the pages keep their real loading/stale/error semantics.
 *
 * PRODUCTION SAFETY — three independent guarantees:
 *   1. `installAccountPreview()` returns early unless `import.meta.env.DEV`.
 *      Vite statically replaces that with `false` in a production build, so
 *      the installer's body is dead code and `active` can never be set.
 *   2. `accountPreview()` reads through the same DEV check, so even a
 *      hypothetically-populated `active` would be invisible in production.
 *   3. The only caller of `installAccountPreview()` is `AccountPreview.tsx`,
 *      which is reachable solely from an `import.meta.env.DEV &&` branch of
 *      the route table in `App.tsx` — so neither the preview page nor its
 *      fabricated records are emitted into the production bundle at all.
 *
 * This module deliberately holds NO demo data: the fixtures live with the
 * preview page so they stay out of the shipped `src/lib` surface entirely.
 */

import type { CustomerAuthApi } from './customerAuth';
import type {
  CustomerDiscountRow,
  MyOrderLineRow,
  MyOrderResult,
  MyOrderRow,
  ReferralCodeResult,
  RewardSummary,
} from './accountData';

/** Every portal read, plus the session, as plain fabricated values. */
export interface AccountPreviewSource {
  session: CustomerAuthApi;
  orders: MyOrderRow[];
  orderLines: MyOrderLineRow[];
  order: (orderNumber: string) => MyOrderResult;
  rewards: RewardSummary;
  referral: ReferralCodeResult;
  discounts: CustomerDiscountRow[];
  /**
   * When set, every read resolves with its data AND this error string —
   * exactly the "revalidation failed, keep last-good data" shape
   * `accountQueryCache` preserves, which is what drives `StaleDataNotice`.
   * Null (the default) is the healthy path.
   */
  staleError: string | null;
}

let active: AccountPreviewSource | null = null;

/** True only in a dev/test run — see the production-safety note above. */
function previewAllowed(): boolean {
  return import.meta.env.DEV === true;
}

/**
 * Install (or, with `null`, remove) the fabricated portal source. A no-op in
 * a production build.
 */
export function installAccountPreview(source: AccountPreviewSource | null): void {
  if (!previewAllowed()) return;
  active = source;
}

/** The installed fabricated source, or null when the portal is running live. */
export function accountPreview(): AccountPreviewSource | null {
  if (!previewAllowed()) return null;
  return active;
}

/** The fabricated session `AccountLayout` renders in place of the live one. */
export function accountPreviewSession(): CustomerAuthApi | null {
  return accountPreview()?.session ?? null;
}
