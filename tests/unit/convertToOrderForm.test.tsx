// @vitest-environment happy-dom
/**
 * ConvertToOrderForm — the reward-voucher wiring added on top of the existing
 * discount/lines composer (Step 3.3): an active reward_vouchers row lets the
 * owner apply 40% off one line to the order being converted; a rewardReady
 * member with no voucher yet can redeem one on the spot and have it apply
 * immediately. Both paths go through the same `convertTotals`/
 * `convertRewardPayload` the rest of the composer already trusts, so this
 * suite pins the WIRING (voucher load, radio → lineIndex, redeem → picker),
 * not the money maths (covered in tests/unit/convertPreparedCart.test.ts).
 *
 * The supabase seam is mocked, mirroring tests/unit/preparedCartPanel.test.tsx's
 * harness.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import { ConvertToOrderForm } from '../../src/pages/admin/members/ConvertToOrderForm';
import type { PreparedCartSummary } from '../../src/pages/admin/members/usePreparedCart';
import type { MemberRow } from '../../src/pages/admin/membersView';
import type { VariantIndex } from '../../src/lib/preparedCart';
import { formatPriceExact } from '../../src/lib/pricing';

type RpcResult = { data: unknown; error: unknown };
type RpcHandler = (args: unknown) => RpcResult | Promise<RpcResult>;
type FromResult = { data: unknown; error: unknown };

/** Mirrors preparedCartPanel.test.tsx's `makeClient`: a chainable `from()` (with
 *  `limit`, which `loadActiveVoucher` calls that the prepared-cart harness did
 *  not need) resolved per-table, plus an `rpc()` dispatched by name. */
function makeClient(rpcHandlers: Record<string, RpcHandler>, fromResults: Record<string, FromResult> = {}) {
  const rpc = vi.fn(async (name: string, args: unknown) =>
    (rpcHandlers[name] ? rpcHandlers[name](args) : { data: null, error: null }));
  const from = vi.fn((table: string) => {
    const result = fromResults[table] ?? { data: [], error: null };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (ok: (r: FromResult) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, fail),
    };
    return chain;
  });
  return { rpc, from };
}

const MEMBER = {
  userId: 'u1', id: 'c1', name: 'Shae Nguyen', contact: 'shae@example.com', org: null,
  tier: 'member', accountType: 'individual', businessName: null, freeShipping: false,
  status: 'active', spendCents: 0, ttmSpendCents: 0, paidOrders: 3, points: 300,
  rewardReady: true, effectivePercent: 15, discountLabel: 'Account-holder 15%',
  discountScope: 'lifetime', discountExpiresIso: null, joinedIso: '2026-01-01',
  lastOrderIso: null, segment: 'active', vip: false, spendPercentile: 0,
} as unknown as MemberRow;

const INDEX: VariantIndex = {
  compoundNames: ['BPC-157', 'Retatrutide'],
  byCompound: new Map([
    ['BPC-157', [{ sku: 'VSR-RS-BPC', dose: '10mg', name: 'BPC-157 — 10mg', priceCents: 10_000, tier: 'in_stock' }]],
    ['Retatrutide', [{ sku: 'VSR-RS-RETA', dose: '15mg', name: 'Retatrutide — 15mg', priceCents: 24_000, tier: 'in_stock' }]],
  ]),
};

// BPC 10mg (10,000¢) then RETA 15mg (24,000¢) — this order is also the order
// `convertLinesPayload` serializes, since prefillConvertLines preserves it.
const CART: PreparedCartSummary = {
  id: 'cart-1',
  created_at: '2026-08-01T00:00:00Z',
  expires_at: '2026-08-15T00:00:00Z',
  claimed_at: null,
  last_claimed_at: null,
  claim_count: 0,
  revoked_at: null,
  converted_at: null,
  converted_order_id: null,
  converted_order_number: null,
  coupon_code: null,
  note: null,
  status: 'live',
  lines: [
    { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 },
    { sku: 'VSR-RS-RETA', dose: '15mg', quantity: 1 },
  ],
  delivery: { state: 'unknown' },
};

const yes = vi.fn(async () => true);

function renderForm(client: ReturnType<typeof makeClient>, member: MemberRow = MEMBER) {
  seam.client = client;
  return render(
    <MemoryRouter>
      <ConvertToOrderForm
        cart={CART}
        member={member}
        index={INDEX}
        confirm={yes}
        onConverted={vi.fn()}
        onCancel={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function amountFor(labelMatch: RegExp): string {
  const dt = screen.getAllByText(labelMatch)[0];
  const dd = dt.parentElement?.querySelector('dd');
  return dd?.textContent ?? '';
}

beforeEach(() => {
  yes.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConvertToOrderForm — an active reward voucher', () => {
  test('defaults to the higher-priced line and shows the reward row', async () => {
    const client = makeClient({}, { reward_vouchers: { data: [{ id: 'v1', percent: 40 }], error: null } });
    renderForm(client);

    const reta = await screen.findByRole('radio', { name: /Retatrutide/i });
    expect((reta as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /BPC-157/i }) as HTMLInputElement).checked).toBe(false);

    expect(amountFor(/Reward credit ·/)).toBe(`−${formatPriceExact(9_600)}`);
    expect(amountFor(/Order total/i)).toBe(formatPriceExact(22_900));
  });

  test('choosing a different line moves the reward and its amount', async () => {
    const client = makeClient({}, { reward_vouchers: { data: [{ id: 'v1', percent: 40 }], error: null } });
    renderForm(client);

    const bpc = await screen.findByRole('radio', { name: /BPC-157/i });
    fireEvent.click(bpc);

    expect(amountFor(/Reward credit ·/)).toBe(`−${formatPriceExact(4_000)}`);
  });

  test('submitting sends the voucher id and the RETA line index in payload order', async () => {
    const convert = vi.fn(() => ({
      data: { ok: true, order_id: 'order-1', order_number: 'ORDER-1', total_cents: 22_900 },
      error: null,
    }));
    const client = makeClient(
      { admin_convert_prepared_cart: convert },
      { reward_vouchers: { data: [{ id: 'v1', percent: 40 }], error: null } },
    );
    renderForm(client);

    await screen.findByRole('radio', { name: /Retatrutide/i });
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    await waitFor(() => expect(convert).toHaveBeenCalled());
    const args = convert.mock.calls[0][0] as { p_reward: unknown };
    // BPC is index 0, RETA is index 1 in cart.lines / convertLinesPayload order.
    expect(args.p_reward).toEqual({ voucher_id: 'v1', line_index: 1 });
  });

  test('"Not on this order" sends no reward', async () => {
    const convert = vi.fn(() => ({
      data: { ok: true, order_id: 'order-1', order_number: 'ORDER-1', total_cents: 34_000 },
      error: null,
    }));
    const client = makeClient(
      { admin_convert_prepared_cart: convert },
      { reward_vouchers: { data: [{ id: 'v1', percent: 40 }], error: null } },
    );
    renderForm(client);

    await screen.findByRole('radio', { name: /Retatrutide/i });
    fireEvent.click(screen.getByRole('radio', { name: /Not on this order/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    await waitFor(() => expect(convert).toHaveBeenCalled());
    const args = convert.mock.calls[0][0] as { p_reward: unknown };
    expect(args.p_reward).toBeNull();
  });
});

describe('ConvertToOrderForm — redeeming a reward on the spot', () => {
  test('no voucher yet, but reward-ready: redeeming applies the new voucher immediately', async () => {
    const redeem = vi.fn(() => ({ data: { ok: true, voucherId: 'v2', percent: 40 }, error: null }));
    const client = makeClient(
      { admin_redeem_reward_for: redeem },
      { reward_vouchers: { data: [], error: null } },
    );
    renderForm(client);

    const button = await screen.findByRole('button', { name: /Redeem 40% credit & apply/i });
    fireEvent.click(button);

    await waitFor(() => expect(redeem).toHaveBeenCalled());
    expect(redeem.mock.calls[0][0]).toEqual({ p_user_id: 'u1', p_note: expect.any(String) });

    expect(await screen.findByRole('radio', { name: /Retatrutide/i })).toBeTruthy();
  });

  test('a redeem failure is reported and no picker appears', async () => {
    const redeem = vi.fn(() => ({ data: { ok: false, reason: 'Not enough points.' }, error: null }));
    const client = makeClient(
      { admin_redeem_reward_for: redeem },
      { reward_vouchers: { data: [], error: null } },
    );
    renderForm(client);

    const button = await screen.findByRole('button', { name: /Redeem 40% credit & apply/i });
    fireEvent.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch('Not enough points.');
    expect(screen.queryByRole('radio')).toBeNull();
  });

  test('no voucher and not reward-ready: neither block renders', async () => {
    const client = makeClient({}, { reward_vouchers: { data: [], error: null } });
    renderForm(client, { ...MEMBER, rewardReady: false });

    await waitFor(() => expect(client.from).toHaveBeenCalledWith('reward_vouchers'));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /redeem/i })).toBeNull();
  });
});
