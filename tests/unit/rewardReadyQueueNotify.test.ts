/**
 * Needs-attention → reward_ready "Notify": one press mails every member over
 * the 300-point threshold through send-member-offer (kind 'reward_ready',
 * period 'rr-<stage>'), skips marketing opt-outs before the dialog, and a
 * second press reports already_sent instead of mailing twice.
 *
 * The supabase seam is mocked; the real email_log claim is proven in
 * tests/unit/sendMemberOfferHandler.test.ts.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import {
  notifyRewardReadyMembers, rewardNotifyDialogMessage, summarizeRewardNotify,
} from '../../src/pages/admin/members/useRewardReadyNotify';
import type { ConfirmFn } from '../../src/components/admin/accountPanels/shared';

const yes = () => vi.fn<ConfirmFn>(async () => true);
const no = () => vi.fn<ConfirmFn>(async () => false);

const ROSTER = {
  rows: [
    { userId: 'u-santos', name: 'Maria Santos', contact: 'Santos@Example.com', points: 301, rewardReady: true },
    { userId: 'u-osei', name: 'Ben Osei', contact: 'ben@example.com', points: 640, rewardReady: true },
    { userId: 'u-reyes', name: 'Ada Reyes', contact: 'ada@example.com', points: 310, rewardReady: true },
  ],
  total: 3,
};

function makeClient(opts: {
  optedOut?: string[];
  invoke?: ReturnType<typeof vi.fn>;
  rosterError?: unknown;
}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'admin_member_roster') return { data: null, error: null };
    if (opts.rosterError) return { data: null, error: opts.rosterError };
    expect(args.p_segment).toBe('reward-ready');
    return { data: ROSTER, error: null };
  });
  const from = vi.fn((table: string) => {
    expect(table).toBe('customer_profiles');
    return {
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: ids.map((id) => ({ user_id: id, marketing_opt_out: (opts.optedOut ?? []).includes(id) })),
          error: null,
        }),
      }),
    };
  });
  const invoke = opts.invoke ?? vi.fn(async () => ({ data: { ok: true, status: 'sent' }, error: null }));
  return { rpc, from, functions: { invoke } };
}

beforeEach(() => { seam.client = null; });

describe('reward_ready queue notify', () => {
  test('one press sends the reward-ready mail to every reward-ready member', async () => {
    const client = makeClient({});
    seam.client = client;
    const confirm = yes();

    const result = await notifyRewardReadyMembers(confirm, 0);

    expect(result).toEqual({ sent: 3, alreadySent: 0, failed: 0, optedOut: 0, total: 3 });
    expect(client.functions.invoke).toHaveBeenCalledTimes(3);
    const bodies = client.functions.invoke.mock.calls.map((c) => (c[1] as { body: Record<string, unknown> }).body);
    // Santos at 301: stage rr-1, normalized contact, the reward_ready kind.
    expect(bodies[0]).toMatchObject({
      contact: 'santos@example.com',
      kind: 'reward_ready',
      campaign_key: 'rr-1',
      subject: 'Your reward credit is available',
      offer: null,
    });
    expect(String(bodies[0].body)).toContain('40% off one catalog item');
    expect(String(bodies[0].body)).not.toMatch(/off (your|the) order/);
    // 640 points is stage rr-2 — a different email_log row from the first stage.
    expect(bodies[1]).toMatchObject({ contact: 'ben@example.com', campaign_key: 'rr-2' });
    // The dialog named the recipients and the subject.
    const message = confirm.mock.calls[0][0];
    expect(message).toContain('"Your reward credit is available"');
    expect(message).toContain('Maria Santos (301 pts)');
    expect(message).toContain('3 members');
  });

  test('marketing opt-outs are excluded, and the dialog says how many and why', async () => {
    const client = makeClient({ optedOut: ['u-osei'] });
    seam.client = client;
    const confirm = yes();

    const result = await notifyRewardReadyMembers(confirm, 0);

    expect(result).toEqual({ sent: 2, alreadySent: 0, failed: 0, optedOut: 1, total: 2 });
    const contacts = client.functions.invoke.mock.calls.map((c) => (c[1] as { body: { contact: string } }).body.contact);
    expect(contacts).toEqual(['santos@example.com', 'ada@example.com']);
    expect(confirm.mock.calls[0][0]).toContain('1 member skipped — opted out of marketing email');
    expect(summarizeRewardNotify(result!)).toBe('2 sent · 1 opted out');
  });

  test('a repeat press reports already sent instead of mailing twice', async () => {
    // email_log's (recipient, kind, period_key) claim: the function answers
    // already_sent for every recipient the first press covered.
    const invoke = vi.fn(async () => ({ data: { ok: false, status: 'already_sent' }, error: null }));
    seam.client = makeClient({ invoke });
    const confirm = yes();

    const result = await notifyRewardReadyMembers(confirm, 0);

    expect(result).toEqual({ sent: 0, alreadySent: 3, failed: 0, optedOut: 0, total: 3 });
    expect(summarizeRewardNotify(result!)).toBe('0 sent · 3 already sent');
  });

  test('cancelling the dialog sends nothing', async () => {
    const client = makeClient({});
    seam.client = client;

    const result = await notifyRewardReadyMembers(no(), 0);

    expect(result).toBeNull();
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  test('a failed send is counted, not thrown, and the batch continues', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: null, error: new Error('Resend 500') })
      .mockResolvedValue({ data: { ok: true, status: 'sent' }, error: null });
    seam.client = makeClient({ invoke });

    const result = await notifyRewardReadyMembers(yes(), 0);

    expect(result).toEqual({ sent: 2, alreadySent: 0, failed: 1, optedOut: 0, total: 3 });
    expect(summarizeRewardNotify(result!)).toBe('2 sent · 1 failed');
  });

  test('dialog message caps the name list', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      userId: `u${i}`, name: `Member ${i}`, contact: `m${i}@example.com`, points: 300 + i,
    }));
    const message = rewardNotifyDialogMessage(many, 0);
    expect(message).toContain('8 members');
    expect(message).toContain('+2 more');
    expect(message).not.toContain('skipped');
  });
});
