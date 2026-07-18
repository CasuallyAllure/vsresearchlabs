/**
 * Unit tests for src/lib/placeOrder.ts — the hardened client wrapper around
 * the `place-order` Edge Function.
 *
 * This is the checkout network client, so the pins here are contractual:
 *   • the caller's payload travels to the server UNMODIFIED (prices/coupons
 *     are server-authoritative — the only addition allowed is the
 *     idempotency_key), and the caller's object is never mutated;
 *   • every failure mode (function error, HTTP error, network throw, timeout)
 *     settles to { ok:false } with a user-facing message — never a hang or a
 *     silent swallow;
 *   • the idempotency key is stable for an unchanged cart (retry replays the
 *     same order), rotates when the cart changes, and clears on success.
 *
 * The supabase seam is mocked (tests/setup.ts forbids live network).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ supabase: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return seam.supabase;
  },
}));

import { placeOrder, type PlaceOrderResponse } from '../../src/lib/placeOrder';

const IDEM_STORAGE_KEY = 'checkout.idempotency.v1';

const invoke = vi.fn();

/** A representative checkout payload (shape mirrors the cart submit handlers). */
const makePayload = (): Record<string, unknown> => ({
  contact: 'buyer@example.com',
  items: [{ product: { id: 'reta-10' }, quantity: 2, note: 'cold pack' }],
  couponCodes: ['FREEBH2O'],
});

/** The cart signature placeOrder derives from a payload's items. */
const signatureOf = (payload: Record<string, unknown>): string => {
  const items = payload.items as Array<{ product?: { id?: unknown }; quantity?: unknown; note?: unknown }>;
  return JSON.stringify(items.map((r) => [r.product?.id ?? null, r.quantity ?? null, r.note ?? null]));
};

interface StorageStub {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
}

const makeStorage = (initial: Record<string, string> = {}): StorageStub => {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
  };
};

const successResponse: PlaceOrderResponse = {
  success: true,
  orderNumber: 'VSR-ORD-260717-001',
  referenceId: 'ref-1',
  createdAt: '2026-07-17T00:00:00Z',
  amountCents: 12_345,
  invoiceEmailSent: true,
  contactIsEmail: true,
};

beforeEach(() => {
  invoke.mockReset();
  seam.supabase = { functions: { invoke } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('placeOrder — configuration guard', () => {
  test('returns a friendly not-configured failure when the supabase seam is null', async () => {
    // Arrange
    seam.supabase = null;

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert — settled failure, no network attempt.
    expect(outcome).toEqual({
      ok: false,
      message: 'Ordering service is not configured. Please try again later.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('placeOrder — success path', () => {
  test('passes the payload through unmodified (plus idempotency_key) and returns the server data', async () => {
    // Arrange
    invoke.mockResolvedValue({ data: successResponse, error: null });
    const payload = makePayload();
    const before = structuredClone(payload);

    // Act
    const outcome = await placeOrder(payload);

    // Assert — server-authoritative fields come back verbatim.
    expect(outcome).toEqual({ ok: true, data: successResponse });

    // Assert — the body is the caller's payload byte-for-byte, with only the
    // idempotency key added; prices/coupons are never rewritten client-side.
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fnName, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe('place-order');
    expect(options.body).toEqual({ ...before, idempotency_key: expect.any(String) });

    // Assert — the caller's payload object was not mutated.
    expect(payload).toEqual(before);
  });

  test('sends the payload as-is (no idempotency key) when crypto.randomUUID is unavailable', async () => {
    // Arrange
    vi.stubGlobal('crypto', {});
    invoke.mockResolvedValue({ data: successResponse, error: null });
    const payload = makePayload();

    // Act
    const outcome = await placeOrder(payload);

    // Assert — the exact same object reference goes to the server.
    expect(outcome.ok).toBe(true);
    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toBe(payload);
    expect('idempotency_key' in options.body).toBe(false);
  });

  test('clears the stored idempotency key on success', async () => {
    // Arrange
    const payload = makePayload();
    const storage = makeStorage({
      [IDEM_STORAGE_KEY]: JSON.stringify({ key: 'stored-key-123', sig: signatureOf(payload) }),
    });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    await placeOrder(payload);

    // Assert
    expect(storage.removeItem).toHaveBeenCalledWith(IDEM_STORAGE_KEY);
  });

  test('still succeeds when clearing the stored key throws (private mode)', async () => {
    // Arrange
    const storage = makeStorage();
    storage.removeItem.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert — the storage failure never surfaces to the buyer.
    expect(outcome).toEqual({ ok: true, data: successResponse });
  });
});

describe('placeOrder — idempotency key lifecycle', () => {
  test('reuses the stored key when the cart signature matches (retry replays the same order)', async () => {
    // Arrange
    const payload = makePayload();
    const storage = makeStorage({
      [IDEM_STORAGE_KEY]: JSON.stringify({ key: 'stored-key-123', sig: signatureOf(payload) }),
    });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    await placeOrder(payload);

    // Assert
    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.idempotency_key).toBe('stored-key-123');
  });

  test('rotates to a fresh key when the cart contents changed since the stored key', async () => {
    // Arrange — stored signature belongs to a DIFFERENT cart.
    const storage = makeStorage({
      [IDEM_STORAGE_KEY]: JSON.stringify({ key: 'stored-key-123', sig: '[["other",1,null]]' }),
    });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });
    const payload = makePayload();

    // Act
    await placeOrder(payload);

    // Assert — a new key was minted and persisted with the new signature.
    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.idempotency_key).toEqual(expect.any(String));
    expect(options.body.idempotency_key).not.toBe('stored-key-123');
    expect(storage.setItem).toHaveBeenCalledWith(
      IDEM_STORAGE_KEY,
      JSON.stringify({ key: options.body.idempotency_key, sig: signatureOf(payload) }),
    );
  });

  test('falls back to a fresh key when the stored record is corrupted JSON', async () => {
    // Arrange
    const storage = makeStorage({ [IDEM_STORAGE_KEY]: '{not json' });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome.ok).toBe(true);
    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.idempotency_key).toEqual(expect.any(String));
  });

  test('still sends a key when persisting it throws (private mode)', async () => {
    // Arrange
    const storage = makeStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.stubGlobal('sessionStorage', storage);
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert — the in-flight attempt is still protected by the key.
    expect(outcome.ok).toBe(true);
    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.idempotency_key).toEqual(expect.any(String));
  });

  test('treats a non-array items field as an empty cart signature (no crash)', async () => {
    // Arrange
    invoke.mockResolvedValue({ data: successResponse, error: null });

    // Act
    const outcome = await placeOrder({ contact: 'x', items: 'not-an-array' });

    // Assert
    expect(outcome.ok).toBe(true);
  });
});

describe('placeOrder — error paths surface, never swallow', () => {
  test("surfaces the server's own error message from the function body", async () => {
    // Arrange
    invoke.mockResolvedValue({
      data: { success: false, error: 'Price mismatch — refresh and try again.' },
      error: null,
    });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({ ok: false, message: 'Price mismatch — refresh and try again.' });
  });

  test('falls back to the invoke error message when the body carries no error string', async () => {
    // Arrange
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
    });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({ ok: false, message: 'Edge Function returned a non-2xx status code' });
  });

  test("prefers the body's error string over the transport error message", async () => {
    // Arrange — both present: the server's message is the more specific one.
    invoke.mockResolvedValue({
      data: { success: false, error: 'Coupon expired.' },
      error: { message: 'Edge Function returned a non-2xx status code' },
    });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({ ok: false, message: 'Coupon expired.' });
  });

  test('uses the generic failure message when neither body nor error carry details', async () => {
    // Arrange — error object without a message property.
    invoke.mockResolvedValue({ data: { success: false }, error: { status: 500 } });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({ ok: false, message: 'Failed to place order. Please try again.' });
  });

  test('uses the generic failure message when the function returns an empty success=false body', async () => {
    // Arrange
    invoke.mockResolvedValue({ data: { success: false }, error: null });

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({ ok: false, message: 'Failed to place order. Please try again.' });
  });

  test('a thrown network/CORS error settles to a friendly connection failure', async () => {
    // Arrange
    invoke.mockRejectedValue(new TypeError('Failed to fetch'));

    // Act
    const outcome = await placeOrder(makePayload());

    // Assert
    expect(outcome).toEqual({
      ok: false,
      message: "We couldn't reach the ordering service. Check your connection and try again.",
    });
  });

  test('a hung invocation times out after 30s and hands the buyer control back', async () => {
    // Arrange — the function never resolves.
    vi.useFakeTimers();
    invoke.mockReturnValue(new Promise(() => undefined));
    const pending = placeOrder(makePayload());

    // Act
    await vi.advanceTimersByTimeAsync(30_000);
    const outcome = await pending;

    // Assert — the timeout copy tells the buyer to check email before retrying.
    expect(outcome).toEqual({
      ok: false,
      message:
        'The order is taking longer than expected. Check your email for an invoice before retrying — and if nothing arrives, try again.',
    });
  });
});
