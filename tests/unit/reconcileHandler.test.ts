/**
 * Orchestration suite for the reconcile probe handler
 * (supabase/functions/reconcile/handler.ts) — the PUBLIC reward-voucher
 * reconciliation probe. The response-PLANNING half (reconcilePlan.ts) has
 * its own suite; this one pins the orchestration around it: the method gate,
 * the RPC request shape, env/HTTP/throw failure paths, the log-not-body
 * detail routing, and the no-info-leak invariant: the body is exactly
 * {ok, clean, repaired, ts}, always.
 */

import { describe, expect, test } from 'vitest';
import { jsonRes, makeReconcileHarness } from '../helpers/miscFnsHarness';

function reconcileRequest(method = 'GET'): Request {
  return new Request('http://localhost/functions/v1/reconcile', { method });
}

const RPC_URL_PART = '/rest/v1/rpc/reconcile_reward_vouchers';

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.clone().json()) as Record<string, unknown>;
  // No-info-leak invariant: nothing beyond ok/clean/repaired/ts, ever —
  // no ids, no amounts, no error strings.
  expect(Object.keys(body).sort()).toEqual(['clean', 'ok', 'repaired', 'ts']);
  expect(typeof body.ts).toBe('string');
  return body;
}

describe('method gate', () => {
  test.each(['POST', 'PUT', 'DELETE'])('%s returns a bare 405, no RPC call', async (method) => {
    const h = makeReconcileHarness();
    const res = await h.handler(reconcileRequest(method));

    expect(res.status).toBe(405);
    expect(await res.text()).toBe('');
    expect(h.fetchMock.calls).toHaveLength(0);
    expect(h.logs).toHaveLength(0);
  });

  test.each(['GET', 'HEAD'])('%s is allowed', async (method) => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes({ ok: true, mismatches: 0, repaired: 0 }));

    const res = await h.handler(reconcileRequest(method));
    expect(res.status).toBe(200);
  });
});

describe('RPC request shape', () => {
  test('POSTs p_repair:true to the reconcile_reward_vouchers RPC with service-role headers', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes({ ok: true, mismatches: 0, repaired: 0 }));

    await h.handler(reconcileRequest());

    expect(h.fetchMock.calls).toHaveLength(1);
    const call = h.fetchMock.calls[0];
    expect(call.url).toBe('http://supabase.mock/rest/v1/rpc/reconcile_reward_vouchers');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers).toEqual({
      apikey: 'service-role-key',
      Authorization: 'Bearer service-role-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(call.init?.body))).toEqual({ p_repair: true });
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('outcomes', () => {
  test('clean run → 200 {ok:true, clean:true, repaired:0} and NO log line', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes({ ok: true, mismatches: 0, repaired: 0 }));

    const res = await h.handler(reconcileRequest());
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.clean).toBe(true);
    expect(body.repaired).toBe(0);
    expect(h.logs).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('open mismatches → clean:false in body, FULL summary routed to the fatal log only', async () => {
    const summary = { ok: true, mismatches: 2, repaired: 1, ids: ['order-9'] };
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes(summary));

    const res = await h.handler(reconcileRequest());
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, clean: false, repaired: 1 });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ severity: 'fatal', fn: 'reconcile' });
    expect(h.logs[0].message).toContain('2 open mismatches');
    // Detail (ids) goes to the log ctx, never the response body.
    expect(h.logs[0].ctx).toEqual({ summary });
    expect(JSON.stringify(body)).not.toContain('order-9');
  });

  test('auto-repaired only → clean:true, repaired count surfaced, warn log', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes({ ok: true, mismatches: 0, repaired: 3 }));

    const res = await h.handler(reconcileRequest());
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, clean: true, repaired: 3 });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0].severity).toBe('warn');
    expect(h.logs[0].message).toContain('auto-repaired 3');
  });
});

describe('failure paths (all pin the exact {ok:false, clean:false, repaired:0} 503)', () => {
  async function expectFailedProbe(res: Response): Promise<void> {
    const body = await bodyOf(res);
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, clean: false, repaired: 0 });
  }

  test('missing runtime env → 503 without any outbound fetch, error logged', async () => {
    const h = makeReconcileHarness({ supabaseUrl: '' });

    await expectFailedProbe(await h.handler(reconcileRequest()));
    expect(h.fetchMock.calls).toHaveLength(0);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0].severity).toBe('error');
    expect(h.logs[0].message).toContain('missing runtime env');
  });

  test('missing service key → same 503 path', async () => {
    const h = makeReconcileHarness({ serviceKey: '' });

    await expectFailedProbe(await h.handler(reconcileRequest()));
    expect(h.fetchMock.calls).toHaveLength(0);
  });

  test('PostgREST non-ok → 503, status + response text in the log, not the body', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => new Response('permission denied', { status: 403 }));

    const res = await h.handler(reconcileRequest());
    await expectFailedProbe(res);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0].message).toContain('PostgREST status 403: permission denied');
    expect(await res.clone().text()).not.toContain('permission denied');
  });

  test('RPC fetch throws → 503 with the error message logged', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => {
      throw new Error('socket hang up');
    });

    await expectFailedProbe(await h.handler(reconcileRequest()));
    expect(h.logs[0].message).toContain('socket hang up');
  });

  test('malformed RPC summary (ok not true) → 503 failed probe', async () => {
    const h = makeReconcileHarness();
    h.fetchMock.onUrl(RPC_URL_PART, () => jsonRes({ nonsense: 1 }));

    await expectFailedProbe(await h.handler(reconcileRequest()));
    expect(h.logs[0].message).toContain('malformed summary');
  });
});
