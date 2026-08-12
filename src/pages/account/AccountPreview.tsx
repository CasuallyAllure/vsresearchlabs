/**
 * AccountPreview — DEV-ONLY design preview for the customer portal.
 *
 * Every `/account/*` surface sits behind customer sign-in, so the WS-5 mobile
 * register pass could not be reviewed without authenticating against the live
 * backend. This is the customer-side mirror of the pattern the membership
 * blueprint established for the admin Members lens (`AdminMembersPreview` +
 * `membersPreviewData.ts`): fabricated, obviously-synthetic records fill the
 * same contract the live source fills, and the REAL pages and components
 * render them. Nothing here is a copy of the UI — a preview that renders a
 * duplicate proves nothing.
 *
 * How it works: importing this module installs `PREVIEW_SOURCE` into
 * `accountPreviewSource.ts` — the seam `AccountLayout` reads for its session
 * and every `accountData.ts` wrapper reads for its rows. The route itself
 * then simply redirects to the REAL portal URL (`?to=` picks which one), so
 * what gets screenshotted is `/account`, `/account/orders`, … rendered by the
 * production route table, with real tab highlighting and real navigation.
 * The install survives client-side navigation, and re-entering
 * `/account/__preview` re-installs after a hard reload.
 *
 * NOT REACHABLE IN PRODUCTION. `App.tsx` registers the route only inside an
 * `import.meta.env.DEV &&` branch, and this module is loaded through a
 * `lazy()` import inside that same branch — Vite replaces `import.meta.env.DEV`
 * with `false` in a production build, so neither this file nor any fabricated
 * record below is emitted into the shipped bundle. `installAccountPreview()`
 * additionally no-ops outside DEV.
 *
 * DATA HONESTY: every value below is invented. Names, emails, order numbers,
 * addresses and referral codes are deliberately, visibly fake — `.invalid`
 * emails (RFC 6761 reserved, unroutable), `DEMO` order numbers, a
 * `555-0100`-block phone (RFC 3849-style reserved fiction range). No real
 * customer record is referenced. The catalog SKUs ARE real, because the
 * library surface's whole job is rendering real catalog specifications.
 */

import { Navigate, useSearchParams } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import {
  installAccountPreview,
  type AccountPreviewSource,
} from '../../lib/accountPreviewSource';
import type {
  CustomerDiscountRow,
  MyOrderLineRow,
  MyOrderResult,
  MyOrderRow,
  ReferralCodeResult,
  RewardSummary,
} from '../../lib/accountData';
import type { CustomerAuthApi } from '../../lib/customerAuth';
import type { CustomerProfile } from '../../lib/customerProfile';

// ── fabricated identity ────────────────────────────────────────────────────

const DEMO_EMAIL = 'preview.member@demo.invalid';

const DEMO_USER = {
  id: '00000000-0000-4000-8000-0000000d3m0a',
  email: DEMO_EMAIL,
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2025-11-04T00:00:00.000Z',
} as unknown as User;

const DEMO_PROFILE: CustomerProfile = {
  user_id: DEMO_USER.id,
  full_name: 'Avery Demo-Preview',
  phone: '+1 555 0100',
  address_line1: '1 Example Research Park',
  address_line2: 'Suite 000 (demo)',
  city: 'Springfield',
  state: 'XX',
  postal_code: '00000',
  country: 'United States',
  tier: 'member',
  status: 'active',
  free_shipping: false,
  account_type: 'business',
  business_name: 'Demo Laboratory (fictional)',
  marketing_opt_out: false,
  created_at: '2025-11-04T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

/** Nothing here mutates: the preview is look-only, like the admin members preview. */
const DEMO_SESSION: CustomerAuthApi = {
  loading: false,
  user: DEMO_USER,
  profile: DEMO_PROFILE,
  error: null,
  signUp: async () => ({ ok: false, needsConfirmation: false, error: 'Disabled in the design preview.' }),
  signIn: async () => false,
  verifyOtp: async () => ({ ok: false, error: 'Disabled in the design preview.' }),
  resendOtp: async () => ({ ok: false, error: 'Disabled in the design preview.' }),
  signOut: async () => {
    installAccountPreview(null);
    window.location.assign('/account');
  },
  reloadProfile: async () => {},
};

// ── fabricated orders ──────────────────────────────────────────────────────

const DEMO_ORDERS: MyOrderRow[] = [
  {
    order_number: 'DEMO-1042',
    status: 'shipped',
    created_at: '2026-07-14T15:04:00.000Z',
    invoice_amount_cents: 128_400,
    carrier: 'USPS',
    tracking_number: '9400100000000000000000',
  },
  {
    order_number: 'DEMO-1017',
    status: 'processing',
    created_at: '2026-06-28T18:22:00.000Z',
    invoice_amount_cents: 64_250,
    carrier: null,
    tracking_number: null,
  },
  {
    order_number: 'DEMO-0994',
    status: 'awaiting_payment',
    created_at: '2026-06-02T13:41:00.000Z',
    invoice_amount_cents: 214_000,
    carrier: null,
    tracking_number: null,
  },
  {
    order_number: 'DEMO-0961',
    status: 'delivered',
    created_at: '2026-04-19T11:07:00.000Z',
    invoice_amount_cents: 31_800,
    carrier: 'UPS',
    tracking_number: '1Z0000000000000000',
  },
  {
    order_number: 'DEMO-0902',
    status: 'cancelled',
    created_at: '2026-03-05T09:15:00.000Z',
    invoice_amount_cents: 9_600,
    carrier: null,
    tracking_number: null,
  },
];

/** Real catalog SKUs — the library surface renders the catalog's own specs. */
const DEMO_ORDER_LINES: MyOrderLineRow[] = [
  { sku: 'VSR-RS-BPC-005', product_name: 'BPC-157 — 5mg', order_number: 'DEMO-1042', status: 'shipped' },
  { sku: 'VSR-RS-RTT-005', product_name: 'RTT — 5mg', order_number: 'DEMO-1042', status: 'shipped' },
  { sku: 'VSR-LE-BAL-220', product_name: 'Analytical Balance — 0.1 mg Readability', order_number: 'DEMO-1042', status: 'shipped' },
  { sku: 'VSR-RS-GHK', product_name: 'GHK-Cu — 50mg', order_number: 'DEMO-1017', status: 'processing' },
  { sku: 'VSR-RS-BPC-005', product_name: 'BPC-157 — 10mg', order_number: 'DEMO-0961', status: 'delivered' },
  { sku: 'VSR-RS-MOTS', product_name: 'MOTS-c — 10mg', order_number: 'DEMO-0961', status: 'delivered' },
];

const DEMO_INVOICE_BASE = {
  buyer_name: DEMO_PROFILE.full_name,
  ship_street: `${DEMO_PROFILE.address_line1}, ${DEMO_PROFILE.address_line2}`,
  ship_city: DEMO_PROFILE.city,
  ship_state: DEMO_PROFILE.state,
  ship_zip: DEMO_PROFILE.postal_code,
  ship_country: DEMO_PROFILE.country,
  ship_confirmed_at: '2026-07-14T16:00:00.000Z',
  payment_method: 'Zelle',
};

/**
 * One fully-populated invoice (DEMO-1042) so the order-detail surface renders
 * every module it owns: status bar, tracking, itemized lines, a discount
 * line, totals and the printable document. Any other order number resolves to
 * a lighter, unpaid variant built from its list row.
 */
function demoOrder(orderNumber: string): MyOrderResult {
  const row = DEMO_ORDERS.find((o) => o.order_number === orderNumber);
  if (!row) return { found: false };

  if (orderNumber === 'DEMO-1042') {
    return {
      found: true,
      ...DEMO_INVOICE_BASE,
      order_number: row.order_number,
      status: row.status,
      placed_at: row.created_at,
      shipped_at: '2026-07-16T17:30:00.000Z',
      delivered_at: null,
      carrier: row.carrier,
      tracking_number: row.tracking_number,
      subtotal_cents: 142_400,
      shipping_cents: 0,
      total_cents: 128_400,
      paid: true,
      discount_cents: 14_000,
      coupons: [
        {
          code: 'DEMOPREVIEW',
          kind: 'percent',
          free_label: null,
          percent: 10,
          amount_cents: null,
          discount_cents: 14_000,
        },
      ],
      lines: [
        { sku: 'VSR-RS-BPC-005', product_name: 'BPC-157 — 5mg', quantity: 4, unit_price_cents: 8_600, item_note: null },
        { sku: 'VSR-RS-RTT-005', product_name: 'RTT — 5mg', quantity: 2, unit_price_cents: 41_500, item_note: 'Demo line — not a real order' },
        { sku: 'VSR-LE-BAL-220', product_name: 'Analytical Balance — 0.1 mg Readability', quantity: 1, unit_price_cents: 24_600, item_note: null },
      ],
    };
  }

  return {
    found: true,
    ...DEMO_INVOICE_BASE,
    order_number: row.order_number,
    status: row.status,
    placed_at: row.created_at,
    shipped_at: null,
    delivered_at: null,
    carrier: row.carrier,
    tracking_number: row.tracking_number,
    subtotal_cents: row.invoice_amount_cents,
    shipping_cents: 0,
    total_cents: row.invoice_amount_cents,
    paid: false,
    discount_cents: null,
    coupons: [],
    lines: [
      { sku: 'VSR-RS-GHK', product_name: 'GHK-Cu — 50mg', quantity: 1, unit_price_cents: row.invoice_amount_cents, item_note: null },
    ],
  };
}

// ── fabricated rewards / referrals / discounts ─────────────────────────────

const DEMO_REWARDS: RewardSummary = {
  balance: 218,
  threshold: 300,
  percent: 40,
  reward_ready: false,
  active_voucher: null,
  entries: [
    { id: 'demo-r1', kind: 'earn', points: 128, note: null, order_number: 'DEMO-1042', created_at: '2026-07-14T15:04:00.000Z' },
    { id: 'demo-r2', kind: 'earn', points: 64, note: null, order_number: 'DEMO-1017', created_at: '2026-06-28T18:22:00.000Z' },
    { id: 'demo-r3', kind: 'adjustment', points: 50, note: 'Demo adjustment — preview data only', order_number: null, created_at: '2026-05-11T10:00:00.000Z' },
    { id: 'demo-r4', kind: 'earn', points: 31, note: null, order_number: 'DEMO-0961', created_at: '2026-04-19T11:07:00.000Z' },
    { id: 'demo-r5', kind: 'reversal', points: -55, note: 'Demo reversal — cancelled order', order_number: 'DEMO-0902', created_at: '2026-03-06T09:15:00.000Z' },
  ],
};

const DEMO_REFERRAL: ReferralCodeResult = { code: 'DEMO-PREVIEW-0000', percent: 10, uses: 3 };

const DEMO_DISCOUNTS: CustomerDiscountRow[] = [
  {
    id: 'demo-d1',
    scope: 'lifetime',
    percent: 15,
    label: 'Account discount (demo)',
    active: true,
    starts_at: '2025-11-04T00:00:00.000Z',
    expires_at: null,
  },
  {
    id: 'demo-d2',
    scope: 'business',
    percent: 20,
    label: 'Demo Laboratory — institutional rate (fictional)',
    active: true,
    starts_at: '2026-01-15T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
  },
];

// ── the installed source ───────────────────────────────────────────────────

const PREVIEW_SOURCE: AccountPreviewSource = {
  session: DEMO_SESSION,
  orders: DEMO_ORDERS,
  orderLines: DEMO_ORDER_LINES,
  order: demoOrder,
  rewards: DEMO_REWARDS,
  referral: DEMO_REFERRAL,
  discounts: DEMO_DISCOUNTS,
  staleError: null,
};

// Installing on import (rather than in an effect) guarantees the source is in
// place before any /account route this redirect lands on begins rendering.
installAccountPreview(PREVIEW_SOURCE);

/**
 * Dev console handle for driving states that only appear on a FAILED
 * revalidation — `StaleDataNotice` renders when a read returns last-good data
 * alongside an error, which `accountQueryCache` only produces on a background
 * refresh (after the 30s staleness window) or an explicit `refresh()`.
 */
declare global {
  interface Window {
    __accountPreview?: { setStaleError: (message: string | null) => void };
  }
}
window.__accountPreview = {
  setStaleError: (message) => {
    installAccountPreview({ ...PREVIEW_SOURCE, staleError: message });
  },
};

/** Where to land. Defaults to the portal index; `?to=` deep-links a surface. */
const DEFAULT_TARGET = '/account';

export function AccountPreview() {
  const [params] = useSearchParams();
  const raw = params.get('to') ?? DEFAULT_TARGET;
  // Only ever redirect INSIDE the portal — never let a query param bounce the
  // browser somewhere else.
  const target = raw.startsWith('/account') ? raw : DEFAULT_TARGET;

  // Re-assert during render, not in an effect: `<Navigate>` performs its
  // redirect in its OWN effect, which flushes before this component's would —
  // the source has to be installed by then. Re-entering the preview after
  // `signOut()` (which uninstalls) is what this covers; the module-scope
  // install above covers the first entry.
  installAccountPreview(PREVIEW_SOURCE);

  return <Navigate to={target} replace />;
}

export default AccountPreview;
