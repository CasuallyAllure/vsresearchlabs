/**
 * Orchestration tests — send-inquiry (handler.ts).
 *
 * Drives the REAL handler through the harness (tests/helpers/
 * notificationFnsHarness) and pins every decision path: method/env gates,
 * JSON parsing, turnstile, every validation rejection, item normalization
 * (qty clamp, note truncation), the rate limit, the inquiries insert (row
 * shape + failure), best-effort inquiry_items, the business/buyer email
 * split (failure semantics differ!), HTML escaping, and the exact response
 * contracts.
 */
import { describe, expect, test } from 'vitest';
import {
  callFn,
  inquiryPayload,
  makeInquiryHarness,
  queryHas,
  TEST_CORS,
  withInquiryInsert,
} from '../helpers/notificationFnsHarness';

function readyHarness() {
  return withInquiryInsert(makeInquiryHarness());
}

describe('request gates', () => {
  test('OPTIONS preflight returns 204 with the CORS headers and touches nothing', async () => {
    const h = makeInquiryHarness();
    const { status, response } = await callFn(h, undefined, { method: 'OPTIONS' });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.db.queries).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  test('non-POST methods are refused with 405', async () => {
    const h = makeInquiryHarness();
    const { status, body } = await callFn(h, undefined, { method: 'GET' });
    expect(status).toBe(405);
    expect(body.error).toBe('Method not allowed.');
  });

  test('missing Resend key fails closed with 500 before any work', async () => {
    const h = makeInquiryHarness({ resendApiKey: '' });
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Email service not configured.');
    expect(h.db.queries).toHaveLength(0);
  });

  test.each([
    ['supabaseUrl', { supabaseUrl: '' }],
    ['supabaseServiceKey', { supabaseServiceKey: '' }],
  ] as const)('missing %s fails closed with 500', async (_label, overrides) => {
    const h = makeInquiryHarness(overrides);
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(500);
    expect(body.error).toBe('Database service not configured.');
  });

  test('unparseable JSON body is a 400', async () => {
    const h = makeInquiryHarness();
    const { status, body } = await callFn(h, undefined, { rawBody: 'not json {' });
    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body.');
  });

  test('failed turnstile verification is a 403 carrying the reason', async () => {
    const h = makeInquiryHarness();
    h.turnstileResult = { ok: false, reason: 'Bot check failed.' };
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Bot check failed.');
    expect(h.db.queries).toHaveLength(0);
  });

  test('failed turnstile without a reason falls back to the generic message', async () => {
    const h = makeInquiryHarness();
    h.turnstileResult = { ok: false };
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(403);
    expect(body.error).toBe('Verification failed.');
  });
});

describe('payload validation', () => {
  test.each([
    ['blank name', { name: '   ' }, 'Name is required.'],
    ['name too long', { name: 'x'.repeat(121) }, 'Name too long.'],
    ['blank contact', { contact: '  ' }, 'Contact is required.'],
    ['contact too long', { contact: 'x'.repeat(201) }, 'Contact too long.'],
    ['organization too long', { organization: 'x'.repeat(201) }, 'Organization too long.'],
    ['notes too long', { notes: 'x'.repeat(4001) }, 'Notes too long.'],
    ['no items', { items: [] }, 'Inquiry must contain at least one item.'],
    ['items not an array', { items: 'nope' as never }, 'Inquiry must contain at least one item.'],
  ])('%s is a 400 with the exact message', async (_label, overrides, message) => {
    const h = makeInquiryHarness();
    const { status, body } = await callFn(h, inquiryPayload(overrides as never));
    expect(status).toBe(400);
    expect(body.error).toBe(message);
    expect(h.db.queries).toHaveLength(0);
  });

  test('more than 100 items is a 400', async () => {
    const h = makeInquiryHarness();
    const item = inquiryPayload().items[0];
    const { status, body } = await callFn(h, inquiryPayload({ items: Array(101).fill(item) }));
    expect(status).toBe(400);
    expect(body.error).toBe('Too many items in inquiry.');
  });

  test.each([
    ['a non-object item', ['nope'], 'Malformed item in inquiry.'],
    ['an item without product', [{ quantity: 1 }], 'Item missing product details.'],
    ['a product without id', [{ product: { name: 'X' }, quantity: 1 }], 'Item product must include id and name.'],
    ['a product without name', [{ product: { id: 'x' }, quantity: 1 }], 'Item product must include id and name.'],
  ])('%s is a 400 with the exact message', async (_label, items, message) => {
    const h = makeInquiryHarness();
    const { status, body } = await callFn(h, inquiryPayload({ items: items as never }));
    expect(status).toBe(400);
    expect(body.error).toBe(message);
  });

  test('quantities are clamped (0→1, 5000→999, NaN→1) into item_count and rows', async () => {
    const h = readyHarness();
    const product = { id: 'p', name: 'P', category: null };
    await callFn(h, inquiryPayload({
      items: [
        { product, quantity: 0 },
        { product, quantity: 5000 },
        { product, quantity: Number.NaN },
      ],
    }));
    const inquiry = h.db.of('inquiries', 'insert')[0].payload as Record<string, unknown>;
    expect(inquiry.item_count).toBe(1 + 999 + 1);
    const items = h.db.of('inquiry_items', 'insert')[0].payload as { quantity: number }[];
    expect(items.map((i) => i.quantity)).toEqual([1, 999, 1]);
  });

  test('item notes are trimmed and truncated to 1000 chars in the row', async () => {
    const h = readyHarness();
    const product = { id: 'p', name: 'P', category: null };
    await callFn(h, inquiryPayload({
      items: [{ product, quantity: 1, note: '  ' + 'n'.repeat(1500) + '  ' }],
    }));
    const items = h.db.of('inquiry_items', 'insert')[0].payload as { item_note: string }[];
    expect(items[0].item_note).toHaveLength(1000);
  });

  test('ship fields are truncated to their column caps on the inquiry row', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({
      ship_street: 's'.repeat(300),
      ship_city: 'c'.repeat(200),
      ship_state: 't'.repeat(100),
      ship_zip: 'z'.repeat(40),
      ship_country: 'u'.repeat(100),
    }));
    const row = h.db.of('inquiries', 'insert')[0].payload as Record<string, string>;
    expect(row.ship_street).toHaveLength(200);
    expect(row.ship_city).toHaveLength(120);
    expect(row.ship_state).toHaveLength(60);
    expect(row.ship_zip).toHaveLength(20);
    expect(row.ship_country).toHaveLength(60);
  });
});

describe('rate limit', () => {
  test('the 5th inquiry in an hour from one contact is a 429', async () => {
    const h = makeInquiryHarness();
    h.db.on('inquiries', 'select', { count: 5 }, (q) => q.isCount);
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(429);
    expect(body.error).toBe(
      'Too many inquiries from this contact. Please wait before submitting again.',
    );
    expect(h.db.of('inquiries', 'insert')).toHaveLength(0);
  });

  // QUIRK (pinned, not fixed): the bucket is a case-SENSITIVE .eq() match —
  // unlike place-order and send-contact (case-folded ilike), re-casing the
  // contact opens a fresh bucket.
  test('QUIRK: the contact bucket is matched with an exact case-sensitive .eq()', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({ contact: 'Buyer@Test.example' }));
    const countQuery = h.db.of('inquiries', 'select').find((q) => q.isCount);
    expect(countQuery).toBeDefined();
    expect(queryHas(countQuery!, 'eq', 'contact', 'Buyer@Test.example')).toBe(true);
  });
});

describe('persistence', () => {
  test('the inquiries row carries the normalized payload, OPEN status, and intake metadata', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({
      name: '  Test Buyer  ',
      organization: 'Acme Labs',
      notes: 'please hurry',
      ship_street: '1 Research Way',
      ship_city: 'Lab City',
    }));
    const row = h.db.of('inquiries', 'insert')[0].payload as Record<string, unknown>;
    expect(row).toMatchObject({
      name: 'Test Buyer',
      contact: 'buyer@test.example',
      organization: 'Acme Labs',
      notes: 'please hurry',
      ship_street: '1 Research Way',
      ship_city: 'Lab City',
      ship_state: null,
      status: 'OPEN',
      intake_channel: 'VSR-WEB-PORTAL',
      processing_node: 'VSR-HQ-INTAKE',
      item_count: 2,
    });
    expect(String(row.reference_id)).toMatch(/^VSR-REQ-\d{6}-\d{3}$/);
  });

  test('an inquiries insert failure is a 502 and sends no email', async () => {
    const h = makeInquiryHarness();
    h.db.on('inquiries', 'insert', { error: { message: 'insert died' } });
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(502);
    expect(body.error).toBe('Failed to record inquiry. Please try again.');
    expect(h.emails).toHaveLength(0);
  });

  test('an inquiry_items failure is best-effort — the request still succeeds', async () => {
    const h = readyHarness();
    h.db.on('inquiry_items', 'insert', { error: { message: 'items died' } });
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.emails).toHaveLength(2);
  });

  test('inquiry_items rows fall back to product id when the sku is missing', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({
      items: [{ product: { id: 'bare-id', name: 'No SKU', category: null }, quantity: 1 }],
    }));
    const items = h.db.of('inquiry_items', 'insert')[0].payload as { sku: string }[];
    expect(items[0].sku).toBe('bare-id');
  });
});

describe('emails + response contract', () => {
  test('happy path sends business then buyer email and returns the full intake record', async () => {
    const h = readyHarness();
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      referenceId: h.emails[0].subject.match(/VSR-REQ-\d{6}-\d{3}/)?.[0],
      submittedAt: '2026-07-18T00:00:00.000Z',
      intakeChannel: 'VSR-WEB-PORTAL',
      processingNode: 'VSR-HQ-INTAKE',
      classificationStatus: 'OPEN',
      userCopySent: true,
      contactIsEmail: true,
    });

    expect(h.emails).toHaveLength(2);
    // Business first, reply-to the buyer.
    expect(h.emails[0].to).toBe('biz@test.example');
    expect(h.emails[0].from).toBe('VSR Test <from@test.example>');
    expect(h.emails[0].subject).toMatch(/^Procurement Inquiry VSR-REQ-\d{6}-\d{3} — Test Buyer$/);
    expect(h.emails[0].reply_to).toBe('buyer@test.example');
    // Buyer confirmation second, no reply-to.
    expect(h.emails[1].to).toBe('buyer@test.example');
    expect(h.emails[1].subject).toMatch(/^Inquiry VSR-REQ-\d{6}-\d{3} received — /);
    expect(h.emails[1].reply_to).toBeUndefined();
  });

  test('a phone contact gets no buyer copy and no business reply-to', async () => {
    const h = readyHarness();
    const { status, body } = await callFn(h, inquiryPayload({ contact: '555-0100' }));
    expect(status).toBe(200);
    expect(body.contactIsEmail).toBe(false);
    expect(body.userCopySent).toBe(false);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe('biz@test.example');
    expect(h.emails[0].reply_to).toBeUndefined();
  });

  test('a business email failure still succeeds with emailDeliveryFailed and skips the buyer copy', async () => {
    const h = readyHarness();
    h.emailResponder = () => ({ status: 500, body: { message: 'down' } });
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      classificationStatus: 'OPEN',
      userCopySent: false,
      emailDeliveryFailed: true,
    });
    // QUIRK: this branch's response has no contactIsEmail field.
    expect(body.contactIsEmail).toBeUndefined();
    expect(h.emails).toHaveLength(1); // buyer copy never attempted
  });

  test('a buyer email failure is best-effort — success with userCopySent:false', async () => {
    const h = readyHarness();
    h.emailResponder = (email) =>
      email.to === 'buyer@test.example'
        ? { status: 500, body: { message: 'down' } }
        : { status: 200 };
    const { status, body } = await callFn(h, inquiryPayload());
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.userCopySent).toBe(false);
    expect(body.emailDeliveryFailed).toBeUndefined();
    expect(h.emails).toHaveLength(2);
  });

  test('user-controlled fields are HTML-escaped in both emails', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({
      name: '<script>alert(1)</script>',
      organization: 'Acme & "Sons"',
      notes: 'line<1>\nline2',
      items: [
        {
          product: { id: 'p', name: 'Item "A" & \'B\'', category: 'lab-equipment', sku: 'SK<U>' },
          quantity: 1,
          note: 'note & <note>',
        },
      ],
    }));
    for (const email of h.emails) {
      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(email.html).toContain('Item &quot;A&quot; &amp; &#39;B&#39;');
      expect(email.html).toContain('SK&lt;U&gt;');
    }
    // Business email carries org, notes (with <br/>), and the note row.
    expect(h.emails[0].html).toContain('Acme &amp; &quot;Sons&quot;');
    expect(h.emails[0].html).toContain('line&lt;1&gt;<br/>line2');
    expect(h.emails[0].html).toContain('note &amp; &lt;note&gt;');
    // Category renders with dashes replaced.
    expect(h.emails[0].html).toContain('lab equipment');
  });

  // QUIRK (pinned, not fixed): buildBusinessEmailHtml has a ship-to block,
  // but it renders from cleanPayload — which drops every ship_* field — so
  // the address is persisted to the inquiries row yet NEVER appears in the
  // business email. The block is effectively dead code.
  test('QUIRK: the business email omits the ship-to block even when an address was sent', async () => {
    const h = readyHarness();
    await callFn(h, inquiryPayload({
      ship_street: '1 Research Way',
      ship_city: 'Lab City',
      ship_state: 'CA',
      ship_zip: '90001',
      ship_country: 'US',
    }));
    const row = h.db.of('inquiries', 'insert')[0].payload as Record<string, unknown>;
    expect(row.ship_street).toBe('1 Research Way'); // persisted…
    expect(h.emails[0].html).not.toContain('Ship to:'); // …but never emailed
    expect(h.emails[0].html).not.toContain('1 Research Way');
  });
});
