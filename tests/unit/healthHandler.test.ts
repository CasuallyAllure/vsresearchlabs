/**
 * Orchestration suite for the health probe handler
 * (supabase/functions/health/handler.ts) — the PUBLIC uptime probe.
 *
 * Pins every decision: the method gate, the PostgREST probe request shape,
 * the ok/degraded status mapping, the missing-env degraded path, and the
 * no-info-leak invariant: the body is exactly {ok, db, ts}, always.
 */

import { describe, expect, test } from 'vitest';
import { makeHealthHarness } from '../helpers/miscFnsHarness';

function healthRequest(method = 'GET'): Request {
  return new Request('http://localhost/functions/v1/health', { method });
}

function withDbUp(h = makeHealthHarness()) {
  h.fetchMock.onUrl('/rest/v1/promo_settings', () => new Response('[]', { status: 200 }));
  return h;
}

describe('method gate', () => {
  test.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s returns a bare 405', async (method) => {
    const h = withDbUp();
    const res = await h.handler(healthRequest(method));

    expect(res.status).toBe(405);
    expect(await res.text()).toBe('');
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test.each(['GET', 'HEAD'])('%s is allowed', async (method) => {
    const h = withDbUp();
    const res = await h.handler(healthRequest(method));

    expect(res.status).toBe(200);
  });
});

describe('db probe', () => {
  test('probes promo_settings via PostgREST with service-role headers', async () => {
    const h = withDbUp();
    await h.handler(healthRequest());

    expect(h.fetchMock.calls).toHaveLength(1);
    const call = h.fetchMock.calls[0];
    expect(call.url).toBe('http://supabase.mock/rest/v1/promo_settings?select=id&limit=1');
    expect(call.init?.headers).toEqual({
      apikey: 'service-role-key',
      Authorization: 'Bearer service-role-key',
    });
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('db up → 200 with exactly {ok:true, db:true, ts}', async () => {
    const h = withDbUp();
    const res = await h.handler(healthRequest());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    // No-info-leak invariant: nothing beyond ok/db/ts, ever.
    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'ts']);
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(typeof body.ts).toBe('string');
    expect(Number.isNaN(Date.parse(body.ts as string))).toBe(false);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('cancels the probe response body stream', async () => {
    let cancelled = false;
    const h = makeHealthHarness();
    h.fetchMock.onUrl('/rest/v1/promo_settings', () => {
      const stream = new ReadableStream({
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    });

    const res = await h.handler(healthRequest());

    expect(res.status).toBe(200);
    expect(cancelled).toBe(true);
  });
});

describe('degraded paths (all pin the exact {ok:false, db:false, ts} 503)', () => {
  async function expectDegraded(res: Response): Promise<void> {
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(503);
    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'ts']);
    expect(body.ok).toBe(false);
    expect(body.db).toBe(false);
    expect(typeof body.ts).toBe('string');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  }

  test('PostgREST non-ok status → 503', async () => {
    const h = makeHealthHarness();
    h.fetchMock.onUrl('/rest/v1/promo_settings', () => new Response('down', { status: 500 }));

    await expectDegraded(await h.handler(healthRequest()));
  });

  test('probe fetch throws → 503, error swallowed', async () => {
    const h = makeHealthHarness();
    h.fetchMock.onUrl('/rest/v1/promo_settings', () => {
      throw new Error('connect timeout');
    });

    await expectDegraded(await h.handler(healthRequest()));
  });

  test('missing SUPABASE_URL → 503 without any outbound fetch', async () => {
    const h = makeHealthHarness({ supabaseUrl: '' });

    await expectDegraded(await h.handler(healthRequest()));
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test('missing service key → 503 without any outbound fetch', async () => {
    const h = makeHealthHarness({ serviceKey: '' });

    await expectDegraded(await h.handler(healthRequest()));
    expect(h.fetchMock.calls).toHaveLength(0);
  });
});
