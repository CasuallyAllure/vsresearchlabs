// @vitest-environment happy-dom
/**
 * ReferralCard — the member portal's referral requisition module (076).
 *
 * The supabase seam is mocked (mirrors tests/unit/memberSubViews.test.tsx); a
 * unit test never touches the live client. Covered: the on-demand fetch (no
 * RPC until "Get referral code" is pressed), the rendered code + copy control,
 * and the calm error degradation. The real RPC semantics (idempotency, gates,
 * coupon terms) are proven in tests/integration/memberReferrals.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import { ReferralCard } from '../../src/components/account/ReferralCard';

afterEach(cleanup);
beforeEach(() => { seam.client = null; });

type RpcHandler = (args: unknown) => { data: unknown; error: unknown };

/** Mock client: rpc per-name handlers + the mount-time member_referral_codes
 *  read (from().select().maybeSingle()), which resolves `existingCode`. */
function makeClient(handlers: Record<string, RpcHandler>, existingCode: string | null = null) {
  const rpc = vi.fn(async (name: string, args?: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  const maybeSingle = vi.fn(async () => ({ data: existingCode ? { code: existingCode } : null, error: null }));
  const chain = { select: vi.fn(() => chain), maybeSingle };
  return { rpc, from: vi.fn(() => chain) };
}

describe('ReferralCard', () => {
  test('first visit shows the button; pressing it calls the RPC and renders the code + copy control', async () => {
    const referralRpc = vi.fn(() => ({ data: { code: 'REF-A2B3C4', percent: 10, uses: 3 }, error: null }));
    const client = makeClient({ get_my_referral_code: referralRpc });
    seam.client = client;
    render(<ReferralCard />);

    // On-demand only — no RPC before the button is pressed.
    expect(referralRpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Get referral code' }));

    await waitFor(() => expect(referralRpc).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('REF-A2B3C4')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText('Recorded uses: 3')).toBeTruthy();
  });

  test('an RPC error degrades to calm text, not a crash', async () => {
    seam.client = makeClient({
      get_my_referral_code: () => ({ data: null, error: { message: 'boom' } }),
    });
    render(<ReferralCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Get referral code' }));
    expect(await screen.findByText('Referral codes are unavailable right now.')).toBeTruthy();
  });

  test('an already-issued code auto-surfaces on mount WITHOUT calling the issuing RPC', async () => {
    const referralRpc = vi.fn(() => ({ data: { code: 'REF-ZZZZZZ', percent: 10, uses: 0 }, error: null }));
    seam.client = makeClient({ get_my_referral_code: referralRpc }, 'REF-EXIST1');
    render(<ReferralCard />);

    // The stored code appears from the plain table read…
    expect(await screen.findByText('REF-EXIST1')).toBeTruthy();
    // …and the mint-on-first-call RPC was never invoked (auto-issuance guard).
    expect(referralRpc).not.toHaveBeenCalled();
    // Uses count is unknown from the table read — the line is simply omitted.
    expect(screen.queryByText(/Recorded uses:/)).toBeNull();
  });
});
