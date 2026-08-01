// @vitest-environment happy-dom
/**
 * PreparedCartPanel — a member's prepared carts inside the expanded roster row:
 * the list, each cart's opened detail, and the composer that builds a new one.
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
import { MemoryRouter } from 'react-router-dom';
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

/** The send-prepared-cart edge call. Defaults to a clean delivery so the older
 *  build assertions stay about BUILDING; the delivery-reporting suite below
 *  overrides it per case. */
type InvokeResult = { data: unknown; error: unknown };
type InvokeHandler = (body: unknown) => InvokeResult | Promise<InvokeResult>;

const SENT: InvokeHandler = () => ({
  data: { ok: true, status: 'sent', recipient: 'ada@example.com' },
  error: null,
});

/** The `email_log` read behind "did the email actually go out?". PostgREST's
 *  builder is CHAINABLE and only resolves when awaited, so the stub has to be
 *  too — a bare promise would break at the first `.eq()`. */
type LogResult = { data: unknown; error: unknown };
const NO_LOG: LogResult = { data: [], error: null };

function makeClient(
  handlers: Record<string, RpcHandler>,
  invoke: InvokeHandler = SENT,
  emailLog: LogResult = NO_LOG,
) {
  const rpc = vi.fn(async (name: string, args: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  const from = vi.fn((table: string) => {
    const result = table === 'email_log' ? emailLog : NO_LOG;
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      then: (ok: (r: LogResult) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, fail),
    };
    return chain;
  });
  return {
    rpc,
    from,
    functions: { invoke: vi.fn(async (_fn: string, opts: { body: unknown }) => invoke(opts?.body)) },
  };
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    const labels = [...selects()[0].options].map((o) => o.text);

    // BPC has one 24-hour dose and one sourced dose.
    expect(labels[1]).toBe('BPC-157 · mixed tiers');
    // Retatrutide's only dose is 24-hour, so "all" is the truth.
    expect(labels[2]).toBe('Retatrutide · all 24 Hour');
  });

  test('the picked tier stays visible on the line row after selection', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    expect(screen.getByText(/a 24 Hour line never earns a free third unit/i)).toBeTruthy();
  });

  test("shows THIS member's price, not list price", async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|10mg');
    fireEvent.change(screen.getByPlaceholderText('e.g. SPRING20'), { target: { value: 'spring20' } });
    fireEvent.click(screen.getByRole('button', { name: /build & send/i }));

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build & send/i }));

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build & send/i }));

    // A fragment is never sent to a server and never rides in a Referer header.
    const link = await screen.findByText(new RegExp(`/account/prepared#t=${token}`));
    expect(link).toBeTruthy();
  });

  test('the build button stays disabled until a dose is actually picked', async () => {
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());

    const button = screen.getByRole('button', { name: /build & send/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // A compound alone is not a line — the dose is what makes it orderable.
    fireEvent.change(selects()[0], { target: { value: 'BPC-157' } });
    expect((screen.getByRole('button', { name: /build & send/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(selects()[1], { target: { value: 'VSR-RS-BPC|5mg' } });
    expect((screen.getByRole('button', { name: /build & send/i }) as HTMLButtonElement).disabled).toBe(false);
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());
    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build & send/i }));
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
    expect((screen.getByRole('button', { name: 'Build & send cart' }) as HTMLButtonElement).disabled).toBe(false);
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
      fireEvent.click(screen.getByRole('button', { name: /build & send/i }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(yes).toHaveBeenCalled());

    gate.reject(new Error('network unreachable'));

    expect(await screen.findByText(/network unreachable/)).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Revoke' }) as HTMLButtonElement).disabled).toBe(false));
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

/**
 * DELIVERY TRUTH.
 *
 * The panel is the owner's only evidence that a client was contacted. Every
 * case below exists because reporting the wrong one has a real cost: a false
 * "sent" leaves a client waiting for an email that never arrives (which is how
 * this whole workstream started), and a false "failed" gets a member emailed
 * twice. The link stays copyable in EVERY case, because it is the fallback.
 */
describe('PreparedCartPanel — what the owner is told about the email', () => {
  const TOKEN = 'c'.repeat(64);

  async function buildWith(invoke: InvokeHandler) {
    seam.client = makeClient(
      {
        admin_prepared_carts: EMPTY_LIST,
        admin_create_prepared_cart: () => ({
          data: { cart_id: 'cart-9', token: TOKEN, expires_at: '2026-08-13T00:00:00Z' }, error: null,
        }),
      },
      invoke,
    );
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());
    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.click(screen.getByRole('button', { name: /build & send/i }));
  }

  test('the send carries the cart id and the plaintext token — the only moment it exists', async () => {
    await buildWith(SENT);
    await screen.findByText(/Emailed to ada@example.com/i);

    const client = seam.client as { functions: { invoke: ReturnType<typeof vi.fn> } };
    expect(client.functions.invoke).toHaveBeenCalledWith('send-prepared-cart', {
      body: { cart_id: 'cart-9', token: TOKEN },
    });
  });

  test('a delivery failure is REPORTED, never reported as success', async () => {
    await buildWith(() => ({ data: null, error: { message: 'Email delivery failed.' } }));

    const note = await screen.findByText(/The email did not go out/i);
    // Announced, not just printed — the owner may have scrolled away from this
    // panel by the time the send comes back.
    expect(note.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText(/Emailed to/i)).toBeNull();
  });

  test('the copyable link survives a failed send — it is the fallback', async () => {
    await buildWith(() => ({ data: null, error: { message: 'Email delivery failed.' } }));
    await screen.findByText(/The email did not go out/i);

    expect(screen.getByText(new RegExp(`/account/prepared#t=${TOKEN}`))).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
  });

  test('an opted-out member is named as NOT emailed, not quietly skipped', async () => {
    // Consent is honoured the way 075's winback kind honours it, and the
    // suppression is surfaced so the owner can use a channel they agreed to.
    await buildWith(() => ({
      data: { ok: false, status: 'opted_out', recipient: 'ada@example.com' }, error: null,
    }));

    const note = await screen.findByText(/has opted out of marketing email/i);
    expect(note.textContent).toMatch(/Not emailed/i);
    expect(screen.queryByText(/Emailed to/i)).toBeNull();
  });

  test('a duplicate send says "already emailed" rather than claiming a second one went out', async () => {
    await buildWith(() => ({
      data: { ok: false, status: 'already_sent', recipient: 'ada@example.com' }, error: null,
    }));
    expect(await screen.findByText(/Already emailed/i)).toBeTruthy();
  });

  test('an unrecognisable response is a failure, not an optimistic success', async () => {
    await buildWith(() => ({ data: { surprise: true }, error: null }));
    expect(await screen.findByText(/The email did not go out/i)).toBeTruthy();
  });

  test('a thrown send is caught — the panel and the link survive it', async () => {
    await buildWith(() => { throw new Error('network down'); });

    expect(await screen.findByText(/The email did not go out/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`#t=${TOKEN}`))).toBeTruthy();
  });
});

/**
 * THE BUILT-CARTS LIST.
 *
 * 082 made the link re-openable — the member's cart is device-local, so
 * phone-then-laptop has to work — which changed what the owner needs to see. A
 * status chip reading "claimed" would now tell them a perfectly live link was
 * spent, and they would rebuild a cart the member can already open. So status
 * answers ONE question (will this link still work?) and how often it has been
 * opened is information beside it, not a verdict.
 */
describe('PreparedCartPanel — the built-carts list', () => {
  function listing(rows: unknown[]): RpcHandler {
    return () => ({ data: { rows }, error: null });
  }

  const cart = (over: Record<string, unknown> = {}) => ({
    id: 'cart-1',
    created_at: '2026-07-30T00:00:00Z',
    expires_at: '2026-08-13T00:00:00Z',
    claimed_at: null,
    last_claimed_at: null,
    claim_count: 0,
    revoked_at: null,
    coupon_code: null,
    note: null,
    status: 'live',
    lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
    ...over,
  });

  test('an opened cart still reads LIVE, and reports how many times it was opened', async () => {
    seam.client = makeClient({
      admin_prepared_carts: listing([
        cart({ status: 'live', claim_count: 3, claimed_at: '2026-07-30T01:00:00Z', last_claimed_at: '2026-07-31T09:00:00Z' }),
      ]),
    });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);

    expect(await screen.findByText('live')).toBeTruthy();
    expect(screen.getByText(/opened 3×/)).toBeTruthy();
    // "claimed" as a STATUS is gone — it said "spent" about a working link.
    expect(screen.queryByText('claimed')).toBeNull();
  });

  test('a never-opened cart shows no open count at all', async () => {
    seam.client = makeClient({ admin_prepared_carts: listing([cart()]) });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);

    await screen.findByText('live');
    expect(screen.queryByText(/opened/i)).toBeNull();
  });

  test('an opened-but-live cart can still be revoked — that is the owner’s kill switch', async () => {
    seam.client = makeClient({
      admin_prepared_carts: listing([cart({ claim_count: 2, last_claimed_at: '2026-07-31T09:00:00Z' })]),
    });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    expect(await screen.findByRole('button', { name: 'Revoke' })).toBeTruthy();
  });

  test.each([
    ['expired', 'expired'],
    ['revoked', 'revoked'],
  ])('a %s cart offers no Revoke — there is nothing left to kill', async (status) => {
    seam.client = makeClient({ admin_prepared_carts: listing([cart({ status, claim_count: 1 })]) });

    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);

    await screen.findByText(status);
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});

/**
 * THE OPENED CART.
 *
 * The owner, verbatim: "To access the stuff that I built a cart, I have to
 * press Build a cart, which then I see a list of the ones I see. But I can't
 * open it up and see the detail of when I sent it and what's inside it. Kinda
 * defeats the purpose."
 *
 * So two properties, and each one is a separate failure if it breaks:
 *   • the carts are READABLE WITHOUT the composer — building a new cart is an
 *     action, not the way in;
 *   • a cart OPENS, and what it opens to is enough to answer a member on the
 *     phone: the lines with their doses and prices, the total at that member's
 *     own rate, when it was built, whether the email went out, when it expires,
 *     how often it was opened, the coupon, the note, and the order it became.
 *
 * And one thing that must never appear anywhere in it: `token_hash`. The read
 * RPC's explicit column list is what keeps the link digest off every client
 * surface, and the fixtures below smuggle one in to prove nothing renders it.
 */
describe('PreparedCartPanel — an opened cart', () => {
  /** A stored cart as admin_prepared_carts returns it — plus a `token_hash` the
   *  real RPC never sends, so "nothing renders it" is a proof and not a hope. */
  const SMUGGLED_HASH = 'deadbeefcafe0000deadbeefcafe0000deadbeefcafe0000deadbeefcafe0000';

  const cart = (over: Record<string, unknown> = {}) => ({
    id: 'cart-1',
    created_at: '2026-07-30T12:00:00Z',
    expires_at: '2026-08-13T12:00:00Z',
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
    token_hash: SMUGGLED_HASH,
    // Both tiers, from ONE compound: 5mg is on-hand (24 Hour), 10mg is
    // drop-shipped (Sourced). A single-tier fixture would pass a detail that
    // labelled every line the same.
    lines: [
      { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 2 },
      { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 },
    ],
    ...over,
  });

  function listing(rows: unknown[]): RpcHandler {
    return () => ({ data: { rows }, error: null });
  }

  /** A converted cart renders a react-router <Link> to the order it became, so
   *  the panel is mounted inside a router here — the real one always is. */
  function mount(rows: unknown[], emailLog: LogResult = NO_LOG) {
    seam.client = makeClient({ admin_prepared_carts: listing(rows) }, SENT, emailLog);
    return render(
      <MemoryRouter>
        <PreparedCartPanel member={MEMBER} confirm={yes} />
      </MemoryRouter>,
    );
  }

  /** Open the one listed cart. The row toggle is the button carrying the
   *  status chip; RowAction buttons are the named ones beside it. */
  async function openCart() {
    const row = await screen.findByRole('button', { expanded: false });
    fireEvent.click(row);
  }

  /** The value of a `<dt>label</dt><dd>…</dd>` money row. */
  function amountFor(label: string): string {
    const dd = screen.getByText(label).parentElement?.querySelector('dd');
    return dd?.textContent ?? '';
  }

  test('the carts are listed WITHOUT opening the builder', async () => {
    mount([cart()]);

    // The cart is on screen…
    expect(await screen.findByText('live')).toBeTruthy();
    // …and the composer is not. Building is an action from here, not the door.
    expect(screen.queryByRole('button', { name: 'Build & send cart' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Build a new cart' })).toBeTruthy();
  });

  test('the build action is one press away and still obvious', async () => {
    mount([cart()]);

    fireEvent.click(await screen.findByRole('button', { name: '+ Build a new cart' }));
    expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy();
  });

  test('a member with no carts is told so plainly and handed the builder', async () => {
    mount([]);

    expect(await screen.findByText(/Nothing built for Ada yet/i)).toBeTruthy();
    // Nothing to read means the empty state IS the form — no extra press.
    expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy();
  });

  test('an expanded cart renders every line with its dose, its tier and its price', async () => {
    mount([cart()]);
    await openCart();

    // Compound AND dose, in the catalog's own label format.
    expect(screen.getByText('BPC-157 — 5mg')).toBeTruthy();
    expect(screen.getByText('BPC-157 — 10mg')).toBeTruthy();

    // The composer's tier vocabulary, verbatim — not a second wording.
    expect(screen.getByText('24 Hour Shipping')).toBeTruthy();
    expect(screen.getByText('Standard Shipping · 7–10 business days')).toBeTruthy();

    // Quantity × THIS member's unit price, and the line total. $60 and $100
    // list at 15% → $51 and $85.
    expect(screen.getByText('2 × $51')).toBeTruthy();
    expect(screen.getByText('$102')).toBeTruthy();
    expect(screen.getByText('1 × $85')).toBeTruthy();
    expect(screen.getByText('$85')).toBeTruthy();
  });

  test('the total on an opened cart is the number the composer quotes for the same lines', async () => {
    // The composer's answer for BPC 5mg ×2 + BPC 10mg ×1.
    seam.client = makeClient({ admin_prepared_carts: EMPTY_LIST });
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build & send cart' })).toBeTruthy());
    pickLine('BPC-157', 'VSR-RS-BPC|5mg');
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add line' }));
    const [, , compound2, dose2] = selects();
    fireEvent.change(compound2, { target: { value: 'BPC-157' } });
    fireEvent.change(dose2, { target: { value: 'VSR-RS-BPC|10mg' } });

    const quotedList = amountFor('List');
    const quotedTotal = amountFor('Ada pays');
    expect(quotedTotal).toBe('$187');

    cleanup();

    // The same lines, read back off a stored cart. One `priceLines` call in
    // both places is the only reason these can agree — a second opinion here is
    // how a member gets quoted one figure and invoiced another.
    mount([cart()]);
    await openCart();
    expect(amountFor('Ada pays')).toBe(quotedTotal);
    expect(amountFor('List')).toBe(quotedList);
    expect(amountFor('Account-holder 15%')).toBe('−$33');
  });

  test('a converted cart names the order it became and links to it', async () => {
    mount([cart({
      status: 'converted',
      converted_at: '2026-08-02T12:00:00Z',
      converted_order_id: 'order-77',
      converted_order_number: 'ORDER-1042',
    })]);
    await openCart();

    const links = screen.getAllByRole('link', { name: /ORDER-1042/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/admin/orders/order-77');
    // A cart that became an order cannot be revoked or converted again.
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Convert to order' })).toBeNull();
  });

  test('an expired cart says the window has closed, not merely when it was', async () => {
    mount([cart({ status: 'expired', expires_at: '2026-01-05T12:00:00Z' })]);
    await openCart();

    expect(screen.getByText('expired')).toBeTruthy();
    expect(screen.getByText(/^Expired Jan 5, 2026, /)).toBeTruthy();
    // Converting a lapsed cart is exactly the off-site-payment case, so it stays.
    expect(screen.getByRole('button', { name: 'Convert to order' })).toBeTruthy();
  });

  test('a still-live cart says when it expires, without calling it expired', async () => {
    mount([cart({ expires_at: '2099-01-05T12:00:00Z' })]);
    await openCart();

    expect(screen.getByText(/^Expires Jan 5, 2099, /)).toBeTruthy();
    expect(screen.queryByText(/^Expired /)).toBeNull();
  });

  test('open count and last-opened render when the member has opened it', async () => {
    mount([cart({ claim_count: 3, last_claimed_at: '2026-08-01T12:00:00Z' })]);
    await openCart();

    expect(screen.getAllByText(/opened 3× · last Aug 1, 2026, /).length).toBeGreaterThan(0);
  });

  test('a never-opened cart says "never opened" — never "0×"', async () => {
    mount([cart()]);
    await openCart();

    expect(screen.getByText('never opened')).toBeTruthy();
    expect(screen.queryByText(/0×/)).toBeNull();
    expect(screen.queryByText(/opened 0/)).toBeNull();
  });

  test('when it was built is a real date and time, not "Invalid Date"', async () => {
    // created_at is a timestamptz; members/format.ts::shortDate renders one as
    // the literal string "Invalid Date". This is the field the owner asked for.
    const { container } = mount([cart()]);
    await openCart();

    expect(container.textContent).not.toMatch(/Invalid Date/);
    expect(screen.getAllByText(/Jul 30, 2026, /).length).toBeGreaterThan(0);
  });

  test('the coupon and the note to the member are both readable', async () => {
    mount([cart({ coupon_code: 'SPRING20', note: 'Repeat of the June order, minus the GHK.' })]);
    await openCart();

    expect(screen.getByText('SPRING20')).toBeTruthy();
    expect(screen.getByText('Repeat of the June order, minus the GHK.')).toBeTruthy();
  });

  test('an old cart has no copyable link, and says why instead of pretending', async () => {
    // The token is minted once and stored only as a digest — a cart from a
    // previous session genuinely has no link, and a dead "copy" affordance
    // would be worse than the sentence.
    mount([cart()]);
    await openCart();

    expect(screen.getByText(/cannot be read back/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
  });

  test('token_hash never reaches the screen, opened or closed', async () => {
    const { container } = mount([cart({ coupon_code: 'SPRING20', claim_count: 2 })]);
    await screen.findByText('live');
    expect(container.innerHTML).not.toContain(SMUGGLED_HASH);
    expect(container.innerHTML).not.toContain('token_hash');

    await openCart();
    expect(container.innerHTML).not.toContain(SMUGGLED_HASH);
    expect(container.innerHTML).not.toContain('token_hash');
  });

  test('Convert to order and Revoke are both reachable from the open row', async () => {
    mount([cart()]);
    await openCart();

    expect(screen.getByRole('button', { name: 'Convert to order' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });
});

/**
 * DID IT ACTUALLY GO OUT?
 *
 * `email_log` (075) is the only durable record that a prepared-cart email was
 * sent: the edge function claims a row keyed `pc-<cart id>` BEFORE mailing, and
 * DELETES it again when Resend rejects the send. So the ledger answers "did it
 * go out?" and cannot answer "why not?" — and the panel has to say exactly
 * that, in both directions. A false "emailed" leaves a client waiting for a mail
 * that never came, which is how this whole workstream started.
 */
describe('PreparedCartPanel — whether the email went out', () => {
  const cart = {
    id: 'cart-1',
    created_at: '2026-07-30T12:00:00Z',
    expires_at: '2026-08-13T12:00:00Z',
    claimed_at: null, last_claimed_at: null, claim_count: 0,
    revoked_at: null, converted_at: null, converted_order_id: null, converted_order_number: null,
    coupon_code: null, note: null, status: 'live',
    lines: [{ sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 }],
  };

  async function mountWithLog(emailLog: LogResult) {
    seam.client = makeClient(
      { admin_prepared_carts: () => ({ data: { rows: [cart] }, error: null }) },
      SENT,
      emailLog,
    );
    render(<PreparedCartPanel member={MEMBER} confirm={yes} />);
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
  }

  test('a logged send reports when it went and to whom', async () => {
    await mountWithLog({
      data: [{ period_key: 'pc-cart-1', sent_at: '2026-07-30T13:00:00Z', recipient: 'ada@example.com' }],
      error: null,
    });

    expect(screen.getByText(/Jul 30, 2026, .* · ada@example\.com/)).toBeTruthy();
    expect(screen.queryByText('not on record')).toBeNull();
  });

  test('the read is filtered to THIS cart, by the key the edge function writes', async () => {
    await mountWithLog(NO_LOG);

    const client = seam.client as { from: ReturnType<typeof vi.fn> };
    expect(client.from).toHaveBeenCalledWith('email_log');
    const chain = client.from.mock.results.find((r) => r.type === 'return')?.value as {
      eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn>;
    };
    expect(chain.eq).toHaveBeenCalledWith('kind', 'prepared_cart');
    expect(chain.in).toHaveBeenCalledWith('period_key', ['pc-cart-1']);
  });

  test('no logged send says "not on record" and names BOTH ways that happens', async () => {
    await mountWithLog(NO_LOG);

    expect(screen.getByText('not on record')).toBeTruthy();
    // Opted out and delivery-failed are not stored apart, so neither is claimed.
    expect(screen.getByText(/opted-out member and a failed delivery both look like/i)).toBeTruthy();
  });

  test('an unreadable ledger is "not known" — never downgraded to "not emailed"', async () => {
    await mountWithLog({ data: null, error: { code: '42P01', message: 'relation "email_log" does not exist' } });

    expect(screen.getByText('not known')).toBeTruthy();
    expect(screen.queryByText('not on record')).toBeNull();
    // The carts themselves survive a failed side read.
    expect(screen.getByText('live')).toBeTruthy();
  });
});
