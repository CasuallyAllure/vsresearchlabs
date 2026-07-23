/**
 * AdminMembers — the Members control center.
 *
 * A specialized LENS over the existing customer ecosystem, not a second
 * customer system: every figure comes from the Phase 0 server surface
 * (admin_member_stats / admin_member_attention / admin_member_roster,
 * migrations 070–072) computed over the existing customer_profiles, CRM
 * customers, orders, reward_ledger, reward_vouchers, customer_discounts and
 * member_invites records. The Customers section remains the source of truth;
 * every row links back to the full customer profile.
 *
 * Layout is LOCKED (approved 2026-07-23): KPI strip → Needs-attention queue →
 * segment filters → expandable roster rows → full-profile link. This file
 * renders the `MembersViewData` contract and nothing else; the data source is
 * swappable without touching the layout.
 *
 * Filtering, sorting, searching and pagination are server-side (see
 * useMembersData) — the list is not capped by a client-side fetch.
 *
 * Inline editing of the management panels is deliberately deferred: the write
 * RPCs live in CustomerAccountPanels on the customer detail page (one place,
 * already audited + confirm-guarded). Extracting those three panels into
 * shared writable components is the remaining Phase 1 step; until then the
 * inline panels are read-only mirrors and "Open full customer profile" is the
 * edit path. No write logic is duplicated here.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import { FIELD_SURFACE, FIELD_DEFAULT } from '../../components/ui/Field';
import type { MemberDetail, MemberRow, Segment, Tier } from './membersView';
import {
  MEMBERS_PAGE_SIZE, money, useMemberDetail, useMembersData,
  type RosterSegment, type RosterSort,
} from './useMembersData';

/* ── Filters ──────────────────────────────────────────────────────────────── */

const SEGMENT_OPTIONS: Array<{ value: RosterSegment; label: string }> = [
  { value: 'all', label: 'All members' },
  { value: 'new', label: 'New' },
  { value: 'active', label: 'Active' },
  { value: 'at-risk', label: 'At-Risk' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'vip', label: 'VIP' },
];

const SORT_OPTIONS: Array<{ value: RosterSort; label: string }> = [
  { value: 'recent', label: 'Last order' },
  { value: 'spend', label: 'Spend ↓' },
  { value: 'points', label: 'Points ↓' },
  { value: 'joined', label: 'Newest ↓' },
];

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function AdminMembers() {
  const [segment, setSegment] = useState<RosterSegment>('all');
  const [sort, setSort] = useState<RosterSort>('spend');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, loading, loadingMore, error, unmigrated, hasMore, loadMore } =
    useMembersData({ segment, sort, search: query });

  const rows = useMemo(() => data?.members ?? [], [data]);
  const expandedRow = useMemo(
    () => rows.find((r) => r.userId === expandedId) ?? null,
    [rows, expandedId],
  );
  const { detail } = useMemberDetail(expandedRow);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Members</h2>
          {data && (
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">
              {data.total} {data.total === 1 ? 'member' : 'members'}
            </p>
          )}
        </div>
      </header>

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
                  <GhostAction>{q.action} →</GhostAction>
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
            <AdminFilterBar label="" dense options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
            <AdminFilterBar label="" dense options={SORT_OPTIONS} value={sort} onChange={setSort} />
            <input
              type="search"
              placeholder="Name / email / org"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
    </AdminLayout>
  );
}

/* ── Expanded row ──────────────────────────────────────────────────────────── */

function MemberExpand({ member: m, detail }: { member: MemberRow; detail: MemberDetail | null }) {
  return (
    <div className="border-t border-ink/[0.04] bg-ink/[0.012] px-[var(--space-5)] pb-[var(--space-5)] pt-[var(--space-4)]">
      {/* on phones the right-side stats are hidden in the row — surface them here */}
      <div className="mb-[var(--space-4)] flex flex-wrap gap-x-[var(--space-5)] gap-y-1 font-mono text-[11px] tabular-nums text-ink/60 sm:hidden">
        <span>{money(m.spendCents)} · {m.paidOrders} paid</span>
        <span className={m.rewardReady ? 'text-holo' : ''}>{m.points.toLocaleString()} pts</span>
        <span>{m.effectivePercent}% · {ageLabel(m.lastOrderIso)}</span>
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
        <ProfileFlagsView m={m} />
        <RewardsView m={m} detail={detail} />
        <DiscountsView m={m} detail={detail} />
      </div>

      <div className="mt-[var(--space-4)] grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimelineView detail={detail} />
        </div>
        <div className="flex items-end justify-start lg:justify-end">
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

      <p className="mt-[var(--space-4)] text-[10.5px] text-ink/35">
        Read-only here — editing profile flags, points and discounts lives on the full customer profile,
        where the audited write path already runs.
      </p>
    </div>
  );
}

const inputCls = [FIELD_SURFACE, FIELD_DEFAULT, 'mb-[var(--space-3)] disabled:opacity-50 disabled:cursor-not-allowed'].join(' ');

function ProfileFlagsView({ m }: { m: MemberRow }) {
  return (
    <Panel caption="Profile flags">
      <div className="mb-[var(--space-4)]">
        <p className="text-[13px] text-ink">{m.name}</p>
        <p className="font-mono text-[11px] text-ink/55">{m.contact}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={m.tier === 'pro' ? 'good' : 'neutral'}>{m.tier}</Chip>
          <Chip tone={m.status === 'active' ? 'good' : m.status === 'suspended' ? 'warn' : 'neutral'}>{m.status}</Chip>
          <Chip tone="neutral">{m.accountType}</Chip>
          {m.businessName && <Chip tone="neutral">{m.businessName}</Chip>}
          {m.freeShipping && <Chip tone="good">free shipping</Chip>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-[var(--space-3)] sm:grid-cols-3">
        <div>
          <FieldLabel>Tier</FieldLabel>
          <select value={m.tier} disabled className={inputCls} onChange={() => {}}>
            <option value="member">Member</option>
            <option value="pro">Pro</option>
          </select>
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <select value={m.status} disabled className={inputCls} onChange={() => {}}>
            <option value="active">Active</option>
            <option value="waitlisted">Waitlisted</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <FieldLabel>Account type</FieldLabel>
          <select value={m.accountType} disabled className={inputCls} onChange={() => {}}>
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        </div>
      </div>
      <label className="mb-[var(--space-3)] flex items-center gap-2 text-[12px] text-ink/75">
        <input type="checkbox" checked={m.freeShipping} disabled readOnly />
        Free shipping (lifetime)
      </label>
      <p className="font-mono text-[10px] tabular-nums text-ink/35">Joined {shortDate(m.joinedIso)}</p>
    </Panel>
  );
}

function RewardsView({ m, detail }: { m: MemberRow; detail: MemberDetail | null }) {
  return (
    <Panel caption="Rewards">
      <div className="mb-[var(--space-4)]">
        <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-ink/40">Balance</p>
        <p className="font-mono text-[18px] tabular-nums text-ink">
          {m.points.toLocaleString()} pts
          {m.rewardReady && <span className="ml-2 align-middle text-[10px] uppercase tracking-[0.16em] text-holo">credit ready</span>}
        </p>
      </div>
      {detail === null ? (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      ) : detail.recentRewards.length === 0 ? (
        <p className="text-[12px] text-ink/40">No reward activity yet.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.04] border-y border-ink/[0.06]">
          {detail.recentRewards.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-0.5 py-[var(--space-2)]">
              <span className={`w-[52px] shrink-0 font-mono text-[12px] tabular-nums ${e.points > 0 ? 'text-[color:var(--color-status-success)]' : 'text-red-400/80'}`}>
                {e.points > 0 ? `+${e.points}` : `−${Math.abs(e.points)}`}
              </span>
              <span className="w-[80px] shrink-0 text-[10px] uppercase tracking-[0.16em] text-ink/45">{e.kind}</span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink/40">{shortDate(e.iso)}</span>
              {e.note && <span className="min-w-0 flex-1 text-[11.5px] text-ink/60">{e.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DiscountsView({ m, detail }: { m: MemberRow; detail: MemberDetail | null }) {
  const hasCustom = m.discountLabel !== null;
  const expires = detail?.discountExpiresIso ?? m.discountExpiresIso;
  return (
    <Panel caption="Account discounts">
      <div className="mb-[var(--space-3)]">
        <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-ink/40">Effective rate</p>
        <p className="font-mono text-[18px] tabular-nums text-ink">
          {m.effectivePercent}%
          <span className="ml-2 align-middle text-[10px] uppercase tracking-[0.16em] text-ink/40">
            {hasCustom ? m.discountScope : m.tier === 'pro' ? 'pro floor' : 'member floor'}
          </span>
        </p>
      </div>
      {hasCustom ? (
        <ul className="divide-y divide-ink/[0.04] border-y border-ink/[0.06]">
          <li className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-1 py-[var(--space-3)]">
            <span className="w-[64px] shrink-0 font-mono text-[13px] tabular-nums text-ink">{m.effectivePercent}%</span>
            <Chip tone="good">active</Chip>
            <Chip tone="neutral">{m.discountScope}</Chip>
            <span className="min-w-0 flex-1 text-[12px] text-ink/70">{m.discountLabel}</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink/40">
              {expires ? `to ${shortDate(expires)}` : 'no expiry'}
            </span>
          </li>
        </ul>
      ) : (
        <p className="text-[12px] text-ink/40">
          No custom rule — on the automatic {m.effectivePercent}% {m.tier === 'pro' ? 'Pro' : 'member'} floor.
        </p>
      )}
    </Panel>
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

/* ── House-style atoms (same classes as AdminStatModules / CustomerAccountPanels) ── */

function Tile({ label, value, meta, emphasis }: { label: string; value: string; meta: string[]; emphasis?: boolean }) {
  return (
    <div className="research-surface-solid px-[var(--space-4)] py-[var(--space-4)]">
      <span className="mb-[var(--space-2)] block holo-text-caption text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <span className={
        emphasis
          ? 'holo-text-display block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums'
          : 'block text-[clamp(1.4rem,2.6vw,1.8rem)] font-light leading-none tabular-nums text-ink'
      }>
        {value}
      </span>
      <span className="mt-[var(--space-2)] block space-y-0.5">
        {meta.map((x, i) => (
          <span key={i} className="block truncate font-mono text-[10px] tabular-nums text-ink/45">{x}</span>
        ))}
      </span>
    </div>
  );
}

function Panel({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="research-surface-solid p-[var(--space-5)]">
      <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">{caption}</p>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-[var(--space-2)] block text-[11px] uppercase tracking-[0.22em] text-ink/50">{children}</label>;
}

function Chip({ tone, children }: { tone: 'neutral' | 'warn' | 'good'; children: React.ReactNode }) {
  const cls =
    tone === 'good' ? 'border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]' :
    tone === 'warn' ? 'border-ink/10 text-[color:var(--color-status-warning)] bg-[color:var(--color-status-warningMuted)]' :
                      'border-ink/15 text-ink/60 bg-ink/[0.03]';
  return <span className={`${CHIP_BASE} ${cls}`}>{children}</span>;
}

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

function GhostAction({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className="shrink-0 rounded-full border border-ink/15 px-[var(--space-4)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] text-ink/70 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/* ── helpers (presentation only) ──────────────────────────────────────────── */

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
