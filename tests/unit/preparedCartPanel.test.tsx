// @vitest-environment happy-dom
/**
 * PreparedCartPanel — the "Build cart" composer inside the expanded roster row.
 *
 * The supabase seam is mocked (a unit test never touches the live client); the
 * real RPC behaviour — the is_admin() gate, token hashing, the price-key
 * refusal — is proven against real Postgres in
 * tests/integration/preparedCarts.test.ts.
 *
 * What this file pins is the composer's contract with the admin:
 *   • TWO DEPENDENT DROPDOWNS, and the dose list repopulates per compound. The
 *     admin must never type a SKU, so there is no free-text SKU input at all.
 *   • The member's OWN effective price is shown, not list price — the whole
 *     point of building the cart from the roster row rather than the order
 *     screen.
 *   • NO unit-price input exists. place-order fails closed on a client-supplied
 *     price, so a bespoke number belongs in the coupon field or nowhere.
 *   • Send goes through ConfirmModal's `confirm`, never window.confirm, which
 *     iOS silently suppresses after "Block Alerts".
 *   • Only (sku, dose, quantity) reaches the RPC.
 *   • Every dose option, and every picked line, NAMES ITS SHIPPING TIER. The
 *     two tiers are priced differently and B2G1 reaches sourced lines only, so
 *     picking blind can build a cart that does not behave as the admin expects.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

// A tiny, deterministic catalog in place of the real 71-product JSON, so the
// dropdown assertions are about the component, not about inventory data.
vi.mock('../../src/data/products.json', () => ({
  default: [
    {
      sku: 'VSR-RS-BPC', id: 'VSR-RS-BPC', name: 'BPC-157', priceCents: null,
      variants: [{ dose: '5mg' }, { dose: '10mg' }],
    },
    {
      sku: 'VSR-RS-RETA', id: 'VSR-RS-RETA', name: 'Retatrutide', priceCents: null,
      variants: [{ dose: '15mg' }],
    },
  ],
}));
vi.mock('../../src/data/biopeptideCompounds.generated.json', () => ({ default: [] }));

import { PreparedCartPanel } from '../../src/pages/admin/members/PreparedCartPanel';
import { useProductOverrides, type VariantOverride } from '../../src/lib/productOverrides';
import type { MemberRow } from '../../src/pages/admin/membersView';

// BPC deliberately straddles BOTH shipping tiers — 5mg carries on-hand supply
// (24 Hour), 10mg is drop-shipped (Sourced) — because a compound-level tier
// shortcut would pass a single-tier fixture and lie here.
const OVERRIDES: Record<string, Record<string, VariantOverride>> = {
  'VSR-RS-BPC': {
    '5mg': { sku: 'VSR-RS-BPC', dose: '5mg', on_hand: 5, inbound_units: 0, price_cents: 6_000, lead_days: null, hidden: false },
    '10mg': { sku: 'VSR-RS-BPC', dose: '10mg', on_hand: 0, inbound_units: 0, price_cents: 10_000, lead_days: 9, hidden: false },
  },
  'VSR-RS-RETA': {
    '15mg': { sku: 'VSR-RS-RETA', dose: '15mg', on_hand: 5, inbound_units: 0, price_cents: 24_000, lead_days: null, hidden: false },
  },
};

const MEMBER = {
  userId: 'u1', id: 'c1', name: 'Ada Reyes', contact: 'ada@example.com', org: null,
  tier: 'member', accountType: 'individual', businessName: null, freeShipping: false,
  status: 'active', spendCents: 0, ttmSpendCents: 0, paidOrders: 0, points: 0,
  rewardReady: false, effectivePercent: 15, discountLabel: 'Account-holder 15%',
  discountScope: 'lifetime', discountExpiresIso: null, joinedIso: '2026-01-01',
  lastOrderIso: null, segment: 'new', vip: false, spendPercentile: 0,
} as unknown as MemberRow;

type RpcResult = { data: unknown; error: unknown };
/** May also REJECT, or return a promise that never settles — both are shapes
 *  the live client can produce and both used to hang the button forever. */
type RpcHandler = (args: unknown) => RpcResult | Promise<RpcResult>;

function makeClient(handlers: Record<string, RpcHandler>) {
  const rpc = vi.fn(async (name: string, args: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  return { rpc, from: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) };
}

const EMPTY_LIST: RpcHandler = () => ({ data: { rows: [] }, error: null });

/** Always-yes confirm, standing in for useConfirm's ConfirmModal. */
const yes = vi.fn(async () => true);
const no = vi.fn(async () => false);

function selects() {
  return screen.getAllByRole('combobox') as HTMLSelectElement[];
}

/** Add one line to the composer: pick the compound, then the dose. */
function pickLine(compound: string, optionKey: string) {
  const [compoundSelect, doseSelect] = selects();
  fireEvent.change(compoundSelect, { target: { value: compound } });
  fireEvent.change(doseSelect, { target: { value: optionKey } });
}

/** Every failure path is required to console.error the RAW object; capturing it
 *  keeps the run quiet AND lets the tests assert that it really happened. */
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useProductOverrides.setState({ variantBySku: OVERRIDES, loaded: true, loading: false });
  seam.client = makeClient({ admin_prepared_carts: EMPTY_LIST });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  yes.mockClear();
  no.mockClear();
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: false, loading: false, error: null });
});

describe('PreparedCartPanel — the line editor', () => {
  test('offers a compound dropdown and a dose dropdown, and never a SKU text field', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    const [compoundSelect, doseSelect] = selects();
    expect([...compoundSelect.options].map((o) => o.value)).toEqual(['', 'BPC-157', 'Retatrutide']);
    // Dose is inert until a compound is chosen — no orphan (sku, dose) pairing.
    expect(doseSelect.disabled).toBe(true);

    // Nothing in the composer accepts a typed SKU or a typed price.
    const textInputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    for (const input of textInputs) {
      expect(input.value).toBe('');
      expect(/sku|price|unit/i.test(input.getAttribute('placeholder') ?? '')).toBe(false);
    }
  });

  test('the dose list repopulates when the compound changes', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    const [compoundSelect] = selects();
    fireEvent.change(compoundSelect, { target: { value: 'BPC-157' } });
    expect([...selects()[1].options].map((o) => o.value))
      .toEqual(['', 'VSR-RS-BPC|5mg', 'VSR-RS-BPC|10mg']);

    fireEvent.change(compoundSelect, { target: { value: 'Retatrutide' } });
    const doseValues = [...selects()[1].options].map((o) => o.value);
    expect(doseValues).toEqual(['', 'VSR-RS-RETA|15mg']);
    // The previous compound's dose must not survive the switch.
    expect(selects()[1].value).toBe('');
  });

  test('every dose option names its own shipping tier', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    fireEvent.change(selects()[0], { target: { value: 'BPC-157' } });
    const labels = [...selects()[1].options].map((o) => o.text);

    expect(labels[1]).toContain('24 Hour Shipping');
    expect(labels[2]).toContain('Standard Shipping · 7–10 business days');
    // Same SKU, opposite tiers — neither dose may borrow the other's.
    expect(labels[1]).not.toContain('Standard');
    expect(labels[2]).not.toContain('24 Hour');
    // The price the admin was already relying on stays in the label.
    expect(labels[1]).toContain('$60');
    expect(labels[2]).toContain('$100');
  });

  test('the compound dropdown says "all" only when the doses really agree', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    const labels = [...selects()[0].options].map((o) => o.text);

    // BPC has one 24-hour dose and one sourced dose.
    expect(labels[1]).toBe('BPC-157 · mixed tiers');
    // Retatrutide's only dose is 24-hour, so "all" is the truth.
    expect(labels[2]).toBe('Retatrutide · all 24 Hour');
  });

  test('the picked tier stays visible on the line row after selection', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    expect(screen.getByText('24 Hour')).toBeTruthy();
    expect(screen.queryByText('Sourced')).toBeNull();

    // Switching dose within the same compound re-reads the tier per dose.
    fireEvent.change(selects()[1], { target: { value: 'VSR-RS-BPC|10mg' } });
    expect(screen.getByText('Sourced')).toBeTruthy();
    expect(screen.queryByText('24 Hour')).toBeNull();
  });

  test('states that B2G1 cannot reach a 24 Hour line', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    expect(screen.getByText(/a 24 Hour line never earns a free third unit/i)).toBeTruthy();
  });

  test("shows THIS member's price, not list price", async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|10mg');

    // $100 list at the member's own 15% → $85, shown per unit AND as the total,
    // with the label naming the rule the server will actually apply.
    expect(screen.getAllByText('$85').length).toBeGreaterThan(0);
    expect(screen.getByText('Account-holder 15%')).toBeTruthy();
    expect(screen.getByText('−$15')).toBeTruthy();
    expect(screen.getAllByText('$100').length).toBeGreaterThan(0); // list price, kept visible
    expect(screen.getByText('Ada pays')).toBeTruthy();
  });
});

describe('PreparedCartPanel — sending', () => {
  test('confirms through ConfirmModal and sends only (sku, dose, quantity)', async () => {
    const create = vi.fn(() => ({
      data: { cart_id: 'cart-1', token: 'a'.repeat(64), expires_at: '2026-08-13T00:00:00Z' },
      error: null,
    }));
    const client = makeClient({ admin_prepared_carts: EMPTY_LIST, admin_create_prepared_cart: create });
    seam.client = client;

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|10mg');
    fireEvent.change(screen.getByPlaceholderText('e.g. SPRING20'), { target: { value: 'spring20' } });
    fireEvent.click(screen.getByRole('button', { name: /build cart/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());

    // The confirmation went through the in-app modal, never window.confirm.
    expect(yes).toHaveBeenCalledTimes(1);
    expect(String(yes.mock.calls[0][0])).toMatch(/Ada Reyes/);

    const args = create.mock.calls[0][0] as { p_lines: unknown[]; p_coupon_code: string };
    expect(args.p_lines).toEqual([{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 }]);
    expect(args.p_coupon_code).toBe('spring20');
    // No price, in any spelling, ever leaves the client.
    expect(JSON.stringify(args.p_lines)).not.toMatch(/price|cents|amount/i);
  });

  test('declining the confirmation sends nothing', async () => {
    const create = vi.fn(() => ({ data: null, error: null }));
    seam.client = makeClient({ admin_prepared_carts: EMPTY_LIST, admin_create_prepared_cart: create });

    render(<PreparedCartPanel member={MEMBER} confirm={no} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build cart/i }));

    await waitFor(() => expect(no).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
  });

  test('the claim link is shown once, as a hash fragment', async () => {
    const token = 'b'.repeat(64);
    seam.client = makeClient({
      admin_prepared_carts: EMPTY_LIST,
      admin_create_prepared_cart: () => ({
        data: { cart_id: 'cart-1', token, expires_at: '2026-08-13T00:00:00Z' }, error: null,
      }),
    });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build cart/i }));

    // A fragment is never sent to a server and never rides in a Referer header.
    const link = await screen.findByText(new RegExp(`/account/prepared#t=${token}`));
    expect(link).toBeTruthy();
  });

  test('the build button stays disabled until a dose is actually picked', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());

    const button = screen.getByRole('button', { name: /build cart/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // A compound alone is not a line — the dose is what makes it orderable.
    fireEvent.change(selects()[0], { target: { value: 'BPC-157' } });
    expect((screen.getByRole('button', { name: /build cart/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(selects()[1], { target: { value: 'VSR-RS-BPC|5mg' } });
    expect((screen.getByRole('button', { name: /build cart/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('PreparedCartPanel — degradation', () => {
  test('a missing 081 renders a calm note instead of crashing', async () => {
    seam.client = makeClient({
      admin_prepared_carts: () => ({ data: null, error: { code: 'PGRST202', message: 'could not find the function' } }),
    });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);

    expect(await screen.findByText(/migration 081/i)).toBeTruthy();
  });
});

/**
 * The hang. "Build cart" latched on "Working…" in production and never came
 * back: `busy` was cleared on the one happy line after the await, so a rejected
 * or never-settling RPC skipped it entirely and the admin was left with no
 * error, no result and no way forward. Every case below must end with the
 * button usable again AND a reason on screen.
 */
describe('PreparedCartPanel — a failing RPC must never latch the button', () => {
  /** A promise we can settle by hand, so "Working…" is genuinely observable
   *  mid-flight rather than inferred. */
  function deferred() {
    let settle!: { reject: (e: unknown) => void };
    const promise = new Promise<RpcResult>((_, reject) => { settle = { reject }; });
    return { promise, ...settle };
  }

  async function startBuild() {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByText('Built carts')).toBeTruthy());
    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build cart/i }));
  }

  test('a rejecting build RPC clears "Working…" and renders the reason', async () => {
    const gate = deferred();
    seam.client = makeClient({
      admin_prepared_carts: EMPTY_LIST,
      admin_create_prepared_cart: () => gate.promise,
    });

    await startBuild();
    expect(await screen.findByText('Working…')).toBeTruthy();

    gate.reject(new TypeError('Failed to fetch'));

    // The message reaches the ADMIN, not just the console — a silent reset
    // would look identical to a build that quietly did nothing.
    expect(await screen.findByText(/Failed to fetch/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Working…')).toBeNull());
    expect((screen.getByRole('button', { name: 'Build cart' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('a build RPC that never settles times out instead of hanging forever', async () => {
    seam.client = makeClient({
      admin_prepared_carts: EMPTY_LIST,
      // The production shape: supabase-js awaits auth.getSession() before it
      // ever reaches fetch, and fetch itself has no timeout — so the promise
      // can simply never settle. No amount of error handling catches this.
      admin_create_prepared_cart: () => new Promise<RpcResult>(() => {}),
    });

    // Faked from before the click, because the guard's timer is armed inside
    // the RPC call itself — installing them afterwards would never fire it.
    vi.useFakeTimers();
    try {
      const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

      render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
      await flush();
      pickLine('BPC-157', 'VSR-RS-BPC|5mg');
      fireEvent.click(screen.getByRole('button', { name: /build cart/i }));
      await flush();

      expect(screen.getByText('Working…')).toBeTruthy();

      // Nothing will ever settle this call. Fourteen seconds in, the admin is
      // still (correctly) waiting.
      await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
      expect(screen.getByText('Working…')).toBeTruthy();

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(screen.getByText(/did not respond within 15s/i)).toBeTruthy();
      expect(screen.queryByText('Working…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a resolved RPC error surfaces its message and logs the raw object', async () => {
    const raw = { code: '42501', message: 'Unauthorized: admin role required' };
    seam.client = makeClient({
      admin_prepared_carts: EMPTY_LIST,
      admin_create_prepared_cart: () => ({ data: null, error: raw }),
    });

    await startBuild();

    expect(await screen.findByText(/admin role required/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Working…')).toBeNull());
    // The raw object, not the friendly string — the next person debugging in
    // production needs the code and the hint, not a sentence.
    expect(consoleError.mock.calls.some(([, arg]) => arg === raw)).toBe(true);
  });

  test('a rejecting revoke RPC surfaces the reason and re-enables the row', async () => {
    const gate = deferred();
    seam.client = makeClient({
      admin_prepared_carts: () => ({
        data: {
          rows: [{
            id: 'cart-9', created_at: '2026-07-30T00:00:00Z', expires_at: '2026-08-13T00:00:00Z',
            claimed_at: null, revoked_at: null, coupon_code: null, note: null, status: 'live',
            lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
          }],
        },
        error: null,
      }),
      admin_revoke_prepared_cart: () => gate.promise,
    });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    fireEvent.click(await screen.findByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(yes).toHaveBeenCalled());

    gate.reject(new Error('network unreachable'));

    expect(await screen.findByText(/network unreachable/)).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /revoke/i }) as HTMLButtonElement).disabled).toBe(false));
  });

  test('a stale schema cache is not swallowed into a silent "not migrated" placeholder', async () => {
    // 081 WAS applied; PostgREST's cache has simply not reloaded yet. That is
    // indistinguishable from a missing migration by error code, so the calm
    // placeholder stays — but it must not be the whole story.
    const raw = {
      code: 'PGRST202',
      message: 'Could not find the function public.admin_prepared_carts(p_limit, p_user_id) in the schema cache',
    };
    seam.client = makeClient({ admin_prepared_carts: () => ({ data: null, error: raw }) });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);

    expect(await screen.findByText(/migration 081/i)).toBeTruthy();
    // The owner is told WHICH of the two it is, instead of seeing neither an
    // error nor a result.
    expect(screen.getByText(/schema cache is still stale/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/in the schema cache/i);
    expect(consoleError.mock.calls.some(([, arg]) => arg === raw)).toBe(true);
  });
});
