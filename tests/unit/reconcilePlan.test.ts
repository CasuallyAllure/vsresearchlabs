/**
 * Unit tests for supabase/functions/reconcile/reconcilePlan.ts — the
 * Deno-free half of the reconciliation probe (crash-window close,
 * migration 067).
 *
 * The contract under test is the uptime pager boundary: `"clean":true`
 * iff no mismatch needs a human. Auto-repaired rows keep the probe green
 * (already healed) but must be logged; open mismatches flip clean:false
 * (workflow fails → operator paged); RPC failures fail the probe loudly
 * rather than reporting a clean state they cannot know.
 */
import { describe, expect, test } from 'vitest';
import { planReconcileResponse } from '../../supabase/functions/reconcile/reconcilePlan';

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, mismatches: 0, repaired: 0, ...overrides };
}

describe('planReconcileResponse', () => {
  test('clean run: 200, clean:true, nothing logged', () => {
    const plan = planReconcileResponse(summary(), null);
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({ ok: true, clean: true, repaired: 0 });
    expect(plan.log).toBeNull();
  });

  test('auto-repaired rows stay clean (incident healed) but log a warn', () => {
    const plan = planReconcileResponse(summary({ repaired: 2 }), null);
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({ ok: true, clean: true, repaired: 2 });
    expect(plan.log?.severity).toBe('warn');
    expect(plan.log?.message).toContain('auto-repaired 2');
  });

  test('open mismatches flip clean:false and log fatal — the pager fires', () => {
    const plan = planReconcileResponse(summary({ mismatches: 3, repaired: 1 }), null);
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({ ok: true, clean: false, repaired: 1 });
    expect(plan.log?.severity).toBe('fatal');
    expect(plan.log?.message).toContain('3 open mismatches');
  });

  test('a single mismatch is reported singular', () => {
    const plan = planReconcileResponse(summary({ mismatches: 1 }), null);
    expect(plan.body.clean).toBe(false);
    expect(plan.log?.message).toContain('1 open mismatch ');
  });

  test('RPC error: 503, ok:false, clean:false — never a false green', () => {
    const plan = planReconcileResponse(null, { message: 'connection refused' });
    expect(plan.status).toBe(503);
    expect(plan.body).toEqual({ ok: false, clean: false, repaired: 0 });
    expect(plan.log?.severity).toBe('error');
    expect(plan.log?.message).toContain('connection refused');
  });

  test('RPC error without a message still fails loudly', () => {
    const plan = planReconcileResponse(null, {});
    expect(plan.status).toBe(503);
    expect(plan.body.clean).toBe(false);
    expect(plan.log?.message).toContain('unknown error');
  });

  test.each([null, 'string', 42, { ok: false }, { notOk: true }])(
    'malformed RPC summary %j degrades to a failed probe',
    (data) => {
      const plan = planReconcileResponse(data, null);
      expect(plan.status).toBe(503);
      expect(plan.body).toEqual({ ok: false, clean: false, repaired: 0 });
      expect(plan.log?.severity).toBe('error');
    },
  );

  test.each([-1, 1.5, NaN, 'many', undefined])(
    'non-sane mismatch count %j is treated as zero, not trusted',
    (mismatches) => {
      const plan = planReconcileResponse(summary({ mismatches }), null);
      expect(plan.body.clean).toBe(true);
      expect(plan.status).toBe(200);
    },
  );

  test('repaired count is sanitized the same way', () => {
    const plan = planReconcileResponse(summary({ repaired: -5 }), null);
    expect(plan.body.repaired).toBe(0);
    expect(plan.log).toBeNull();
  });
});
