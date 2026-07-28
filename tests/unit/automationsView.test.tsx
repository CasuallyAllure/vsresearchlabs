// @vitest-environment happy-dom
/**
 * Members → Automations sub-view (Train 2). The supabase seam is mocked (a
 * unit test never touches the live client); each test drives one path: the
 * five-kind list with per-kind sent counts, the toggle flow behind the
 * ConfirmModal (RPC only after an explicit confirm — never a native dialog),
 * recipient masking in the email_log trail, and the "backend not migrated"
 * degradation. The real RPC behaviour (audited toggle, admin gate, unique
 * email_log claim, marketing_opt_out writability) is proven against real
 * Postgres in tests/integration/memberAutomations.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return seam.client; },
}));

import { AutomationsView } from '../../src/pages/admin/members/AutomationsView';
import { maskRecipient } from '../../src/pages/admin/members/useAutomations';

afterEach(cleanup);
beforeEach(() => { seam.client = null; });

type RpcHandler = (args: unknown) => { data: unknown; error: unknown };
type QueryResult = { data: unknown; error: unknown };

function makeClient(handlers: Record<string, RpcHandler>, settings: QueryResult) {
  const rpc = vi.fn(async (name: string, args: unknown) =>
    handlers[name] ? handlers[name](args) : { data: null, error: null });
  const from = vi.fn((_table: string) => ({ select: vi.fn(async () => settings) }));
  return { rpc, from };
}

const SETTINGS_ALL_OFF: QueryResult = {
  data: [
    { kind: 'reward_ready', enabled: false },
    { kind: 'invite_followup', enabled: false },
    { kind: 'winback', enabled: false },
    { kind: 'discount_expiry', enabled: false },
    { kind: 'welcome', enabled: false },
  ],
  error: null,
};

const EMAIL_LOG = {
  rows: [
    { id: 'e1', userId: 'u1', recipient: 'ada@example.com', kind: 'welcome',
      periodKey: 'wc-once', sentIso: '2026-07-25' },
  ],
  total: 1,
  summary: { welcome: 1 },
};

describe('AutomationsView', () => {
  test('lists all five kinds disabled, with per-kind sent counts', async () => {
    seam.client = makeClient({ admin_email_log: () => ({ data: EMAIL_LOG, error: null }) }, SETTINGS_ALL_OFF);
    render(<AutomationsView />);

    // Every kind ships dark: five Enable actions, zero Disable.
    expect(await screen.findAllByRole('button', { name: 'Enable' })).toHaveLength(5);
    // Kind names render twice (summary tile + list row).
    expect(screen.getAllByText('Invite follow-up')).toHaveLength(2);
    expect(screen.getAllByText('Winback')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    // The email_log trail is masked on screen — never the raw address.
    expect(screen.getByText('a***@example.com')).toBeTruthy();
    expect(screen.queryByText('ada@example.com')).toBeNull();
  });

  test('toggle calls admin_set_automation_kind only AFTER the ConfirmModal confirm', async () => {
    const toggleRpc = vi.fn(() => ({ data: { kind: 'reward_ready', enabled: true }, error: null }));
    seam.client = makeClient({
      admin_email_log: () => ({ data: EMAIL_LOG, error: null }),
      admin_set_automation_kind: toggleRpc,
    }, SETTINGS_ALL_OFF);
    render(<AutomationsView />);

    // First row = reward_ready (fixed display order).
    fireEvent.click((await screen.findAllByRole('button', { name: 'Enable' }))[0]);

    // The in-app ConfirmModal is up; nothing has fired yet.
    const dialog = await screen.findByRole('dialog');
    expect(toggleRpc).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(toggleRpc).toHaveBeenCalledTimes(1));
    expect(toggleRpc).toHaveBeenCalledWith({ p_kind: 'reward_ready', p_enabled: true });
  });

  test('cancelling the ConfirmModal never fires the RPC', async () => {
    const toggleRpc = vi.fn(() => ({ data: null, error: null }));
    seam.client = makeClient({
      admin_email_log: () => ({ data: EMAIL_LOG, error: null }),
      admin_set_automation_kind: toggleRpc,
    }, SETTINGS_ALL_OFF);
    render(<AutomationsView />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Enable' }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggleRpc).not.toHaveBeenCalled();
  });

  test('missing migration 075 degrades to a calm note, not a crash', async () => {
    seam.client = makeClient({}, { data: null, error: { code: '42P01', message: 'relation does not exist' } });
    render(<AutomationsView />);

    expect(await screen.findByText(/apply migration 075/i)).toBeTruthy();
  });
});

describe('maskRecipient', () => {
  test.each([
    ['ada@example.com', 'a***@example.com'],
    ['b@x.io', 'b***@x.io'],
    ['no-at-sign', 'n***'],
    ['', '***'],
  ])('%s → %s', (input, expected) => {
    expect(maskRecipient(input)).toBe(expected);
  });
});
