/**
 * AdminMembers — the Members control center.
 *
 * A specialized LENS over the existing customer ecosystem, not a second
 * customer system: every figure comes from the server surface (admin_member_*
 * RPCs, migrations 070–076) computed over the existing customer_profiles, CRM
 * customers, orders, reward_ledger, reward_vouchers, customer_discounts and
 * member_invites records. The Customers section remains the source of truth;
 * every row links back to the full customer profile.
 *
 * Four sub-views share one shell: Roster (the approved cockpit — KPI strip,
 * needs-attention queue, segmented expandable rows with the SAME shared
 * writable panels the customer-detail page uses), Redemptions (voucher
 * oversight + void), and Invites (funnel + bulk invite). The roster layout is
 * unchanged from its approved form; the sub-views are added siblings.
 *
 * Filtering, sorting, searching and pagination are server-side (useMembersData).
 * No write logic is duplicated — member mutations flow through the shared
 * accountPanels; voucher/invite writes through their audited RPCs.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { useConfirm } from '../../components/admin/ConfirmModal';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import {
  ProfileFlagsPanel, RewardsPanel, DiscountsPanel, useLinkedProfile,
} from '../../components/admin/accountPanels';
import type { MemberDetail, MemberRow, Segment, Tier } from './membersView';
import {
  MEMBERS_PAGE_SIZE, SEGMENT_OPTIONS, money, useMemberDetail, useMembersData,
  type RosterSegment, type RosterSort,
} from './useMembersData';
import { Chip, Panel, RowAction, SubNav, Tile, type SubNavItem } from './members/ui';
import { shortDate } from './members/format';
import { PreparedCartPanel } from './members/PreparedCartPanel';
import { RedemptionsView } from './members/RedemptionsView';
import { InvitesView } from './members/InvitesView';
import { AutomationsView } from './members/AutomationsView';
import { BroadcastView } from './members/BroadcastView';

/* ── Filters ──────────────────────────────────────────────────────────────── */

const SORT_OPTIONS: Array<{ value: RosterSort; label: string }> = [
  { value: 'recent', label: 'Last order' },
  { value: 'spend', label: 'Spend ↓' },
  { value: 'points', label: 'Points ↓' },
  { value: 'joined', label: 'Newest ↓' },
];

type MembersSubView = 'roster' | 'redemptions' | 'invites' | 'automations' | 'broadcast';
const VIEW_TABS: SubNavItem<MembersSubView>[] = [
  { value: 'roster', label: 'Roster' },
  { value: 'redemptions', label: 'Redemptions' },
  { value: 'invites', label: 'Invites' },
  { value: 'automations', label: 'Automations' },
  { value: 'broadcast', label: 'Broadcast' },
];

/* ── Validators (hoisted to module scope) ────────────────────────────────── */

function isValidView(v: string): v is MembersSubView {
  return ['roster', 'redemptions', 'invites', 'automations', 'broadcast'].includes(v);
}

function isValidSegment(s: string): s is RosterSegment {
  return ['all', 'new', 'active', 'at-risk', 'dormant', 'vip'].includes(s);
}

function isValidSort(s: string): s is RosterSort {
  return ['recent', 'spend', 'points', 'joined'].includes(s);
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function AdminMembers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Parse and validate URL params, reading raw strings and validating before narrowing
  const rawView = searchParams.get('view') ?? 'roster';
  const view = isValidView(rawView) ? rawView : 'roster';

  const rawSegment = searchParams.get('segment') ?? 'all';
  const segment = isValidSegment(rawSegment) ? rawSegment : 'all';

  const rawSort = searchParams.get('sort') ?? 'spend';
  const sort = isValidSort(rawSort) ? rawSort : 'spend';

  const search = searchParams.get('search') ?? '';

  const { data, loading, loadingMore, error, unmigrated, hasMore, loadMore } =
    useMembersData({ segment, sort, search });

  const rows = useMemo(() => data?.members ?? [], [data]);
  const expandedRow = useMemo(
    () => rows.find((r) => r.userId === expandedId) ?? null,
    [rows, expandedId],
  );
  const { detail } = useMemberDetail(expandedRow);

  // Helper to update URL params while preserving others (uses functional updater to avoid stale closure)
  function updateParams(updates: Partial<Record<'view' | 'segment' | 'sort' | 'search', string | null>>, options?: { replace?: boolean }) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      return next;
    }, options);
  }

  function setViewFn(v: MembersSubView) {
    updateParams({ view: v === 'roster' ? null : v });
  }

  function setSegmentFn(s: RosterSegment) {
    updateParams({ segment: s === 'all' ? null : s });
  }

  function setSortFn(s: RosterSort) {
    updateParams({ sort: s === 'spend' ? null : s });
  }

  function setSearchFn(q: string) {
    // Search-as-you-type uses replace to avoid history pollution
    updateParams({ search: q || null }, { replace: true });
  }

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="flex items-baseline gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Members</h2>
          {view === 'roster' && data && (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">
              {data.total} {data.total === 1 ? 'member' : 'members'}
            </p>
          )}
        </div>
        <SubNav items={VIEW_TABS} value={view} onChange={setViewFn} />
      </header>

      {view === 'redemptions' && <RedemptionsView />}
      {view === 'invites' && <InvitesView />}
      {view === 'automations' && <AutomationsView />}
      {view === 'broadcast' && <BroadcastView />}

      {view === 'roster' && (
        <>
          {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

          {unmigrated && (
            <div className="research-surface-solid p-[var(--space-6)]">
              <p className="text-[13px] text-ink/55">
                Membership data layer not migrated yet — apply migrations 070–072 to enable this page.
                Until then, member management lives on each customer's profile under Customers.
              </p>
            </div>
          )}

          {!unmigrated && loading && (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
          )}

          {!unmigrated && !loading && data && (
            <>
              {/* KPI strip — the dashboard Tile, reused */}
              <div className="mb-[var(--space-5)] grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3 lg:grid-cols-6">
                {data.stats.map((s) => (
                  <Tile key={s.label} label={s.label} value={s.value} meta={s.meta} emphasis={s.emphasis} />
                ))}
              </div>

              {/* Needs attention */}
              <section className="mb-[var(--space-5)]">
                <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em]">Needs attention</p>
                <ul className="research-surface-solid divide-y divide-ink/[0.05]">
                  {data.queue.map((q) => (
                    <li key={q.title} className="flex items-center gap-[var(--space-3)] px-[var(--space-5)] py-[var(--space-3)]">
                      <Chip tone={q.tone}>{q.tone === 'good' ? 'ready' : 'attention'}</Chip>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{q.title}</span>
                        <span className="block truncate font-mono text-[10.5px] text-ink/45">{q.meta}</span>
                      </span>
                      {/* Blueprint: queue items deep-link into the filtered
                          roster or relevant sub-view. discount_expiring has no
                          honest target surface yet → plain text, no fake
                          affordance (release audit: these were disabled
                          buttons styled like live ones). Uses functional updater
                          to avoid stale-closure bugs when setting multiple params. */}
                      {q.kind === 'vip_at_risk' ? (
                        <RowAction onClick={() => updateParams({ view: null, segment: 'vip' })}>
                          {q.action} →
                        </RowAction>
                      ) : q.kind === 'reward_ready' ? (
                        // Was sort-by-points only: the list still held every
                        // member, so pressing it read as a dead button. 092
                        // gives the roster a reward-ready filter, so this now
                        // narrows the list to exactly the members it counts.
                        <RowAction onClick={() => updateParams({ view: null, segment: 'reward-ready', sort: 'points' })}>
                          {q.action} →
                        </RowAction>
                      ) : q.kind === 'invites_stale' ? (
                        <RowAction onClick={() => updateParams({ view: 'invites' })}>
                          {q.action} →
                        </RowAction>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">{q.action} in roster rows</span>
                      )}
                    </li>
                  ))}
                  {data.queue.length === 0 && (
                    <li className="px-[var(--space-5)] py-[var(--space-6)] text-center text-[12px] text-ink/40">
                      Nothing needs attention.
                    </li>
                  )}
                </ul>
              </section>

              {/* Segment filters — AdminFilterBar, reused (mirrors AdminCustomers) */}
              <div className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
                <AdminFilterBar label="" dense options={SEGMENT_OPTIONS} value={segment} onChange={setSegmentFn} />
                <AdminFilterBar label="" dense options={SORT_OPTIONS} value={sort} onChange={setSortFn} />
                <input
                  type="search"
                  placeholder="Name / email / org"
                  value={search}
                  onChange={(e) => setSearchFn(e.target.value)}
                  className="min-h-[40px] min-w-0 flex-1 rounded-full border border-ink/10 bg-base-700 px-[var(--space-3)] py-[5px] text-[12px] text-ink placeholder-ink/30 transition-colors focus:border-ink/30 focus:outline-none"
                />
              </div>

              {/* Roster */}
              <ul className="research-surface-solid divide-y divide-ink/[0.04]">
                {rows.map((m) => {
                  const open = expandedId === m.userId;
                  return (
                    <li key={m.userId}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : m.userId)}
                        aria-expanded={open}
                        className="flex w-full items-center gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-4)] text-left transition-colors hover:bg-ink/[0.015]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
                            <span className="truncate">{m.name}</span>
                            <TierChip tier={m.tier} />
                            {m.vip && <span className={`${CHIP_BASE} border-holo/35 text-holo bg-holo/[0.07]`}>vip</span>}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-ink/55">
                            {m.contact}{m.org && <span className="text-ink/35"> · {m.org}</span>}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-right sm:block">
                          <span className="block font-mono text-[11.5px] tabular-nums text-ink/80">
                            {money(m.spendCents)} · {m.paidOrders} paid
                          </span>
                          <span className="block font-mono text-[10px] tabular-nums">
                            <span className={m.rewardReady ? 'text-holo' : 'text-ink/45'}>
                              {m.points.toLocaleString()} pts{m.rewardReady ? ' · ready' : ''}
                            </span>
                            <span className="text-ink/35"> · {m.effectivePercent}% · {ageLabel(m.lastOrderIso)}</span>
                          </span>
                          <span className="block font-mono text-[10px] tabular-nums text-ink/35">
                            Joined {shortDate(m.joinedIso)}
                          </span>
                        </span>
                        <span className="shrink-0">
                          <SegmentChip segment={m.segment} />
                        </span>
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                          className={`shrink-0 text-ink/30 transition-transform ${open ? 'rotate-90' : ''}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>

                      {open && <MemberExpand member={m} detail={detail} />}
                    </li>
                  );
                })}

                {rows.length === 0 && (
                  <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
                    No members match.
                  </li>
                )}

                {/* Server-side pagination */}
                {rows.length > 0 && (
                  <li className="flex items-center justify-between gap-[var(--space-3)] px-[var(--space-5)] py-[var(--space-3)]">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/35">
                      Showing {rows.length} of {data.total}
                    </span>
                    {hasMore && (
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="rounded-full border border-ink/15 px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40"
                      >
                        {loadingMore ? 'Loading…' : `Load ${MEMBERS_PAGE_SIZE} more`}
                      </button>
                    )}
                  </li>
                )}
              </ul>
            </>
          )}
        </>
      )}
    </AdminLayout>
  );
}

/* ── Expanded row ──────────────────────────────────────────────────────────── */

function MemberExpand({ member: m, detail }: { member: MemberRow; detail: MemberDetail | null }) {
  const { confirm, modal } = useConfirm();
  const { state, profile, reload } = useLinkedProfile({ by: 'user_id', value: m.userId });

  return (
    <div className="border-t border-ink/[0.04] bg-ink/[0.012] px-[var(--space-5)] pb-[var(--space-5)] pt-[var(--space-4)]">
      {/* on phones the right-side stats are hidden in the row — surface them here */}
      <div className="mb-[var(--space-4)] flex flex-wrap gap-x-[var(--space-5)] gap-y-1 font-mono text-[11px] tabular-nums text-ink/60 sm:hidden">
        <span>{money(m.spendCents)} · {m.paidOrders} paid</span>
        <span className={m.rewardReady ? 'text-holo' : ''}>{m.points.toLocaleString()} pts</span>
        <span>{m.effectivePercent}% · {ageLabel(m.lastOrderIso)}</span>
      </div>

      <div className="mb-[var(--space-4)] font-mono text-[11px] text-ink/50">
        Member since {shortDate(m.joinedIso)}
        <span className="text-ink/30"> · last order {m.lastOrderIso ? shortDate(m.lastOrderIso) : 'none'}</span>
      </div>

      {/* The SAME shared panels the customer-detail page renders, in the
          approved 3-up grid. One write path, no duplicated logic. */}
      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
        {state === 'ready' && profile ? (
          <ProfileFlagsPanel profile={profile} contact={m.contact} confirm={confirm} onSaved={reload} />
        ) : (
          <Panel caption="Profile flags">
            <p className="text-[12px] text-ink/40">
              {state === 'loading' ? 'Loading…'
                : state === 'none' ? 'No portal account linked.'
                : state === 'unmigrated' ? 'Portal backend not migrated yet.'
                : 'Could not load profile.'}
            </p>
          </Panel>
        )}
        <RewardsPanel userId={m.userId} confirm={confirm} />
        <DiscountsPanel userId={m.userId} accountType={profile?.account_type ?? m.accountType} tier={profile?.tier ?? m.tier} confirm={confirm} />
      </div>

      <div className="mt-[var(--space-4)] grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimelineView detail={detail} />
        </div>
        <div className="flex flex-wrap items-end justify-start gap-[var(--space-3)] lg:justify-end">
          {m.id ? (
            <Link
              to={`/admin/customers/${m.id}`}
              className="text-[10px] uppercase tracking-[0.22em] text-ink/55 transition-colors hover:text-ink"
            >
              Open full customer profile →
            </Link>
          ) : (
            <span title="No CRM record linked to this portal account yet"
                  className="text-[10px] uppercase tracking-[0.22em] text-ink/25">
              No linked CRM record
            </span>
          )}
        </div>
      </div>

      {/* Always rendered. It used to sit behind a "Build cart" toggle, which
          made the carts already sent to this member reachable only by opening a
          form headed "build a new one" — the owner's complaint. The panel now
          leads with the carts and keeps building behind its own action. */}
      <div className="mt-[var(--space-4)]">
        <PreparedCartPanel member={m} confirm={confirm} />
      </div>

      {modal}
    </div>
  );
}

function TimelineView({ detail }: { detail: MemberDetail | null }) {
  return (
    <Panel caption="Activity timeline">
      {detail === null ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : detail.timeline.length === 0 ? (
        <p className="text-[12px] text-ink/40">No recorded activity yet.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.04]">
          {detail.timeline.map((t, i) => (
            <li key={i} className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
              <span className="min-w-0 text-[12px] text-ink/70">{t.label}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink/35">{shortDate(t.iso)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Roster-specific atoms (generic Tile/Chip/Panel/shortDate live in members/ui) ── */

function TierChip({ tier }: { tier: Tier }) {
  return tier === 'pro'
    ? <span className={`${CHIP_BASE} border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]`}>pro</span>
    : <span className={`${CHIP_BASE} border-holo/35 text-holo bg-holo/[0.07]`}>member</span>;
}

const SEGMENT_LABEL: Record<Segment, string> = { new: 'new', active: 'active', 'at-risk': 'at-risk', dormant: 'dormant' };

function SegmentChip({ segment }: { segment: Segment }) {
  const cls =
    segment === 'active' ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    segment === 'at-risk' ? 'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]' :
    segment === 'new' ? 'border-ink/10 text-[color:var(--color-status-info)] bg-[color:var(--color-status-infoMuted)]' :
                        'border-ink/15 text-ink/55 bg-ink/[0.03]';
  return <span className={`${CHIP_BASE} ${cls}`}>{SEGMENT_LABEL[segment] ?? segment}</span>;
}

function ageLabel(iso: string | null): string {
  if (!iso) return 'no orders';
  const ms = Date.now() - new Date(`${iso}T00:00:00`).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return 'today';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
