/**
 * Orchestration tests — place-order persistence + endgame (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/placeOrderHarness)
 * and pins the persistence failure branches (inquiry insert, order insert, the
 * 23505 idempotency insert race, order_lines), the buyer-invoice endgame
 * (re-read, Resend failure, thrown fetch), the business notification, and the
 * success telemetry + response contract.
 */
import { describe, expect, test } from 'vitest';
import {
  BPC_PRICE_CENTS,
  basePayload,
  makeHarness,
  placeOrder,
  queryHas,
  withCatalog,
  type Harness,
} from '../helpers/placeOrderHarness';
import { GUEST_SHIPPING_CENTS } from '../../supabase/functions/place-order/orderShipping';

const TOTAL_CENTS = BPC_PRICE_CENTS + GUEST_SHIPPING_CENTS;
const KEY = '123e4567-e89b-42d3-a456-426614174000';

const ORDER_INSERT_FAIL_MSG =
  'Order could not be created. Our team has your request and will follow up.';

/** Recorded orders selects that filter on the idempotency key. */
function idempotencyLookups(h: Harness) {
  return h.db.of('orders', 'select').filter((q) => queryHas(q, 'eq', 'idempotency_key'));
}

/** Script the 23505 insert race: the FIRST idempotency lookup (pre-insert)
 *  finds nothing, the SECOND (after the failed insert) finds the raced row. */
const RACED_ROW = {
  order_number: 'VSR-ORD-260718-RACED',
  created_at: '2026-07-18T00:00:05.000Z',
  invoice_amount_cents: 12345,
};

function scriptInsertRace(h: Harness): { lookupCount: () => number } {
  let lookups = 0;
  h.db.on('orders', 'insert', { error: { code: '23505', message: 'duplicate key' } });
  h.db.on(
    'orders',
    'select',
    () => {
      lookups += 1;
      return lookups === 1 ? { data: null } : { data: RACED_ROW };
    },
    (q) => queryHas(q, 'eq', 'idempotency_key', KEY),
  );
  return { lookupCount: () => lookups };
}

describe('inquiry insert failure', () => {
  test('502 with the exact message, inquiry_insert alert, and NOTHING downstream runs', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('inquiries', 'insert', { data: null, error: { message: 'insert failed' } });

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(502);
    expect(body.error).toBe('Failed to record order. Please try again.');

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('inquiry_insert');
    expect(h.alerts[0].ctx).toMatchObject({ contact: 'buyer@test.example', itemCount: 1 });
    expect(typeof h.alerts[0].ctx?.referenceId).toBe('string');

    // No order was attempted, no lines, no emails.
    expect(h.db.of('orders', 'insert')).toHaveLength(0);
    expect(h.db.of('order_lines', 'insert')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });
});

describe('order insert failure', () => {
  test('non-23505 error → 502 carrying the referenceId, order_insert alert, no emails', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('orders', 'insert', { data: null, error: { message: 'connection reset' } });

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(502);
    expect(body.error).toBe(ORDER_INSERT_FAIL_MSG);

    // The inquiry IS recorded and its reference travels back for follow-up.
    const inquiry = h.db.of('inquiries', 'insert')[0].payload as { reference_id: string };
    expect(body.referenceId).toBe(inquiry.reference_id);

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('order_insert');
    expect(h.alerts[0].ctx).toMatchObject({ amountCents: TOTAL_CENTS });

    expect(h.db.of('order_lines', 'insert')).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('23505 with an idempotency key re-reads the raced order and returns it as the duplicate', async () => {
    const h = withCatalog(makeHarness());
    const race = scriptInsertRace(h);

    const { status, body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      duplicate: true,
      orderNumber: RACED_ROW.order_number,
      createdAt: RACED_ROW.created_at,
      amountCents: RACED_ROW.invoice_amount_cents,
      invoiceEmailSent: true,
      contactIsEmail: true,
    });

    // Pre-insert lookup missed, post-insert re-read hit — exactly two.
    expect(race.lookupCount()).toBe(2);
    // The winner already emailed the buyer; the loser must stay silent.
    expect(h.emails).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  test('the losing racer deletes ITS OWN inquiry row (orphan cleanup on the adopt path)', async () => {
    const h = withCatalog(makeHarness());
    scriptInsertRace(h);

    const { body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    // This attempt inserted a fresh inquiry before the insert collided; the
    // duplicate response's referenceId still names THAT attempt's reference,
    // but the row itself — never attached to an order — is deleted, by its
    // exact id, so no orphan REVIEWING inquiry survives the lost race.
    const inquiries = h.db.of('inquiries', 'insert');
    expect(inquiries).toHaveLength(1);
    const inquiry = inquiries[0].payload as { reference_id: string };
    expect(body.referenceId).toBe(inquiry.reference_id);

    const deletes = h.db.of('inquiries', 'delete');
    expect(deletes).toHaveLength(1);
    expect(queryHas(deletes[0], 'eq', 'id', 'inq-1')).toBe(true);
  });

  test('a failed orphan-inquiry delete is NON-FATAL: duplicate response intact, race_inquiry_cleanup alert', async () => {
    const h = withCatalog(makeHarness());
    scriptInsertRace(h);
    h.db.on('inquiries', 'delete', { error: { message: 'delete refused' } });

    const { status, body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      duplicate: true,
      orderNumber: RACED_ROW.order_number,
      amountCents: RACED_ROW.invoice_amount_cents,
    });

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('race_inquiry_cleanup');
    expect(h.alerts[0].ctx).toMatchObject({
      inquiryId: 'inq-1',
      orderNumber: RACED_ROW.order_number,
      contact: 'buyer@test.example',
    });
    expect(h.emails).toHaveLength(0);
  });

  test('a raced row with a null invoice amount reports amountCents 0', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('orders', 'insert', { error: { code: '23505', message: 'duplicate key' } });
    let lookups = 0;
    h.db.on(
      'orders',
      'select',
      () => {
        lookups += 1;
        return lookups === 1
          ? { data: null }
          : { data: { ...RACED_ROW, invoice_amount_cents: null } };
      },
      (q) => queryHas(q, 'eq', 'idempotency_key', KEY),
    );

    const { status, body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(body.amountCents).toBe(0);
  });

  test('23505 whose re-read finds nothing falls through to the 502', async () => {
    const h = withCatalog(makeHarness());
    // Insert collides but the raced row never materializes (both lookups are
    // the inert data:null default).
    h.db.on('orders', 'insert', { error: { code: '23505', message: 'duplicate key' } });

    const { status, body } = await placeOrder(h, basePayload({ idempotency_key: KEY }));
    expect(status).toBe(502);
    expect(body.error).toBe(ORDER_INSERT_FAIL_MSG);
    expect(idempotencyLookups(h)).toHaveLength(2); // pre-insert + failed re-read
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('order_insert');
    expect(h.emails).toHaveLength(0);
  });

  test('23505 WITHOUT an idempotency key is a plain 502 — no race re-read at all', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('orders', 'insert', { error: { code: '23505', message: 'duplicate key' } });

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(502);
    expect(body.error).toBe(ORDER_INSERT_FAIL_MSG);
    expect(idempotencyLookups(h)).toHaveLength(0);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('order_insert');
  });
});

describe('order_lines insert failure', () => {
  test('the order still succeeds but the order_lines_insert alert fires', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('order_lines', 'insert', { error: { message: 'lines failed' } });

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceEmailSent).toBe(true);

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('order_lines_insert');
    expect(h.alerts[0].ctx).toMatchObject({ orderId: 'order-1', amountCents: TOTAL_CENTS });

    // Both emails still went out.
    expect(h.emails).toHaveLength(2);
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[1].to).toBe('biz@test.example');
  });
});

describe('buyer invoice endgame', () => {
  test('invoice re-read returning null → no buyer email, buyer_invoice_reread alert, business still notified', async () => {
    const h = withCatalog(makeHarness());
    h.db.on('orders', 'select', { data: null }, (q) => queryHas(q, 'eq', 'id'));

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceEmailSent).toBe(false);

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('buyer_invoice_reread');
    expect(h.alerts[0].ctx).toMatchObject({ orderId: 'order-1' });

    // Only the business notification was sent.
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe('biz@test.example');
  });

  test('buyer Resend send failing (non-ok status) → invoiceEmailSent false, order still 200', async () => {
    const h = withCatalog(makeHarness());
    h.emailResponder = (email) =>
      email.to === 'buyer@test.example' ? { status: 500, body: { error: 'boom' } } : { status: 200 };

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceEmailSent).toBe(false);

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('buyer_invoice_email');
    expect(h.alerts[0].ctx).toMatchObject({ resendStatus: 500 });

    // Business email still went out after the failed buyer send.
    expect(h.emails).toHaveLength(2);
    expect(h.emails[1].to).toBe('biz@test.example');
  });

  test('buyer send fetch THROWING is caught → alert fires, business email still attempted', async () => {
    const h = withCatalog(makeHarness());
    h.emailResponder = (email) =>
      email.to === 'buyer@test.example' ? { throw: new Error('network down') } : { status: 200 };

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceEmailSent).toBe(false);

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('buyer_invoice_email');

    // The buyer attempt was recorded before the throw; the business email
    // still followed it.
    expect(h.emails).toHaveLength(2);
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[1].to).toBe('biz@test.example');
  });

  test('the buyer invoice names the order number and the total, from the id-filtered re-read', async () => {
    const h = withCatalog(makeHarness());
    const { body } = await placeOrder(h, basePayload());

    const orderNumber = body.orderNumber as string;
    expect(h.emails[0].to).toBe('buyer@test.example');
    expect(h.emails[0].subject).toContain(`Invoice ${orderNumber}`);
    expect(h.emails[0].html).toContain(orderNumber);
    expect(h.emails[0].html).toContain('$59.98'); // BPC $49.99 + guest shipping $9.99

    // The re-read fetched the row the handler just inserted, by its id.
    const reread = h.db.of('orders', 'select').find((q) => queryHas(q, 'eq', 'id', 'order-1'));
    expect(reread).toBeDefined();
  });
});

describe('business notification + telemetry endgame', () => {
  test('business email failing → alert with amountCents, response still succeeds with invoiceEmailSent true', async () => {
    const h = withCatalog(makeHarness());
    h.emailResponder = (email) =>
      email.to === 'biz@test.example' ? { status: 503, body: { error: 'down' } } : { status: 200 };

    const { status, body } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invoiceEmailSent).toBe(true); // buyer got theirs

    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].stage).toBe('business_notification_email');
    expect(h.alerts[0].ctx).toMatchObject({
      amountCents: TOTAL_CENTS,
      resendStatus: 503,
      orderId: 'order-1',
    });

    // The checkout itself succeeded, so the success telemetry fires even
    // though the business email failed (buyer-only email success) — email
    // outcomes alert (above) but must not hide a placed order from the log.
    const placed = h.logs.filter((l) => l.message === 'Order placed');
    expect(placed).toHaveLength(1);
    expect(placed[0].level).toBe('info');
  });

  test('both emails OK → "Order placed" logged and zero alerts', async () => {
    const h = withCatalog(makeHarness());
    const { status } = await placeOrder(h, basePayload());
    expect(status).toBe(200);
    expect(h.emails).toHaveLength(2);
    expect(h.alerts).toHaveLength(0);
    const placed = h.logs.filter((l) => l.message === 'Order placed');
    expect(placed).toHaveLength(1);
    expect(placed[0].level).toBe('info');
  });

  test('the full-success response body carries EXACTLY the documented keys', async () => {
    const h = withCatalog(makeHarness());
    const { body } = await placeOrder(h, basePayload());
    expect(Object.keys(body).sort()).toEqual([
      'amountCents',
      'contactIsEmail',
      'createdAt',
      'invoiceEmailSent',
      // Plain-language explanations for anything the server decided
      // differently from the cart (e.g. a code superseded by BOGO, or the
      // BOGO window closing while the cart sat open). Always present.
      'notices',
      'orderNumber',
      'referenceId',
      'success',
    ]);
    expect(body.amountCents).toBe(TOTAL_CENTS);
  });
});

describe('non-fatal persistence error logs (order still truthful)', () => {
  test('a promo-catalog availability read error proceeds at full retail, no promo rows', async () => {
    // qty 3 forces the promo planner's availability read; failing THAT read
    // (the second product_variant_stock select — the wide promo column list)
    // must fall closed to retail pricing, not refuse or discount the order.
    const h = withCatalog(makeHarness());
    h.db.on(
      'product_variant_stock',
      'select',
      { error: { message: 'availability read down' } },
      (q) => queryHas(q, 'select', 'sku, dose, on_hand, inbound_units, lead_days, price_cents, wholesale_eligible'),
    );
    const payload = basePayload();
    payload.items[0].quantity = 3;

    const { status, body } = await placeOrder(h, payload);

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS * 3 + GUEST_SHIPPING_CENTS);
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.discount_cents).toBe(0);
    expect(h.db.of('order_coupons', 'insert')).toHaveLength(0);
  });

  test('an account-discount order_coupons insert error is log-only — money on the order survives', async () => {
    const h = withCatalog(makeHarness());
    h.sessions.set('jwt-acct', { id: 'user-acct', email: 'buyer@test.example' });
    h.db.onRpc('effective_customer_discount', {
      data: { found: true, scope: 'lifetime', percent: 10, label: 'Loyal' },
    });
    h.db.on(
      'order_coupons',
      'insert',
      { error: { message: 'row refused' } },
      (q) => (q.payload as { source?: string } | undefined)?.source === 'account',
    );

    const { status, body } = await placeOrder(h, basePayload(), { bearer: 'jwt-acct' });

    expect(status).toBe(200);
    const discount = Math.round((BPC_PRICE_CENTS * 10) / 100);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - discount);
    const order = h.db.of('orders', 'insert')[0].payload as Record<string, unknown>;
    expect(order.discount_cents).toBe(discount);
    expect(h.alerts).toHaveLength(0); // deliberately log-only
  });

  test('a surviving-code order_coupons insert error is log-only — order and emails stay truthful', async () => {
    const h = withCatalog(makeHarness());
    h.db.onRpc('validate_coupon', {
      data: { valid: true, code: 'SAVE10', kind: 'fixed', amount_cents: 1000, discount_cents: 1000 },
    });
    h.db.onRpc('redeem_coupon', { data: { ok: true } });
    h.db.on(
      'order_coupons',
      'insert',
      { error: { message: 'code rows refused' } },
      (q) => Array.isArray(q.payload),
    );

    const { status, body } = await placeOrder(h, basePayload({ coupon_codes: ['SAVE10'] }));

    expect(status).toBe(200);
    expect(body.amountCents).toBe(BPC_PRICE_CENTS - 1000 + GUEST_SHIPPING_CENTS);
    expect(h.alerts).toHaveLength(0);
    expect(h.emails).toHaveLength(2);
  });
});
