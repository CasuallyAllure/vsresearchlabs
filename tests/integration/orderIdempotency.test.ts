/**
 * Checkout idempotency constraint (migration 035) against a REAL local
 * Postgres.
 *
 * place-order's dedupe contract rests on orders_idempotency_key_uidx — a
 * PARTIAL unique index (where idempotency_key is not null). The handler unit
 * suite simulates the 23505 it expects; this suite proves the database
 * actually raises it, and that the null carve-out for admin/historic orders
 * really lets unlimited null-key rows through.
 *
 * Requires a LOCAL `supabase start` stack; see tests/integration/env.ts for
 * the guard. NEVER point this at production.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { canRun, logSkipReason, serviceClient } from './env';

logSkipReason('orders idempotency suite');

describe.skipIf(!canRun)('orders idempotency constraint (real DB, migration 035)', () => {
  const runId = randomUUID().slice(0, 8).toUpperCase();
  let service: SupabaseClient;

  function orderRow(suffix: string, idempotencyKey: string | null) {
    return {
      order_number: `ITEST-IK-${runId}-${suffix}`,
      buyer_name: 'Idempotency Test Buyer',
      buyer_contact: `ik-${runId}@example.test`,
      idempotency_key: idempotencyKey,
    };
  }

  beforeAll(() => {
    service = serviceClient();
  });

  afterAll(async () => {
    if (!canRun) return;
    await service.from('orders').delete().like('order_number', `ITEST-IK-${runId}-%`);
  }, 30_000);

  test('re-inserting the same idempotency_key raises Postgres 23505', async () => {
    const key = randomUUID();

    const first = await service.from('orders').insert(orderRow('A', key));
    expect(first.error).toBeNull();

    const second = await service.from('orders').insert(orderRow('B', key));
    expect(second.error).toBeTruthy();
    // The exact SQLSTATE is the contract: place-order's retry path branches on
    // duplicate-key (23505) to return the already-created order.
    expect(second.error?.code).toBe('23505');

    // The duplicate insert created nothing.
    const rows = await service
      .from('orders')
      .select('id')
      .eq('idempotency_key', key);
    expect(rows.data).toHaveLength(1);
  });

  test('a different key inserts fine; null keys are exempt from uniqueness', async () => {
    const other = await service.from('orders').insert(orderRow('C', randomUUID()));
    expect(other.error).toBeNull();

    // Two admin-style null-key orders coexist — the index is partial.
    const nullA = await service.from('orders').insert(orderRow('D', null));
    const nullB = await service.from('orders').insert(orderRow('E', null));
    expect(nullA.error).toBeNull();
    expect(nullB.error).toBeNull();
  });
});
