// @vitest-environment happy-dom
/**
 * Members Phase 2 sub-views — Redemptions (voucher void) and Invites (bulk).
 *
 * The supabase seam is mocked (a unit test never touches the live client); each
 * test drives one path: the voucher list + void RPC, the invite funnel, the
 * bulk-invite fan-out over the send-invite edge function, and the "backend not
 * migrated" degradation. The real row-level RPC behaviour (append-only refund,
 * active-only guard, audit, anon revocation) is proven against real Postgres in
 * tests/integration/memberVouchersInvites.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import { RedemptionsView } from '../../src/pages/admin/members/RedemptionsView';
import { InvitesView } from '../../src/pages/admin/members/InvitesView';
import { bulkInvite, type InvitableGuest } from '../../src/pages/admin/members/useInvites';

afterEach(cleanup);
beforeEach(() => { seam.client = null; });

type RpcHandler = (args: unknown) => { data: unknown; error: unknown };

function makeClient(handlers: Record<string, RpcHandler>, invoke?: ReturnType<typeof vi.fn>) {
  const rpc = vi.fn(async (name: string, args: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  return { rpc, functions: { invoke: invoke ?? vi.fn(async () => ({ data: null, error: null })) } };
}

const renderR = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/* ── Redemptions ──────────────────────────────────────────────────────────── */

const VOUCHERS = {
  rows: [
    { id: 'v-active', userId: 'u1', customerId: 'c1', memberName: 'Ada Reyes', contact: 'ada@example.com',
      percent: 40, pointsSpent: 300, status: 'active', createdIso: '2026-07-01',
      usedIso: null, voidedIso: null, voidReason: null, orderNumber: null, orderId: null },
    { id: 'v-used', userId: 'u2', customerId: 'c2', memberName: 'Ben Osei', contact: 'ben@example.com',
      percent: 40, pointsSpent: 300, status: 'used', createdIso: '2026-06-01',
      usedIso: '2026-06-05', voidedIso: null, voidReason: null, orderNumber: 'VSR-1001', orderId: 'o1' },
  ],
  total: 2,
  summary: { active: 1, used: 1, void: 0, outstandingPoints: 300 },
};

describe('RedemptionsView', () => {
  test('lists vouchers + summary, and only active vouchers can be voided', async () => {
    seam.client = makeClient({ admin_member_vouchers: () => ({ data: VOUCHERS, error: null }) });
    renderR(<RedemptionsView />);

    expect(await screen.findByText('Ada Reyes')).toBeTruthy();
    expect(screen.getByText('Ben Osei')).toBeTruthy();
    // Exactly one Void button — the active voucher.
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1);
  });

  test('void flow: reason required, then calls admin_void_voucher with refund + reason', async () => {
    const voidRpc = vi.fn(() => ({ data: { ok: true, refunded_points: 300 }, error: null }));
    seam.client = makeClient({
      admin_member_vouchers: () => ({ data: VOUCHERS, error: null }),
      admin_void_voucher: voidRpc,
    });
    renderR(<RedemptionsView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    // Empty reason is blocked — no RPC fires.
    fireEvent.click(screen.getByRole('button', { name: 'Void voucher' }));
    expect(screen.getByText('A reason is required.')).toBeTruthy();
    expect(voidRpc).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('e.g. issued in error'), { target: { value: 'issued in error' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void voucher' }));

    await waitFor(() => expect(voidRpc).toHaveBeenCalledTimes(1));
    // The rpc dispatcher passes the params object to the per-name handler.
    expect(voidRpc).toHaveBeenCalledWith({
      p_voucher_id: 'v-active', p_refund_points: true, p_reason: 'issued in error',
    });
  });

  test('missing migration 073 degrades to a calm note, not a crash', async () => {
    seam.client = makeClient({
      admin_member_vouchers: () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
    });
    renderR(<RedemptionsView />);
    expect(await screen.findByText(/not migrated yet/i)).toBeTruthy();
  });
});

/* ── Invites ──────────────────────────────────────────────────────────────── */

const INVITES = {
  rows: [
    { id: 'i1', email: 'guest1@example.com', customerId: null, pointsPromised: 180, channel: 'email',
      sentIso: '2026-07-01', convertedIso: null, converted: false, staleDays: 12 },
    { id: 'i2', email: 'guest2@example.com', customerId: null, pointsPromised: 90, channel: 'email',
      sentIso: '2026-07-20', convertedIso: '2026-07-21', converted: true, staleDays: null },
  ],
  total: 2,
  summary: { sent: 2, converted: 1, outstanding: 1, conversionPct: 50 },
};

describe('InvitesView', () => {
  test('renders the funnel and invite rows', async () => {
    seam.client = makeClient({ admin_member_invites: () => ({ data: INVITES, error: null }) });
    renderR(<InvitesView />);

    expect(await screen.findByText('guest1@example.com')).toBeTruthy();
    expect(screen.getByText('converted')).toBeTruthy();       // the converted row's chip
    expect(screen.getByText('12d outstanding')).toBeTruthy(); // the stale row's chip
  });

  test('bulk dialog surfaces the server-computed eligible count', async () => {
    seam.client = makeClient({
      admin_member_invites: () => ({ data: INVITES, error: null }),
      admin_invitable_guests: () => ({ data: { rows: [
        { contact: 'g@example.com', displayName: 'G', points: 200, customerId: null },
      ], total: 1 }, error: null }),
    });
    renderR(<InvitesView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Invite eligible guests' }));
    expect(await screen.findByRole('button', { name: /Send 1 invite/ })).toBeTruthy();
  });
});

/* ── bulkInvite fan-out ───────────────────────────────────────────────────── */

describe('bulkInvite', () => {
  test('sends one send-invite call per guest and reports progress', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: null }));
    seam.client = makeClient({}, invoke);
    const guests: InvitableGuest[] = [
      { contact: 'a@example.com', displayName: 'A', points: 100, customerId: null },
      { contact: 'b@example.com', displayName: 'B', points: 200, customerId: null },
    ];
    const progress: number[] = [];
    const final = await bulkInvite(guests, (p) => progress.push(p.sent + p.failed), 0);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toBe('send-invite');
    expect(final).toEqual({ sent: 2, failed: 0, total: 2, done: true });
    expect(progress[progress.length - 1]).toBe(2);
  });

  test('a failed send counts as failed, not sent', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'resend down' } }));
    seam.client = makeClient({}, invoke);
    const final = await bulkInvite(
      [{ contact: 'a@example.com', displayName: 'A', points: 100, customerId: null }],
      () => {}, 0,
    );
    expect(final).toEqual({ sent: 0, failed: 1, total: 1, done: true });
  });
});
