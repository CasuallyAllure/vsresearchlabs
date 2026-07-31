/**
 * Unit tests for src/lib/accountData.ts — the customer-portal data wrappers
 * (listMyOrders / getMyOrder / getMyRewardSummary / redeemReward /
 * listMyDiscounts).
 *
 * The supabase seam is mocked (per tests/setup.ts the real client is
 * live-capable, so hitting it from a unit test is forbidden). RLS scopes
 * every query server-side, so these tests pin the client contract only:
 * the null-supabase degradation (empty/null data + "Backend not configured."
 * — never a throw), error passthrough as `error.message`, and the null-data
 * fallbacks (empty lists, `{ found: false }`, the zeroed reward summary).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getMyOrder,
  getMyRewardSummary,
  listMyDiscounts,
  listMyOrderLines,
  listMyOrders,
  getMyReferralCode,
  redeemReward,
} from '../../src/lib/accountData';
import { installAccountPreview } from '../../src/lib/accountPreviewSource';

// Mutable seam: tests swap `client` between a mock client and null
// ("backend not configured") without re-importing the module under test.
const seam = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Mock client for the table queries: from(...).select(...).order(...) → result. */
function makeTableClient(result: QueryResult) {
  const order = vi.fn(async () => result);
  const chain = { select: vi.fn(() => chain), order };
  return { client: { from: vi.fn(() => chain) }, chain };
}

/** Mock client for the RPC wrappers: rpc(name, args?) → result. */
function makeRpcClient(result: QueryResult) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc }, rpc };
}

beforeEach(() => {
  seam.client = null;
});

describe('listMyOrders', () => {
  const ROW = {
    order_number: 'VSR-ORD-260701-001',
    status: 'shipped',
    created_at: '2026-07-01T00:00:00Z',
    invoice_amount_cents: 12999,
    carrier: 'usps',
    tracking_number: '9400111111',
  };

  test('degrades to an empty list when the backend is not configured', async () => {
    seam.client = null;

    await expect(listMyOrders()).resolves.toEqual({
      data: [],
      error: 'Backend not configured.',
    });
  });

  test('returns the owned orders newest first (query shape pinned)', async () => {
    const { client, chain } = makeTableClient({ data: [ROW], error: null });
    seam.client = client;

    const result = await listMyOrders();

    expect(result).toEqual({ data: [ROW], error: null });
    expect(client.from).toHaveBeenCalledWith('orders');
    expect(chain.select).toHaveBeenCalledWith(
      'order_number, status, created_at, invoice_amount_cents, carrier, tracking_number',
    );
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  test('surfaces a backend error as a string, not a throw', async () => {
    const { client } = makeTableClient({ data: null, error: { message: 'permission denied' } });
    seam.client = client;

    await expect(listMyOrders()).resolves.toEqual({ data: [], error: 'permission denied' });
  });

  test('treats a null data payload as an empty history', async () => {
    const { client } = makeTableClient({ data: null, error: null });
    seam.client = client;

    await expect(listMyOrders()).resolves.toEqual({ data: [], error: null });
  });
});

describe('getMyOrder', () => {
  test('degrades to null data when the backend is not configured', async () => {
    seam.client = null;

    await expect(getMyOrder('VSR-ORD-260701-001')).resolves.toEqual({
      data: null,
      error: 'Backend not configured.',
    });
  });

  test('calls the get_my_order RPC with the order number', async () => {
    const order = { found: true, order_number: 'VSR-ORD-260701-001', status: 'paid' };
    const { client, rpc } = makeRpcClient({ data: order, error: null });
    seam.client = client;

    const result = await getMyOrder('VSR-ORD-260701-001');

    expect(result).toEqual({ data: order, error: null });
    expect(rpc).toHaveBeenCalledWith('get_my_order', { p_order_number: 'VSR-ORD-260701-001' });
  });

  test('surfaces a missing-RPC (migration not applied) error as a string', async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { message: 'function get_my_order does not exist' },
    });
    seam.client = client;

    await expect(getMyOrder('VSR-ORD-260701-001')).resolves.toEqual({
      data: null,
      error: 'function get_my_order does not exist',
    });
  });

  test('maps a null RPC payload to not-found rather than a crash', async () => {
    const { client } = makeRpcClient({ data: null, error: null });
    seam.client = client;

    await expect(getMyOrder('VSR-ORD-000000-000')).resolves.toEqual({
      data: { found: false },
      error: null,
    });
  });
});

describe('getMyRewardSummary', () => {
  test('degrades to null data when the backend is not configured', async () => {
    seam.client = null;

    await expect(getMyRewardSummary()).resolves.toEqual({
      data: null,
      error: 'Backend not configured.',
    });
  });

  test('returns the summary from the get_my_reward_summary RPC', async () => {
    const summary = {
      balance: 120,
      threshold: 300,
      percent: 40,
      reward_ready: false,
      active_voucher: null,
      entries: [],
    };
    const { client, rpc } = makeRpcClient({ data: summary, error: null });
    seam.client = client;

    const result = await getMyRewardSummary();

    expect(result).toEqual({ data: summary, error: null });
    expect(rpc).toHaveBeenCalledWith('get_my_reward_summary');
  });

  test('surfaces a backend error as a string', async () => {
    const { client } = makeRpcClient({ data: null, error: { message: 'permission denied' } });
    seam.client = client;

    await expect(getMyRewardSummary()).resolves.toEqual({
      data: null,
      error: 'permission denied',
    });
  });

  test('falls back to a zeroed summary when the RPC returns null', async () => {
    const { client } = makeRpcClient({ data: null, error: null });
    seam.client = client;

    await expect(getMyRewardSummary()).resolves.toEqual({
      data: {
        balance: 0,
        threshold: 300,
        percent: 40,
        reward_ready: false,
        active_voucher: null,
        entries: [],
      },
      error: null,
    });
  });
});

describe('redeemReward', () => {
  test('degrades to null data when the backend is not configured', async () => {
    seam.client = null;

    await expect(redeemReward()).resolves.toEqual({
      data: null,
      error: 'Backend not configured.',
    });
  });

  test('returns the redeem_reward RPC result', async () => {
    const { client, rpc } = makeRpcClient({
      data: { ok: true, voucher_id: 'v-1', percent: 40 },
      error: null,
    });
    seam.client = client;

    const result = await redeemReward();

    expect(result).toEqual({ data: { ok: true, voucher_id: 'v-1', percent: 40 }, error: null });
    expect(rpc).toHaveBeenCalledWith('redeem_reward');
  });

  test('surfaces a backend error as a string', async () => {
    const { client } = makeRpcClient({ data: null, error: { message: 'insufficient points' } });
    seam.client = client;

    await expect(redeemReward()).resolves.toEqual({ data: null, error: 'insufficient points' });
  });

  test('maps a null RPC payload to a not-ok result rather than a crash', async () => {
    const { client } = makeRpcClient({ data: null, error: null });
    seam.client = client;

    await expect(redeemReward()).resolves.toEqual({
      data: { ok: false, reason: 'Unexpected response.' },
      error: null,
    });
  });
});

describe('listMyDiscounts', () => {
  const ROW = {
    id: 'd-1',
    scope: 'lifetime',
    percent: 10,
    label: 'Founding member',
    active: true,
    starts_at: null,
    expires_at: null,
  };

  test('degrades to an empty list when the backend is not configured', async () => {
    seam.client = null;

    await expect(listMyDiscounts()).resolves.toEqual({
      data: [],
      error: 'Backend not configured.',
    });
  });

  test('returns the discount rows newest-window first (query shape pinned)', async () => {
    const { client, chain } = makeTableClient({ data: [ROW], error: null });
    seam.client = client;

    const result = await listMyDiscounts();

    expect(result).toEqual({ data: [ROW], error: null });
    expect(client.from).toHaveBeenCalledWith('customer_discounts');
    expect(chain.select).toHaveBeenCalledWith(
      'id, scope, percent, label, active, starts_at, expires_at',
    );
    expect(chain.order).toHaveBeenCalledWith('starts_at', { ascending: false });
  });

  test('surfaces a missing-table (migration not applied) error as a string', async () => {
    const { client } = makeTableClient({
      data: null,
      error: { message: 'relation "customer_discounts" does not exist' },
    });
    seam.client = client;

    await expect(listMyDiscounts()).resolves.toEqual({
      data: [],
      error: 'relation "customer_discounts" does not exist',
    });
  });

  test('treats a null data payload as no discounts', async () => {
    const { client } = makeTableClient({ data: null, error: null });
    seam.client = client;

    await expect(listMyDiscounts()).resolves.toEqual({ data: [], error: null });
  });
});

describe('listMyOrderLines', () => {
  /** from(...).select(...) is awaited directly here — no .order() link. */
  function makeSelectClient(result: QueryResult) {
    const select = vi.fn(async () => result);
    const chain = { select };
    return { client: { from: vi.fn(() => chain) }, chain };
  }

  test('degrades to an empty list when the backend is not configured', async () => {
    seam.client = null;

    await expect(listMyOrderLines()).resolves.toEqual({
      data: [],
      error: 'Backend not configured.',
    });
  });

  test('flattens the embedded parent order onto each line (query shape pinned)', async () => {
    const { client, chain } = makeSelectClient({
      data: [
        {
          sku: 'VSR-RS-AOD-005',
          product_name: 'AOD-9604 — 5mg',
          orders: { order_number: 'VSR-ORD-260701-001', status: 'fulfilled' },
        },
      ],
      error: null,
    });
    seam.client = client;

    await expect(listMyOrderLines()).resolves.toEqual({
      data: [
        {
          sku: 'VSR-RS-AOD-005',
          product_name: 'AOD-9604 — 5mg',
          order_number: 'VSR-ORD-260701-001',
          status: 'fulfilled',
        },
      ],
      error: null,
    });
    expect(client.from).toHaveBeenCalledWith('order_lines');
    expect(chain.select).toHaveBeenCalledWith('sku, product_name, orders!inner(order_number, status)');
  });

  test('accepts a to-one embed delivered as a single-element array', async () => {
    const { client } = makeSelectClient({
      data: [
        {
          sku: 'VSR-LE-RCK-001',
          product_name: 'Vial Rack',
          orders: [{ order_number: 'VSR-ORD-260701-002', status: 'paid' }],
        },
      ],
      error: null,
    });
    seam.client = client;

    const { data } = await listMyOrderLines();

    expect(data).toEqual([
      {
        sku: 'VSR-LE-RCK-001',
        product_name: 'Vial Rack',
        order_number: 'VSR-ORD-260701-002',
        status: 'paid',
      },
    ]);
  });

  test('drops a line whose parent order did not come back', async () => {
    const { client } = makeSelectClient({
      data: [{ sku: 'VSR-RS-AOD-005', product_name: 'AOD-9604 — 5mg', orders: null }],
      error: null,
    });
    seam.client = client;

    await expect(listMyOrderLines()).resolves.toEqual({ data: [], error: null });
  });

  test('surfaces a query error as a string', async () => {
    const { client } = makeSelectClient({
      data: null,
      error: { message: 'permission denied for table order_lines' },
    });
    seam.client = client;

    await expect(listMyOrderLines()).resolves.toEqual({
      data: [],
      error: 'permission denied for table order_lines',
    });
  });
});

/**
 * The DEV-only design-preview seam (src/lib/accountPreviewSource.ts). Every
 * read short-circuits to the installed fabricated source BEFORE touching
 * supabase — that is what lets the real portal components render at
 * /account/__preview with no auth and no network. `seam.client` stays null
 * throughout: if a wrapper ever fell through to supabase it would return
 * "Backend not configured." instead of the fabricated rows.
 */
describe('preview seam', () => {
  const ORDER_ROW = {
    order_number: 'DEMO-0001',
    status: 'shipped',
    created_at: '2026-07-01T00:00:00Z',
    invoice_amount_cents: 1000,
    carrier: null,
    tracking_number: null,
  };
  const LINE_ROW = {
    sku: 'VSR-RS-BPC-005',
    product_name: 'BPC-157 — 5mg',
    order_number: 'DEMO-0001',
    status: 'shipped',
  };
  const REWARDS = {
    balance: 218,
    threshold: 300,
    percent: 40,
    reward_ready: false,
    active_voucher: null,
    entries: [],
  };
  const DISCOUNT = {
    id: 'demo-d1',
    scope: 'lifetime' as const,
    percent: 15,
    label: 'Account discount (demo)',
    active: true,
    starts_at: null,
    expires_at: null,
  };
  const REFERRAL = { code: 'DEMO-PREVIEW-0000', percent: 10, uses: 3 };

  function install(staleError: string | null = null) {
    installAccountPreview({
      session: {} as never,
      orders: [ORDER_ROW],
      orderLines: [LINE_ROW],
      order: (orderNumber: string) =>
        orderNumber === 'DEMO-0001'
          ? ({ found: true, order_number: orderNumber } as never)
          : { found: false },
      rewards: REWARDS,
      referral: REFERRAL,
      discounts: [DISCOUNT],
      staleError,
    });
  }

  afterEach(() => {
    installAccountPreview(null);
  });

  test('every read resolves from the fabricated source, never supabase', async () => {
    install();

    await expect(listMyOrders()).resolves.toEqual({ data: [ORDER_ROW], error: null });
    await expect(listMyOrderLines()).resolves.toEqual({ data: [LINE_ROW], error: null });
    await expect(getMyRewardSummary()).resolves.toEqual({ data: REWARDS, error: null });
    await expect(listMyDiscounts()).resolves.toEqual({ data: [DISCOUNT], error: null });
    await expect(getMyReferralCode()).resolves.toEqual({ data: REFERRAL, error: null });
  });

  test('getMyOrder resolves the requested fabricated order, and misses honestly', async () => {
    install();

    await expect(getMyOrder('DEMO-0001')).resolves.toEqual({
      data: { found: true, order_number: 'DEMO-0001' },
      error: null,
    });
    await expect(getMyOrder('DEMO-9999')).resolves.toEqual({ data: { found: false }, error: null });
  });

  test('redeemReward is disabled — the preview never mutates anything', async () => {
    install();

    await expect(redeemReward()).resolves.toEqual({
      data: { ok: false, reason: 'Redemption is disabled in the design preview.' },
      error: null,
    });
  });

  test('staleError rides alongside the data — the shape that drives StaleDataNotice', async () => {
    install('Demo: background refresh failed.');

    await expect(listMyOrders()).resolves.toEqual({
      data: [ORDER_ROW],
      error: 'Demo: background refresh failed.',
    });
    await expect(getMyRewardSummary()).resolves.toEqual({
      data: REWARDS,
      error: 'Demo: background refresh failed.',
    });
    await expect(getMyOrder('DEMO-0001')).resolves.toEqual({
      data: { found: true, order_number: 'DEMO-0001' },
      error: 'Demo: background refresh failed.',
    });
    await expect(listMyOrderLines()).resolves.toEqual({
      data: [LINE_ROW],
      error: 'Demo: background refresh failed.',
    });
    await expect(listMyDiscounts()).resolves.toEqual({
      data: [DISCOUNT],
      error: 'Demo: background refresh failed.',
    });
    await expect(getMyReferralCode()).resolves.toEqual({
      data: REFERRAL,
      error: 'Demo: background refresh failed.',
    });
  });

  test('uninstalling restores the live path', async () => {
    install();
    installAccountPreview(null);

    await expect(listMyOrders()).resolves.toEqual({ data: [], error: 'Backend not configured.' });
  });
});
