// @vitest-environment happy-dom
/**
 * Shared member-management panels (src/components/admin/accountPanels).
 *
 * These are the SAME components the customer-detail page and the /admin/members
 * rows render, so pinning them here covers both surfaces at once. The supabase
 * seam is mocked (tests/setup.ts forbids a unit test touching the live client)
 * and `confirm` is injected as a prop, so each test drives one RPC path end to
 * end: validation → confirm → the exact admin_* RPC call, plus the cancel and
 * bad-input branches that must NOT call an RPC.
 *
 * The real row-level behaviour of those RPCs (audit rows, ledger append, RLS)
 * is proven separately against a real Postgres in
 * tests/integration/memberWritePaths.test.ts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mutable seam: swap the mock client per test without re-importing the panels.
const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.client;
  },
}));

import { ProfileFlagsPanel } from '../../src/components/admin/accountPanels/ProfileFlagsPanel';
import { RewardsPanel } from '../../src/components/admin/accountPanels/RewardsPanel';
import { DiscountsPanel } from '../../src/components/admin/accountPanels/DiscountsPanel';
import { rewardCampaignKey, type DiscountRow, type ProfileRow } from '../../src/components/admin/accountPanels/shared';

afterEach(cleanup);
beforeEach(() => {
  seam.client = null;
});

/** A mock supabase client: from(table).select().eq().order()/.limit() resolves
 *  to that table's fixture rows; rpc() records its calls. */
function makeClient(opts: {
  rpc?: ReturnType<typeof vi.fn>;
  ledger?: unknown[];
  discounts?: unknown[];
  vouchers?: unknown[];
  optOut?: boolean;
  invoke?: ReturnType<typeof vi.fn>;
} = {}) {
  const rpc = opts.rpc ?? vi.fn(async () => ({ error: null }));
  const invoke = opts.invoke ?? vi.fn(async () => ({ data: { status: 'sent' }, error: null }));
  const results: Record<string, { data: unknown; error: null }> = {
    reward_ledger: { data: opts.ledger ?? [], error: null },
    customer_discounts: { data: opts.discounts ?? [], error: null },
    reward_vouchers: { data: opts.vouchers ?? [], error: null },
    customer_profiles: { data: [{ marketing_opt_out: opts.optOut ?? false }], error: null },
  };
  function chainFor(table: string) {
    const result = results[table] ?? { data: [], error: null };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(async () => result),
      limit: vi.fn(async () => result),
    };
    return chain;
  }
  return { from: vi.fn((t: string) => chainFor(t)), rpc, functions: { invoke } };
}

const approve = () => vi.fn(async () => true);
const decline = () => vi.fn(async () => false);

/** Submit the form that owns `el` — reliable across happy-dom, where a click on
 *  a type=submit button does not always dispatch the form's submit event. */
function submitFormOf(el: Element) {
  const form = el.closest('form');
  if (!form) throw new Error('element is not inside a form');
  fireEvent.submit(form);
}

const PROFILE: ProfileRow = {
  user_id: 'user-1',
  full_name: 'Test Member',
  tier: 'member',
  status: 'active',
  account_type: 'individual',
  business_name: null,
  free_shipping: false,
};

// ── ProfileFlagsPanel → admin_set_profile_flags ─────────────────────────────

describe('ProfileFlagsPanel', () => {
  test('saving a changed tier confirms then calls admin_set_profile_flags', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = approve();

    render(<ProfileFlagsPanel profile={PROFILE} contact="a@example.com" confirm={confirm} onSaved={() => {}} />);

    const tier = screen.getByDisplayValue('Member');
    fireEvent.change(tier, { target: { value: 'pro' } });
    submitFormOf(tier);

    await screen.findByText(/profile flags saved/i);
    expect(confirm).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admin_set_profile_flags', expect.objectContaining({
      p_user_id: 'user-1',
      p_tier: 'pro',
      p_status: 'active',
      p_account_type: 'individual',
      p_free_shipping: false,
    }));
  });

  test('declining the confirm does not call the RPC', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = decline();

    render(<ProfileFlagsPanel profile={PROFILE} contact="a@example.com" confirm={confirm} onSaved={() => {}} />);
    const tier = screen.getByDisplayValue('Member');
    fireEvent.change(tier, { target: { value: 'pro' } });
    submitFormOf(tier);

    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a business account with no business name is rejected before confirm', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = approve();

    render(<ProfileFlagsPanel profile={PROFILE} contact="a@example.com" confirm={confirm} onSaved={() => {}} />);
    const accountType = screen.getByDisplayValue('Individual');
    fireEvent.change(accountType, { target: { value: 'business' } });
    submitFormOf(accountType);

    await screen.findByText(/business accounts need a business name/i);
    expect(confirm).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── RewardsPanel → admin_adjust_reward_points ───────────────────────────────

describe('RewardsPanel', () => {
  test('a valid adjustment confirms then calls admin_adjust_reward_points', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc, ledger: [] });
    const confirm = approve();

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={confirm} />);

    const points = await screen.findByPlaceholderText('-25');
    fireEvent.change(points, { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText(/goodwill/i), { target: { value: 'Loyalty bonus' } });
    submitFormOf(points);

    await screen.findByText(/adjustment recorded/i);
    expect(confirm).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admin_adjust_reward_points', {
      p_user_id: 'user-1',
      p_points: 50,
      p_note: 'Loyalty bonus',
    });
  });

  test('zero points is rejected before confirm', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = approve();

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={confirm} />);
    const points = await screen.findByPlaceholderText('-25');
    fireEvent.change(points, { target: { value: '0' } });
    fireEvent.change(screen.getByPlaceholderText(/goodwill/i), { target: { value: 'x' } });
    submitFormOf(points);

    await screen.findByText(/non-zero whole number/i);
    expect(confirm).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a missing note is rejected before confirm', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = approve();

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={confirm} />);
    const points = await screen.findByPlaceholderText('-25');
    fireEvent.change(points, { target: { value: '25' } });
    submitFormOf(points);

    await screen.findByText(/note is required/i);
    expect(confirm).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── RewardsPanel → reward status + Notify member ────────────────────────────

describe('rewardCampaignKey', () => {
  test('keys every balance in the same 300-point stage identically', () => {
    expect(rewardCampaignKey(300)).toBe('rr-1');
    expect(rewardCampaignKey(301)).toBe('rr-1');
    expect(rewardCampaignKey(599)).toBe('rr-1');
    expect(rewardCampaignKey(600)).toBe('rr-2');
  });
});

describe('RewardsPanel reward status + notify', () => {
  const readyLedger = [{ kind: 'earn', points: 301, note: null, created_at: '2026-01-01T00:00:00Z', order_id: null }];

  test('an active voucher is shown and the redeem action is hidden', async () => {
    seam.client = makeClient({
      ledger: readyLedger,
      vouchers: [{ percent: 40, status: 'active', created_at: '2026-02-01T00:00:00Z' }],
    });

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={approve()} />);

    await screen.findByText(/voucher active/i);
    expect(screen.queryByRole('button', { name: /redeem for member/i })).toBeNull();
  });

  test('a balance under threshold shows progress toward the next reward', async () => {
    seam.client = makeClient({
      ledger: [{ kind: 'earn', points: 245, note: null, created_at: '2026-01-01T00:00:00Z', order_id: null }],
    });

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={approve()} />);

    await screen.findByText(/245 \/ 300 pts toward next reward/i);
  });

  test('notifying a ready member sends through send-member-offer keyed to its stage', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'sent' }, error: null }));
    seam.client = makeClient({ ledger: readyLedger, invoke });
    const confirm = approve();

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={confirm} />);
    fireEvent.click(await screen.findByRole('button', { name: /notify member/i }));

    await screen.findByText(/notification sent/i);
    expect(invoke).toHaveBeenCalledWith('send-member-offer', expect.objectContaining({
      body: expect.objectContaining({
        contact: 'santos@example.com', campaign_key: 'rr-1', kind: 'reward_ready', offer: null,
      }),
    }));
  });

  test('a repeat notify reports already sent instead of mailing twice', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'already_sent' }, error: null }));
    seam.client = makeClient({ ledger: readyLedger, invoke });

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={approve()} />);
    fireEvent.click(await screen.findByRole('button', { name: /notify member/i }));

    await screen.findByText(/already sent/i);
    expect(invoke).toHaveBeenCalledOnce();
  });

  test('an opted-out member cannot trigger a notify send', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'sent' }, error: null }));
    seam.client = makeClient({ ledger: readyLedger, invoke, optOut: true });

    render(<RewardsPanel userId="user-1" contact="santos@example.com" confirm={approve()} />);
    const button = await screen.findByRole('button', { name: /notify member/i }) as HTMLButtonElement;
    await vi.waitFor(() => expect(button.disabled).toBe(true));

    fireEvent.click(button);
    expect(invoke).not.toHaveBeenCalled();
  });
});

// ── DiscountsPanel → admin_set_customer_discount / _deactivate ──────────────

describe('DiscountsPanel', () => {
  test('a valid rule confirms then calls admin_set_customer_discount', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc, discounts: [] });
    const confirm = approve();

    render(<DiscountsPanel userId="user-1" accountType="individual" confirm={confirm} />);

    const percent = await screen.findByPlaceholderText('10');
    fireEvent.change(percent, { target: { value: '20' } });
    fireEvent.change(screen.getByPlaceholderText('Lifetime 10%'), { target: { value: 'Lifetime 20%' } });
    submitFormOf(percent);

    await screen.findByText(/discount rule set/i);
    expect(confirm).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admin_set_customer_discount', expect.objectContaining({
      p_user_id: 'user-1',
      p_scope: 'lifetime',
      p_percent: 20,
      p_label: 'Lifetime 20%',
    }));
  });

  test('an out-of-range percent is rejected before confirm', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc });
    const confirm = approve();

    render(<DiscountsPanel userId="user-1" accountType="individual" confirm={confirm} />);
    const percent = await screen.findByPlaceholderText('10');
    fireEvent.change(percent, { target: { value: '150' } });
    fireEvent.change(screen.getByPlaceholderText('Lifetime 10%'), { target: { value: 'Too big' } });
    submitFormOf(percent);

    await screen.findByText(/at most 100/i);
    expect(confirm).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test('the business scope option is disabled for an individual account', async () => {
    seam.client = makeClient({ discounts: [] });
    render(<DiscountsPanel userId="user-1" accountType="individual" confirm={approve()} />);

    await screen.findByPlaceholderText('10');
    const businessOption = screen.getByRole('option', { name: /business/i }) as HTMLOptionElement;
    expect(businessOption.disabled).toBe(true);
  });

  test('deactivating a live rule confirms then calls admin_deactivate_customer_discount', async () => {
    const live: DiscountRow = {
      id: 'disc-1', scope: 'lifetime', percent: 10, label: 'Lifetime 10%',
      active: true, expires_at: null, created_at: '2026-01-01T00:00:00Z',
    };
    const rpc = vi.fn(async () => ({ error: null }));
    seam.client = makeClient({ rpc, discounts: [live] });
    const confirm = approve();

    render(<DiscountsPanel userId="user-1" accountType="individual" confirm={confirm} />);

    fireEvent.click(await screen.findByRole('button', { name: /deactivate/i }));

    await vi.waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_deactivate_customer_discount', { p_id: 'disc-1' }),
    );
    expect(confirm).toHaveBeenCalledOnce();
  });
});
