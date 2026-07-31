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
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const OVERRIDES: Record<string, Record<string, VariantOverride>> = {
  'VSR-RS-BPC': {
    '5mg': { sku: 'VSR-RS-BPC', dose: '5mg', on_hand: 5, inbound_units: 0, price_cents: 6_000, lead_days: null, hidden: false },
    '10mg': { sku: 'VSR-RS-BPC', dose: '10mg', on_hand: 5, inbound_units: 0, price_cents: 10_000, lead_days: null, hidden: false },
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

type RpcHandler = (args: unknown) => { data: unknown; error: unknown };

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

beforeEach(() => {
  useProductOverrides.setState({ variantBySku: OVERRIDES, loaded: true, loading: false });
  seam.client = makeClient({ admin_prepared_carts: EMPTY_LIST });
  yes.mockClear();
  no.mockClear();
});

afterEach(() => {
  cleanup();
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
