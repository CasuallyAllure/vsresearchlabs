/**
 * Orchestration suite for the report-error handler
 * (supabase/functions/report-error/handler.ts) — the PUBLIC client error
 * sink. Pins every decision: preflight, method gate, the per-IP rate limit
 * (window, reset, quiet 429), the 16 KB body cap, JSON-shape validation,
 * required-message rule, source whitelisting, per-field truncation, context
 * sanitization, and the exact log line vs response contract.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  makeReportErrorHarness,
  reportRequest,
  readJson,
  truncate,
  TEST_CORS,
} from '../helpers/miscFnsHarness';

const REPORT = { message: 'boom', source: 'boundary' };

afterEach(() => {
  vi.useRealTimers();
});

describe('preflight + method gate', () => {
  test('OPTIONS → 204 with CORS headers', async () => {
    const h = makeReportErrorHarness();
    const res = await h.handler(reportRequest(undefined, { method: 'OPTIONS' }));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
  });

  test.each(['GET', 'PUT', 'DELETE'])('%s → 405 JSON error', async (method) => {
    const h = makeReportErrorHarness();
    const res = await h.handler(reportRequest(undefined, { method }));

    expect(res.status).toBe(405);
    expect(await readJson(res)).toEqual({ error: 'Method not allowed.' });
    expect(h.logs).toHaveLength(0);
  });
});

describe('rate limit', () => {
  test('31st report from one IP inside the window → quiet 429 (empty body, no log line)', async () => {
    const h = makeReportErrorHarness();
    for (let i = 0; i < 30; i++) {
      const res = await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }));
      expect(res.status).toBe(202);
    }

    const limited = await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }));

    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('');
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(
      TEST_CORS['Access-Control-Allow-Origin'],
    );
    expect(h.logs).toHaveLength(30);
  });

  test('the limit is per-IP: a different IP still passes', async () => {
    const h = makeReportErrorHarness();
    for (let i = 0; i < 31; i++) await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }));

    const other = await h.handler(reportRequest(REPORT, { ip: '198.51.100.2' }));
    expect(other.status).toBe(202);
  });

  test('the window resets after 60s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const h = makeReportErrorHarness();
    for (let i = 0; i < 31; i++) await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }));
    expect((await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }))).status).toBe(429);

    vi.setSystemTime(new Date('2026-07-18T12:01:01Z'));

    const res = await h.handler(reportRequest(REPORT, { ip: '198.51.100.1' }));
    expect(res.status).toBe(202);
  });

  test('missing x-forwarded-for buckets under "unknown" (shared limit)', async () => {
    const h = makeReportErrorHarness();
    for (let i = 0; i < 30; i++) {
      expect((await h.handler(reportRequest(REPORT))).status).toBe(202);
    }
    expect((await h.handler(reportRequest(REPORT))).status).toBe(429);
  });

  test('only the first x-forwarded-for hop identifies the caller', async () => {
    const h = makeReportErrorHarness();
    for (let i = 0; i < 31; i++) {
      await h.handler(reportRequest(REPORT, { ip: '198.51.100.9, 10.0.0.1' }));
    }
    // Same first hop, different chain → still limited.
    const res = await h.handler(reportRequest(REPORT, { ip: '198.51.100.9, 10.9.9.9' }));
    expect(res.status).toBe(429);
  });

  test('stale-bucket sweep keeps accepting traffic past 500 distinct IPs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const h = makeReportErrorHarness();
    for (let i = 0; i < 501; i++) {
      expect((await h.handler(reportRequest(REPORT, { ip: `10.0.${i >> 8}.${i & 255}` }))).status).toBe(202);
    }

    vi.setSystemTime(new Date('2026-07-18T12:02:00Z'));
    const res = await h.handler(reportRequest(REPORT, { ip: '198.51.100.50' }));
    expect(res.status).toBe(202);
  });
});

describe('payload validation', () => {
  test('body over 16,000 chars → 413', async () => {
    const h = makeReportErrorHarness();
    const rawBody = JSON.stringify({ message: 'x'.repeat(16_100) });
    const res = await h.handler(reportRequest(undefined, { rawBody, ip: '1.1.1.1' }));

    expect(res.status).toBe(413);
    expect(await readJson(res)).toEqual({ error: 'Payload too large.' });
    expect(h.logs).toHaveLength(0);
  });

  test.each([
    ['not json', '{nope'],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"hi"'],
    ['JSON null', 'null'],
  ])('%s → 400 Invalid JSON body', async (_label, rawBody) => {
    const h = makeReportErrorHarness();
    const res = await h.handler(reportRequest(undefined, { rawBody, ip: '1.1.1.2' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'Invalid JSON body.' });
  });

  test.each([
    ['missing', {}],
    ['empty', { message: '' }],
    ['non-string', { message: 42 }],
  ])('message %s → 400 message is required', async (_label, body) => {
    const h = makeReportErrorHarness();
    const res = await h.handler(reportRequest(body, { ip: '1.1.1.3' }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: 'message is required.' });
    expect(h.logs).toHaveLength(0);
  });
});

describe('the written log line', () => {
  test('valid report → 202 {ok:true} and ONE error-severity line with the sanitized fields', async () => {
    const h = makeReportErrorHarness();
    const res = await h.handler(
      reportRequest(
        {
          message: 'TypeError: x is undefined',
          source: 'boundary',
          name: 'TypeError',
          path: '/store',
          userAgent: 'UA/1.0',
          at: '2026-07-18T12:00:00Z',
          stack: 'TypeError: x is undefined\n  at render',
          context: { component: 'Catalog' },
        },
        { ip: '2.2.2.1' },
      ),
    );

    expect(res.status).toBe(202);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toEqual({
      severity: 'error',
      fn: 'report-error',
      message: 'TypeError: x is undefined',
      ctx: {
        clientSource: 'boundary',
        errorName: 'TypeError',
        path: '/store',
        userAgent: 'UA/1.0',
        clientAt: '2026-07-18T12:00:00Z',
        stack: 'TypeError: x is undefined\n  at render',
        component: 'Catalog',
      },
    });
  });

  test('optional fields default: name → "Error", others → null', async () => {
    const h = makeReportErrorHarness();
    await h.handler(reportRequest({ message: 'boom' }, { ip: '2.2.2.2' }));

    expect(h.logs[0].ctx).toEqual({
      clientSource: 'unknown',
      errorName: 'Error',
      path: null,
      userAgent: null,
      clientAt: null,
      stack: null,
    });
  });

  test.each(['boundary', 'window', 'rejection', 'manual'])(
    'whitelisted source %s passes through',
    async (source) => {
      const h = makeReportErrorHarness();
      await h.handler(reportRequest({ message: 'm', source }, { ip: '2.2.2.3' }));
      expect(h.logs[0].ctx?.clientSource).toBe(source);
    },
  );

  test('unlisted source → "unknown"', async () => {
    const h = makeReportErrorHarness();
    await h.handler(reportRequest({ message: 'm', source: 'evil' }, { ip: '2.2.2.4' }));
    expect(h.logs[0].ctx?.clientSource).toBe('unknown');
  });

  test('message and stack are truncated to their caps', async () => {
    const h = makeReportErrorHarness();
    await h.handler(
      reportRequest(
        { message: 'm'.repeat(600), stack: 's'.repeat(3500), at: 't'.repeat(60) },
        { ip: '2.2.2.5' },
      ),
    );

    expect(h.logs[0].message).toBe(truncate('m'.repeat(600), 500));
    expect(h.logs[0].ctx?.stack).toBe(truncate('s'.repeat(3500), 3000));
    expect(h.logs[0].ctx?.clientAt).toBe(truncate('t'.repeat(60), 40));
  });

  test('context sanitization: bad keys, nesting, and nulls dropped; values stringified + capped at 10 keys', async () => {
    const h = makeReportErrorHarness();
    const context: Record<string, unknown> = {
      'bad key!': 'dropped',
      nested: { a: 1 },
      nullish: null,
      count: 7,
      flag: true,
      long: 'x'.repeat(400),
    };
    for (let i = 0; i < 12; i++) context[`k${i}`] = i;

    await h.handler(reportRequest({ message: 'm', context }, { ip: '2.2.2.6' }));

    const ctx = h.logs[0].ctx as Record<string, unknown>;
    expect(ctx['bad key!']).toBeUndefined();
    expect(ctx.nested).toBeUndefined();
    expect(ctx.nullish).toBeUndefined();
    expect(ctx.count).toBe('7');
    expect(ctx.flag).toBe('true');
    expect(ctx.long).toBe(truncate('x'.repeat(400), 300));
    // 10-key cap across accepted context entries.
    const contextKeys = Object.keys(ctx).filter(
      (k) => !['clientSource', 'errorName', 'path', 'userAgent', 'clientAt', 'stack'].includes(k),
    );
    expect(contextKeys).toHaveLength(10);
  });

  test('non-object context is discarded entirely', async () => {
    const h = makeReportErrorHarness();
    await h.handler(reportRequest({ message: 'm', context: ['a'] }, { ip: '2.2.2.7' }));

    expect(Object.keys(h.logs[0].ctx as Record<string, unknown>).sort()).toEqual([
      'clientAt',
      'clientSource',
      'errorName',
      'path',
      'stack',
      'userAgent',
    ]);
  });
});
