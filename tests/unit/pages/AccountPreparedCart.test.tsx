// @vitest-environment happy-dom
/**
 * AccountPreparedCart — /account/prepared, the member-facing claim page.
 *
 * The supabase seam is mocked; the RPC's own behaviour (the sha256 lookup, the
 * `user_id = auth.uid()` binding, the uniform failure shape) is proven against
 * real Postgres in tests/integration/preparedCarts.test.ts. What this file pins
 * is everything the PAGE is responsible for:
 *
 *   • THE DOSE. Every line goes in through `variantProduct(product, dose)`. A
 *     bare `add()` drops the dose, the per-(sku,dose) price lookup misses, and
 *     the order line is written at $0 — that shipped once
 *     (src/lib/cartActions.ts:1-24). The assertions below check the dose is
 *     present in the cart line's id, its name AND its price, because the id
 *     alone would pass while the money was still wrong.
 *   • THE TOKEN IS NOT IN THE URL after mount, and it is captured even while
 *     the visitor is still signed out — which is the whole reason the capture
 *     sits above AccountLayout.
 *   • EVERY FAILURE IS A SENTENCE. No blank screen, no silent redirect, and the
 *     wrong-account case says which account you are signed in as.
 *   • THE EXISTING CART IS NOT WIPED, and a merge is stated rather than left to
 *     be discovered at the total.
 *   • A COUPON THAT DOES NOT APPLY IS SAID SO. Losing it silently means the
 *     member pays more than they were quoted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

// A tiny deterministic catalog, so the assertions are about the page rather
// than about live inventory. RETA is deliberately multi-variant so a dose-less
// line for it is a REAL "must be skipped" case, not a single-config passthrough.
vi.mock('../../../src/data/products.json', () => ({
  default: [
    { sku: 'VSR-RS-BPC', id: 'VSR-RS-BPC', name: 'BPC-157', priceCents: null, variants: [{ dose: '5mg' }, { dose: '10mg' }] },
    { sku: 'VSR-RS-RETA', id: 'VSR-RS-RETA', name: 'Retatrutide', priceCents: null, variants: [{ dose: '15mg' }] },
    { sku: 'VSR-LE-MIX', id: 'VSR-LE-MIX', name: 'Vortex Mixer', priceCents: 4_500, variants: [] },
  ],
}));
vi.mock('../../../src/data/biopeptideCompounds.generated.json', () => ({ default: [] }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const coupons = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('../../../src/lib/coupons', () => ({
  checkCoupon: (...args: unknown[]) => coupons.check(...args),
}));

// AccountLayout stands in for the real shell with the SAME two-state behaviour:
// signed out it renders the AuthCard in place of the children (so the content
// never mounts), signed in it publishes the session through the REAL provider —
// which is also what proves the leaf reads `useAccountSession()` rather than
// calling `useCustomerAuth()` itself, since the real provider is the only thing
// that can satisfy it.
const shell = vi.hoisted(() => ({ signedIn: true, email: 'ada@example.com' }));
vi.mock('../../../src/pages/account/AccountLayout', async () => {
  const { AccountSessionProvider } = await import('../../../src/lib/accountSession');
  return {
    AccountLayout: ({ children }: { children: ReactNode }) =>
      shell.signedIn
        ? AccountSessionProvider({
            value: { user: { email: shell.email } } as never,
            children,
          })
        : <div>AuthCardMarker</div>,
  };
});

import { AccountPreparedCart } from '../../../src/pages/account/AccountPreparedCart';
import { useCart } from '../../../src/hooks/useCart';
import { useProductOverrides, type VariantOverride } from '../../../src/lib/productOverrides';
import { CLAIM_TOKEN_STORAGE_KEY } from '../../../src/lib/preparedCartClaim';

const OVERRIDES: Record<string, Record<string, VariantOverride>> = {
  'VSR-RS-BPC': {
    '5mg': { sku: 'VSR-RS-BPC', dose: '5mg', on_hand: 5, inbound_units: 0, price_cents: 6_000, lead_days: null, hidden: false },
    '10mg': { sku: 'VSR-RS-BPC', dose: '10mg', on_hand: 0, inbound_units: 0, price_cents: 10_000, lead_days: 9, hidden: false },
  },
  'VSR-RS-RETA': {
    '15mg': { sku: 'VSR-RS-RETA', dose: '15mg', on_hand: 2, inbound_units: 0, price_cents: 25_000, lead_days: null, hidden: false },
  },
};

const TOKEN = 'f0e1d2c3b4a5'.repeat(5) + 'abcd';

type RpcResult = { data: unknown; error: unknown };
function makeClient(claim: (args: unknown) => RpcResult | Promise<RpcResult>) {
  return { rpc: vi.fn(async (_fn: string, args: unknown) => claim(args)) };
}

/** A successful claim body, in the RPC's own snake_case shape. */
function claimOk(over: Record<string, unknown> = {}): RpcResult {
  return {
    data: {
      ok: true,
      cart_id: 'cart-1',
      coupon_code: null,
      note: null,
      expires_at: '2026-08-13T00:00:00Z',
      first_claim: true,
      lines: [{ sku: 'VSR-RS-BPC', dose: '10mg', quantity: 2 }],
      ...over,
    },
    error: null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountPreparedCart />
    </MemoryRouter>,
  );
}

/** Put a token in the fragment the way the emailed link does. */
function arriveWithToken(token = TOKEN) {
  window.history.replaceState(null, '', `/account/prepared#t=${token}`);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useProductOverrides.setState({ variantBySku: OVERRIDES, loaded: true, loading: false });
  useCart.setState({ items: [], coupons: [] });
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/account/prepared');
  shell.signedIn = true;
  shell.email = 'ada@example.com';
  navigate.mockClear();
  coupons.check.mockReset();
  seam.client = makeClient(() => claimOk());
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  useProductOverrides.setState({ bySku: {}, variantBySku: {}, loaded: false, loading: false, error: null });
});

/* ── The $0-line regression ────────────────────────────────────────────────── */

describe('AccountPreparedCart — the claimed lines are properly DOSED', () => {
  test('a claimed line lands in the cart with its dose in the id, the name AND the price', async () => {
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));

    const [item] = useCart.getState().items;
    // variantProduct's three effects, all of which the $0 incident needed:
    expect(item.product.id).toBe('VSR-RS-BPC::10mg');           // distinct cart line per dose
    expect(item.product.name).toBe('BPC-157 — 10mg');           // deriveProductDose can resolve it
    expect(item.product.priceCents).toBe(10_000);               // NOT 0, NOT null
    expect(item.quantity).toBe(2);
  });

  test('two doses of the same compound stay two separate, separately-priced lines', async () => {
    seam.client = makeClient(() =>
      claimOk({
        lines: [
          { sku: 'VSR-RS-BPC', dose: '5mg', quantity: 1 },
          { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 3 },
        ],
      }),
    );
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(2));
    expect(useCart.getState().items.map((i) => [i.product.id, i.product.priceCents, i.quantity])).toEqual([
      ['VSR-RS-BPC::5mg', 6_000, 1],
      ['VSR-RS-BPC::10mg', 10_000, 3],
    ]);
  });

  test('a single-config product is added unchanged — no dose is invented for it', async () => {
    seam.client = makeClient(() => claimOk({ lines: [{ sku: 'VSR-LE-MIX', dose: '', quantity: 1 }] }));
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(useCart.getState().items[0].product.id).toBe('VSR-LE-MIX');
    expect(useCart.getState().items[0].product.name).toBe('Vortex Mixer');
  });

  test('a dose-less line for a MULTI-VARIANT product is skipped, never added bare', async () => {
    // This is the exact shape of the production incident: without a dose the
    // price lookup misses and the order line is written at $0. planPreparedCart
    // refuses to guess, and the member is TOLD which line was left out.
    seam.client = makeClient(() =>
      claimOk({
        lines: [
          { sku: 'VSR-RS-RETA', dose: '', quantity: 1 },
          { sku: 'VSR-RS-BPC', dose: '10mg', quantity: 1 },
        ],
      }),
    );
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(useCart.getState().items[0].product.id).toBe('VSR-RS-BPC::10mg');
    expect(useCart.getState().items.some((i) => i.product.sku === 'VSR-RS-RETA')).toBe(false);

    expect(await screen.findByText(/VSR-RS-RETA/)).toBeTruthy();
    expect(screen.getByText(/no longer available/i)).toBeTruthy();
    // A line the member needs told about is NOT a silent hand-off to /cart.
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a sku that has left the catalog is skipped and named', async () => {
    seam.client = makeClient(() => claimOk({ lines: [{ sku: 'VSR-GONE', dose: '5mg', quantity: 1 }] }));
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/None of the items in this cart are available any more/i)).toBeTruthy();
    expect(useCart.getState().items).toHaveLength(0);
  });
});

/* ── The token ─────────────────────────────────────────────────────────────── */

describe('AccountPreparedCart — the token never lingers in the URL', () => {
  test('the fragment is gone after mount, and the token is not anywhere in the URL', async () => {
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.href).not.toContain('#t=');
  });

  test('the token IS what gets sent to the RPC — scrubbing the URL does not lose it', async () => {
    arriveWithToken();
    renderPage();

    const client = seam.client as { rpc: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(client.rpc).toHaveBeenCalled());
    expect(client.rpc).toHaveBeenCalledWith('claim_prepared_cart', { p_token: TOKEN });
  });

  test('it is captured while SIGNED OUT and still spent after signing in', async () => {
    // The capture lives above AccountLayout precisely for this: the content
    // never mounts behind the AuthCard, so an inside capture would miss the one
    // visitor it exists for.
    shell.signedIn = false;
    arriveWithToken();
    const view = renderPage();

    expect(screen.getByText('AuthCardMarker')).toBeTruthy();
    expect(window.location.hash).toBe('');          // already scrubbed
    expect(window.sessionStorage.getItem(CLAIM_TOKEN_STORAGE_KEY)).toBe(TOKEN);

    // Sign in: the shell publishes a session and the claim UI mounts, with no
    // fragment left to read.
    view.unmount();
    shell.signedIn = true;
    renderPage();

    const client = seam.client as { rpc: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(client.rpc).toHaveBeenCalledWith('claim_prepared_cart', { p_token: TOKEN }));
  });

  test('a spent token is cleared from storage so it cannot surprise a later visit', async () => {
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(window.sessionStorage.getItem(CLAIM_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('a REFUSED token is cleared too', async () => {
    seam.client = makeClient(() => ({ data: { ok: false, reason: 'expired' }, error: null }));
    arriveWithToken();
    renderPage();

    await screen.findByText(/This link has expired/i);
    expect(window.sessionStorage.getItem(CLAIM_TOKEN_STORAGE_KEY)).toBeNull();
  });

  test('arriving with no token at all says so instead of showing a blank page', async () => {
    renderPage();
    expect(await screen.findByText(/No cart link here/i)).toBeTruthy();
    expect(screen.getByText(/full link from your email/i)).toBeTruthy();
  });
});

/* ── Every failure state ───────────────────────────────────────────────────── */

describe('AccountPreparedCart — failure states are stated, never blank', () => {
  test('a valid token opened by the WRONG account names the account you are signed in as', async () => {
    // The RPC answers `not_found` for a wrong-user token AND for a nonexistent
    // one — it cannot tell them apart, by design. The copy leads with the
    // likeliest reading without asserting the link is real.
    shell.email = 'other@example.com';
    seam.client = makeClient(() => ({ data: { ok: false, reason: 'not_found' }, error: null }));
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/This cart isn’t on this account/i)).toBeTruthy();
    expect(screen.getByText(/other@example\.com/)).toBeTruthy();
    expect(screen.getByText(/sign out and sign back in/i)).toBeTruthy();
    expect(useCart.getState().items).toHaveLength(0);
  });

  test.each([
    ['expired', /This link has expired/i],
    ['revoked', /This link was withdrawn/i],
    ['not_signed_in', /Sign in to open this cart/i],
  ])('%s renders its own headline and adds nothing to the cart', async (reason, headline) => {
    seam.client = makeClient(() => ({ data: { ok: false, reason }, error: null }));
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(headline)).toBeTruthy();
    expect(useCart.getState().items).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  test('an RPC error is a stated failure, and the raw object reaches the console', async () => {
    const raw = { code: 'PGRST202', message: 'function not found' };
    seam.client = makeClient(() => ({ data: null, error: raw }));
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/We couldn’t open this cart/i)).toBeTruthy();
    expect(consoleError.mock.calls.some(([, arg]) => arg === raw)).toBe(true);
  });

  test('a thrown / timed-out RPC is answered rather than left spinning', async () => {
    seam.client = { rpc: vi.fn(async () => { throw new Error('boom'); }) };
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/We couldn’t open this cart/i)).toBeTruthy();
    expect(screen.queryByText(/Opening the cart we prepared for you/i)).toBeNull();
  });

  test('an unrecognisable response body is a failure, not a cheerful empty success', async () => {
    seam.client = makeClient(() => ({ data: 'surprise', error: null }));
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/We couldn’t open this cart/i)).toBeTruthy();
  });

  test('no backend configured is stated too', async () => {
    seam.client = null;
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/We couldn’t open this cart/i)).toBeTruthy();
  });
});

/* ── The member's own cart is theirs ───────────────────────────────────────── */

describe('AccountPreparedCart — merging, never wiping', () => {
  test('items already in the cart survive the claim', async () => {
    useCart.setState({
      items: [{ product: { id: 'OTHER::1mg', sku: 'VSR-OTHER', name: 'Other — 1mg', priceCents: 1_000 } as never, quantity: 1 }],
      coupons: [],
    });
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(2));
    expect(useCart.getState().items.some((i) => i.product.id === 'OTHER::1mg')).toBe(true);
  });

  test('a merge is SAID OUT LOUD, and the page does not hand off silently', async () => {
    useCart.setState({
      items: [{ product: { id: 'OTHER::1mg', sku: 'VSR-OTHER', name: 'Other — 1mg', priceCents: 1_000 } as never, quantity: 1 }],
      coupons: [],
    });
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/cart you already had/i)).toBeTruthy();
    // Auto-navigating here would hide the one sentence explaining why the total
    // no longer matches the quote.
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a clean claim into an EMPTY cart hands off to /cart', async () => {
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/cart'));
  });
});

/* ── Opening the link more than once ───────────────────────────────────────── */

/**
 * The cart is zustand-persisted into localStorage, so it is PER-DEVICE. Opening
 * the email on a phone and buying on a laptop is the normal way people shop, so
 * the link has to survive being opened again — and the apply has to converge
 * rather than compound. These tests are the proof of that convergence.
 */
describe('AccountPreparedCart — re-opening the same link', () => {
  /** Open the link once more, as if on another device / another visit. */
  async function openAgain(expectQty: number) {
    cleanup();
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items[0]?.quantity).toBe(expectQty));
  }

  test('a SECOND device with an empty cart gets the same cart, and is not refused', async () => {
    // The exact failure a single-use link would produce: mail opened on the
    // phone, purchase made on the laptop, laptop cart empty.
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));

    // A different device: same link, fresh (empty) cart state.
    cleanup();
    useCart.setState({ items: [], coupons: [] });
    seam.client = makeClient(() => claimOk({ first_claim: false }));
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(useCart.getState().items[0].product.id).toBe('VSR-RS-BPC::10mg');
    expect(useCart.getState().items[0].quantity).toBe(2);
    expect(screen.queryByText(/already opened this cart/i)).toBeNull();
  });

  test('re-opening on the SAME device converges — the quantity is set, never doubled', async () => {
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items[0]?.quantity).toBe(2));

    seam.client = makeClient(() => claimOk({ first_claim: false }));
    await openAgain(2);            // still 2, not 4
    expect(useCart.getState().items).toHaveLength(1);
  });

  test('a THIRD open still converges on the same cart', async () => {
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items[0]?.quantity).toBe(2));

    seam.client = makeClient(() => claimOk({ first_claim: false }));
    await openAgain(2);
    await openAgain(2);
    expect(useCart.getState().items).toHaveLength(1);
    expect(useCart.getState().items[0].quantity).toBe(2);
  });

  test('a converged re-open says nothing changed, and does NOT claim a merge', async () => {
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items[0]?.quantity).toBe(2));

    seam.client = makeClient(() => claimOk({ first_claim: false }));
    cleanup();
    arriveWithToken();
    renderPage();

    expect(await screen.findByText(/already in your cart/i)).toBeTruthy();
    // Those items ARE this cart — reporting a merge would be noise.
    expect(screen.queryByText(/cart you already had/i)).toBeNull();
  });

  test('a quantity the member changed themselves is SET back to the prepared amount, and said so', async () => {
    useCart.setState({
      items: [{ product: { id: 'VSR-RS-BPC::10mg', sku: 'VSR-RS-BPC', name: 'BPC-157 — 10mg', priceCents: 10_000 } as never, quantity: 7 }],
      coupons: [],
    });
    arriveWithToken();
    renderPage();

    // 2 (the prepared amount), not 9 (add) — that is what makes re-opens safe.
    await waitFor(() => expect(useCart.getState().items[0].quantity).toBe(2));
    expect(await screen.findByText(/set to the prepared amount/i)).toBeTruthy();
    // Overwriting their own number is something they must be able to see.
    expect(navigate).not.toHaveBeenCalled();
  });

  test('unrelated items survive every re-open', async () => {
    useCart.setState({
      items: [{ product: { id: 'OTHER::1mg', sku: 'VSR-OTHER', name: 'Other — 1mg', priceCents: 1_000 } as never, quantity: 1 }],
      coupons: [],
    });
    arriveWithToken();
    renderPage();
    await waitFor(() => expect(useCart.getState().items).toHaveLength(2));

    seam.client = makeClient(() => claimOk({ first_claim: false }));
    cleanup();
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(2));
    expect(useCart.getState().items.find((i) => i.product.id === 'OTHER::1mg')?.quantity).toBe(1);
    expect(useCart.getState().items.find((i) => i.product.id === 'VSR-RS-BPC::10mg')?.quantity).toBe(2);
  });
});

/* ── The promised code ─────────────────────────────────────────────────────── */

describe('AccountPreparedCart — the coupon the cart was quoted with', () => {
  test('a valid code is applied, and only the CODE was sent for checking', async () => {
    coupons.check.mockResolvedValue({
      ok: true,
      coupon: { code: 'SPRING20', kind: 'percent', percent: 20, amountCents: null, freeSku: null, freeDose: null, freeLabel: null, minSubtotalCents: 0, requiresAccount: false },
    });
    seam.client = makeClient(() => claimOk({ coupon_code: 'SPRING20' }));
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().coupons.map((c) => c.code)).toEqual(['SPRING20']));
    expect(coupons.check).toHaveBeenCalledWith('SPRING20', 20_000, expect.objectContaining({ hasAccount: true }));
  });

  test('an INVALID code surfaces a message instead of silently dropping', async () => {
    // Silence costs the member money: they would check out at the undiscounted
    // price for a cart that was quoted with the code applied.
    coupons.check.mockResolvedValue({ ok: false, reason: 'This code has expired.' });
    seam.client = makeClient(() => claimOk({ coupon_code: 'SPRING20' }));
    arriveWithToken();
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/SPRING20/);
    expect(alert.textContent).toMatch(/This code has expired\./);
    expect(alert.textContent).toMatch(/don’t check out at this price/i);
    expect(useCart.getState().coupons).toHaveLength(0);
  });

  test('an invalid code keeps the member on the page — the lines still went in', async () => {
    coupons.check.mockResolvedValue({ ok: false, reason: 'This code has expired.' });
    seam.client = makeClient(() => claimOk({ coupon_code: 'SPRING20' }));
    arriveWithToken();
    renderPage();

    await screen.findByRole('alert');
    expect(useCart.getState().items).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a code checker that THROWS does not throw away the cart it already filled', async () => {
    coupons.check.mockRejectedValue(new Error('network down'));
    seam.client = makeClient(() => claimOk({ coupon_code: 'SPRING20' }));
    arriveWithToken();
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t reach the code checker/i);
    // The lines are the valuable part and they survived.
    expect(useCart.getState().items).toHaveLength(1);
  });

  test('no coupon on the cart means no code check at all', async () => {
    arriveWithToken();
    renderPage();

    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    expect(coupons.check).not.toHaveBeenCalled();
  });
});

/* ── The note ──────────────────────────────────────────────────────────────── */

describe('AccountPreparedCart — while it works', () => {
  test('a pending claim shows progress, never an empty page', async () => {
    let release: (v: RpcResult) => void = () => {};
    seam.client = { rpc: vi.fn(() => new Promise<RpcResult>((res) => { release = res; })) };
    arriveWithToken();
    renderPage();

    expect(screen.getByText(/Opening the cart we prepared for you/i)).toBeTruthy();
    release(claimOk());
    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
  });

  test('the claim fires exactly once, even though the effect can re-run', async () => {
    arriveWithToken();
    renderPage();

    const client = seam.client as { rpc: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(useCart.getState().items).toHaveLength(1));
    // A second claim would stamp claimed_at twice and double the cart.
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
