// @vitest-environment happy-dom
/**
 * Unit tests for src/pages/admin/AdminMembers.tsx — URL param plumbing.
 *
 * This workstream (WS-2) made /admin/members URL-addressable: view / segment /
 * sort / search all live in useSearchParams instead of local state. Every test
 * here asserts on the RESULTING URL (via a real react-router-dom data router,
 * `createMemoryRouter` + `RouterProvider`) rather than on incidental DOM state,
 * because the URL is the actual contract this workstream shipped.
 *
 * Real `members/ui` atoms (SubNav, RowAction, Chip, Panel, Tile) and the real
 * AdminFilterBar are used UNMOCKED — they are presentation-only and exercising
 * them for real (role="tab", role="option", aria-selected) makes the click
 * assertions meaningful instead of asserting against a hand-rolled stand-in.
 * Only the data hooks (useMembersData/useMemberDetail), AdminLayout (pulls in
 * live admin auth), the heavy sibling sub-views (Redemptions/Invites/
 * Automations — each has its own test file) and accountPanels (writes through
 * shared, separately-tested panels) are mocked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AdminMembers } from '../../../../src/pages/admin/AdminMembers';

// Mock the data-loading hooks
vi.mock('../../../../src/pages/admin/useMembersData', () => ({
  useMembersData: vi.fn(() => ({
    data: {
      members: [
        {
          userId: 'u1', name: 'Alice', contact: 'alice@lab', org: 'Lab A', tier: 'member' as const,
          vip: false, spendCents: 50000, paidOrders: 3, points: 100, rewardReady: false,
          effectivePercent: 12, lastOrderIso: '2026-07-15', segment: 'active' as const, id: 'c1',
          joinedIso: '2026-03-04',
          accountType: 'individual' as const,
        },
      ],
      stats: [
        { label: 'Members', value: '1', meta: ['1 total'], emphasis: false },
      ],
      queue: [
        { kind: 'vip_at_risk', title: 'VIP at Risk', meta: '1 member', tone: 'warn', action: 'View' },
        { kind: 'reward_ready', title: 'Rewards Ready', meta: '1 member', tone: 'good', action: 'Review' },
        { kind: 'invites_stale', title: 'Stale Invites', meta: '1 pending', tone: 'warn', action: 'Send' },
        { kind: 'discount_expiring', title: 'Discount Expiring', meta: '1 soon', tone: 'warn', action: 'Renew' },
      ],
      total: 1,
    },
    loading: false,
    loadingMore: false,
    error: null,
    unmigrated: false,
    hasMore: false,
    loadMore: vi.fn(),
  })),
  useMemberDetail: vi.fn(() => ({ detail: null })),
  MEMBERS_PAGE_SIZE: 50,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  SEGMENT_OPTIONS: [
    { value: 'all', label: 'All members' },
    { value: 'new', label: 'New' },
    { value: 'active', label: 'Active' },
    { value: 'at-risk', label: 'At-Risk' },
    { value: 'dormant', label: 'Dormant' },
    { value: 'vip', label: 'VIP' },
  ],
}));

vi.mock('../../../../src/pages/admin/AdminLayout', () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../src/components/admin/ConfirmModal', () => ({
  useConfirm: () => ({ confirm: vi.fn(), modal: null }),
}));

vi.mock('../../../../src/pages/admin/members/RedemptionsView', () => ({
  RedemptionsView: () => <div>RedemptionsViewMarker</div>,
}));

vi.mock('../../../../src/pages/admin/members/InvitesView', () => ({
  InvitesView: () => <div>InvitesViewMarker</div>,
}));

vi.mock('../../../../src/pages/admin/members/AutomationsView', () => ({
  AutomationsView: () => <div>AutomationsViewMarker</div>,
}));

vi.mock('../../../../src/pages/admin/members/BroadcastView', () => ({
  BroadcastView: () => <div>BroadcastViewMarker</div>,
}));

vi.mock('../../../../src/components/admin/accountPanels', () => ({
  ProfileFlagsPanel: () => null,
  RewardsPanel: () => null,
  DiscountsPanel: () => null,
  useLinkedProfile: () => ({ state: 'none' as const, profile: null, reload: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Renders AdminMembers behind a real data router so tests can read (and
 * navigate) actual browser-shaped history state — router.state.location for
 * the URL, router.state.historyAction for PUSH vs REPLACE, router.navigate(-1)
 * for back(). `actions` records every historyAction the router transitions
 * through after mount, in order.
 */
function renderAdminMembers(initialPath: string) {
  const router = createMemoryRouter(
    [{ path: '/admin/members', element: <AdminMembers /> }],
    { initialEntries: [initialPath] },
  );
  const actions: string[] = [];
  router.subscribe((state) => { actions.push(state.historyAction); });
  render(<RouterProvider router={router} />);
  return { router, actions };
}

/** Current pathname+search from the router — the thing this workstream owns. */
function urlOf(router: ReturnType<typeof createMemoryRouter>): string {
  return router.state.location.pathname + router.state.location.search;
}

/** Opens a dense AdminFilterBar trigger (matched by its exact visible label)
 *  and clicks the named option — the real click path a user takes. */
function pickFilterOption(triggerLabel: string, optionName: string) {
  const trigger = screen.getAllByRole('button').find((b) => b.textContent === triggerLabel);
  if (!trigger) throw new Error(`filter trigger not found: "${triggerLabel}"`);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('AdminMembers — URL param handling', () => {
  describe('READ: URL drives the render, bare URL is exactly defaults', () => {
    test('bare /admin/members renders roster/all/spend/empty-search and rewrites nothing', () => {
      const { router } = renderAdminMembers('/admin/members');
      expect(screen.getByRole('tab', { name: 'Roster' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'All members')).toBe(true);
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'Spend ↓')).toBe(true);
      expect((screen.getByPlaceholderText('Name / email / org') as HTMLInputElement).value).toBe('');
      // Mounting must not itself rewrite the URL.
      expect(urlOf(router)).toBe('/admin/members');
    });

    test('view=invites renders the Invites sub-view and hides roster content', () => {
      renderAdminMembers('/admin/members?view=invites');
      expect(screen.getByRole('tab', { name: 'Invites' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('InvitesViewMarker')).toBeTruthy();
      expect(screen.queryByPlaceholderText('Name / email / org')).toBeNull();
    });

    test('view=redemptions renders the Redemptions sub-view', () => {
      renderAdminMembers('/admin/members?view=redemptions');
      expect(screen.getByRole('tab', { name: 'Redemptions' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('RedemptionsViewMarker')).toBeTruthy();
    });

    test('view=automations renders the Automations sub-view', () => {
      renderAdminMembers('/admin/members?view=automations');
      expect(screen.getByRole('tab', { name: 'Automations' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('AutomationsViewMarker')).toBeTruthy();
    });

    test('view=broadcast renders the Broadcast sub-view', () => {
      renderAdminMembers('/admin/members?view=broadcast');
      expect(screen.getByRole('tab', { name: 'Broadcast' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('BroadcastViewMarker')).toBeTruthy();
    });

    test('the roster row states when the member signed up', () => {
      renderAdminMembers('/admin/members');
      expect(screen.getByText(/Joined Mar 4, 2026/)).toBeTruthy();
    });

    test('segment=vip parses and drives the segment filter trigger', () => {
      renderAdminMembers('/admin/members?segment=vip');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'VIP')).toBe(true);
    });

    test('sort=points parses and drives the sort filter trigger', () => {
      renderAdminMembers('/admin/members?sort=points');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'Points ↓')).toBe(true);
    });

    test('search=alice parses into the search input value', () => {
      renderAdminMembers('/admin/members?search=alice');
      expect((screen.getByPlaceholderText('Name / email / org') as HTMLInputElement).value).toBe('alice');
    });

    test('invalid view param falls back to roster, not a crash', () => {
      renderAdminMembers('/admin/members?view=bogus');
      expect(screen.getByRole('tab', { name: 'Roster' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByText('InvitesViewMarker')).toBeNull();
    });

    test('invalid segment param falls back to "all"', () => {
      renderAdminMembers('/admin/members?segment=not-a-segment');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'All members')).toBe(true);
    });

    test('invalid sort param falls back to "spend"', () => {
      renderAdminMembers('/admin/members?sort=not-a-sort');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'Spend ↓')).toBe(true);
    });
  });

  describe('WRITE: clicking controls updates the URL, defaults are omitted', () => {
    test('clicking the Invites tab pushes view=invites', () => {
      const { router } = renderAdminMembers('/admin/members');
      fireEvent.click(screen.getByRole('tab', { name: 'Invites' }));
      expect(urlOf(router)).toBe('/admin/members?view=invites');
    });

    test('clicking the Redemptions tab pushes view=redemptions', () => {
      const { router } = renderAdminMembers('/admin/members');
      fireEvent.click(screen.getByRole('tab', { name: 'Redemptions' }));
      expect(urlOf(router)).toBe('/admin/members?view=redemptions');
    });

    test('clicking back to the Roster tab strips view (default is omitted)', () => {
      const { router } = renderAdminMembers('/admin/members?view=invites');
      fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
      expect(urlOf(router)).toBe('/admin/members');
    });

    test('picking VIP in the segment filter sets segment=vip', () => {
      const { router } = renderAdminMembers('/admin/members');
      pickFilterOption('All members', 'VIP');
      expect(urlOf(router)).toBe('/admin/members?segment=vip');
    });

    test('picking "All members" from a non-default segment omits it from the URL', () => {
      const { router } = renderAdminMembers('/admin/members?segment=vip');
      pickFilterOption('VIP', 'All members');
      expect(urlOf(router)).toBe('/admin/members');
    });

    test('picking Points in the sort filter sets sort=points', () => {
      const { router } = renderAdminMembers('/admin/members');
      pickFilterOption('Spend ↓', 'Points ↓');
      expect(urlOf(router)).toBe('/admin/members?sort=points');
    });

    test('typing in search sets the search param via REPLACE (no push)', () => {
      const { router } = renderAdminMembers('/admin/members');
      const input = screen.getByPlaceholderText('Name / email / org');
      fireEvent.change(input, { target: { value: 'al' } });
      expect(urlOf(router)).toBe('/admin/members?search=al');
      expect(router.state.historyAction).toBe('REPLACE');
    });
  });

  describe('REGRESSION: stale-closure bug on queue deep-links', () => {
    // The queue ("Needs attention") only renders under the roster tab, so the
    // literal repro URL can't carry a non-roster `view` value and still expose
    // the button to click. To keep `view` PRESENT in the URL (so stripping it
    // is actually observable) while still rendering roster, these start from
    // an explicit `view=roster` — a real, parseable, non-bare URL — with a
    // non-default segment/sort alongside it, so an untouched param surviving
    // the update is also provable.

    test('vip_at_risk deep-link atomically strips view and sets segment=vip, leaving sort untouched', () => {
      const { router } = renderAdminMembers('/admin/members?view=roster&segment=at-risk&sort=recent');
      fireEvent.click(screen.getByRole('button', { name: /View/ }));
      const url = urlOf(router);
      expect(url).not.toMatch(/[?&]view=/);
      expect(url).toContain('segment=vip');
      expect(url).toContain('sort=recent');
    });

    // 092: this link used to set sort=points ALONE, which re-ordered the roster
    // without narrowing it — the list still held every member, so the owner
    // read the button as dead. It now also selects the reward-ready segment.
    // `search` carries the untouched-param half of the regression proof that
    // `segment` used to carry.
    test('reward_ready deep-link atomically strips view, selects the reward-ready segment and sorts by points, leaving search untouched', () => {
      const { router } = renderAdminMembers('/admin/members?view=roster&segment=at-risk&sort=recent&search=al');
      fireEvent.click(screen.getByRole('button', { name: /Review/ }));
      const url = urlOf(router);
      expect(url).not.toMatch(/[?&]view=/);
      expect(url).toContain('segment=reward-ready');
      expect(url).toContain('sort=points');
      expect(url).toContain('search=al');
    });

    test('invites_stale deep-link sets view=invites', () => {
      const { router } = renderAdminMembers('/admin/members');
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));
      expect(urlOf(router)).toBe('/admin/members?view=invites');
    });

    test('discount_expiring queue item has no clickable deep-link (no honest target surface)', () => {
      renderAdminMembers('/admin/members');
      expect(screen.queryByRole('button', { name: /Renew/ })).toBeNull();
      expect(screen.getByText(/Renew in roster rows/)).toBeTruthy();
    });
  });

  describe('Search history behavior', () => {
    test('typing several characters does not add history entries — one back() clears it all', async () => {
      const { router } = renderAdminMembers('/admin/members');

      // Discrete control change — pushes one entry.
      pickFilterOption('All members', 'VIP');
      expect(urlOf(router)).toBe('/admin/members?segment=vip');

      // Several keystrokes after that — each REPLACEs, none PUSH.
      const input = screen.getByPlaceholderText('Name / email / org');
      fireEvent.change(input, { target: { value: 'p' } });
      fireEvent.change(input, { target: { value: 'pe' } });
      fireEvent.change(input, { target: { value: 'pep' } });
      expect(urlOf(router)).toBe('/admin/members?segment=vip&search=pep');

      // A single back() must clear the whole typing run AND the segment push —
      // i.e. typing created no extra entries to step through.
      await act(async () => { await router.navigate(-1); });
      expect(urlOf(router)).toBe('/admin/members');
    });

    test('a discrete control change pushes exactly one history entry', () => {
      const { router } = renderAdminMembers('/admin/members');
      pickFilterOption('All members', 'VIP');
      expect(router.state.historyAction).toBe('PUSH');
      expect(urlOf(router)).toBe('/admin/members?segment=vip');
    });
  });

  describe('expandedId is ephemeral (useState, not URL)', () => {
    test('expanding a roster row does not touch the URL', () => {
      const { router } = renderAdminMembers('/admin/members');
      const before = urlOf(router);
      expect(screen.queryByText('Activity timeline')).toBeNull();

      fireEvent.click(screen.getByText('Alice'));
      expect(screen.getByText('Activity timeline')).toBeTruthy();
      expect(urlOf(router)).toBe(before);
    });
  });

  describe('multiple params together', () => {
    test('loads view/segment/sort/search together from one URL', () => {
      renderAdminMembers('/admin/members?view=roster&segment=vip&sort=points&search=test');
      expect(screen.getByRole('tab', { name: 'Roster' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'VIP')).toBe(true);
      expect(screen.getAllByRole('button').some((b) => b.textContent === 'Points ↓')).toBe(true);
      expect((screen.getByPlaceholderText('Name / email / org') as HTMLInputElement).value).toBe('test');
    });
  });
});
