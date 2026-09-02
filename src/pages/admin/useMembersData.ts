/**
 * useMembersData — the live data source behind the Members control center.
 *
 * Fills the `MembersViewData` contract from the Phase 0 server surface:
 *   admin_member_stats()      → the KPI strip
 *   admin_member_attention()  → the Needs-attention queue
 *   admin_member_roster(...)  → the roster (server-side filter/sort/search/page)
 *
 * Every figure is computed in Postgres over the EXISTING customer, order,
 * reward, discount and invite records — this hook formats, it never estimates.
 * Filtering, sorting, searching and pagination are all server-side params, so
 * the list scales past the old 500-row client cap.
 *
 * Migrations 070–072 may not be applied yet: any "missing relation/function"
 * failure resolves to `unmigrated` so the page renders a calm note instead of
 * crashing — the same posture CustomerAccountPanels takes for 043–045.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  MemberDetail, MemberQueueItem, MemberRow, MemberStat, MembersViewData,
} from './membersView';

export const MEMBERS_PAGE_SIZE = 50;

export type RosterSort = 'recent' | 'spend' | 'points' | 'joined';
export type RosterSegment = 'all' | 'new' | 'active' | 'at-risk' | 'dormant' | 'vip' | 'reward-ready';

/** The segment filter, shared by the roster and the broadcast composer so the
 *  two always offer (and mean) the same set. */
export const SEGMENT_OPTIONS: Array<{ value: RosterSegment; label: string }> = [
  { value: 'all', label: 'All members' },
  { value: 'new', label: 'New' },
  { value: 'active', label: 'Active' },
  { value: 'at-risk', label: 'At-Risk' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'vip', label: 'VIP' },
  // Orthogonal to the lifecycle segments (092): members holding 300+ points
  // with no voucher out. The Needs-attention queue links straight here.
  { value: 'reward-ready', label: 'Reward ready' },
];

interface StatsResponse {
  membersTotal: number;
  newThisMonth: number;
  atRisk: number;
  vip: number;
  pointsLiability: number;
  activeVouchers: number;
  rewardReady: number;
  memberRevenueSharePct: number;
  memberAovCents: number;
  guestAovCents: number;
  invitesSent: number;
  invitesConverted: number;
  segments: { new: number; active: number; atRisk: number; dormant: number; vip: number };
}

interface AttentionItem {
  kind: 'vip_at_risk' | 'reward_ready' | 'discount_expiring' | 'invites_stale';
  tone: 'good' | 'warn';
  count: number;
  detail: { lifetimeCents?: number };
}

interface RosterResponse {
  rows: MemberRow[];
  total: number;
}

// ── formatting (shared with the layout; presentation only) ─────────────────

/** Compact USD, matching the admin dashboard's tile grammar ($1.2k). */
export function money(cents: number): string {
  const usd = (cents ?? 0) / 100;
  return usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${usd.toFixed(usd % 1 === 0 ? 0 : 2)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n ?? 0);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return 'Unexpected error.';
}

/** Migrations 070–072 not applied: undefined table/column or missing function. */
function isMissingBackend(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42P01' || code === '42703' || code === 'PGRST202') return true;
  return /does not exist|could not find the function|schema cache/i.test(getErrorMessage(error));
}

// ── mappers (server numbers → the approved tiles/queue copy) ───────────────

function toStats(s: StatsResponse): MemberStat[] {
  return [
    {
      label: 'Members', value: String(s.membersTotal ?? 0), emphasis: true,
      meta: [`+${s.newThisMonth ?? 0} this month`, `${s.memberRevenueSharePct ?? 0}% of revenue`],
    },
    {
      label: 'New / month', value: String(s.newThisMonth ?? 0),
      meta: [`${s.segments?.new ?? 0} in first 30d`],
    },
    {
      label: 'At-risk', value: String(s.atRisk ?? 0),
      meta: ['no order 60–120d', `${s.segments?.dormant ?? 0} dormant`],
    },
    {
      label: 'Points liability', value: compact(s.pointsLiability ?? 0),
      meta: ['ledger balance', `${s.rewardReady ?? 0} ready to redeem`],
    },
    {
      label: 'Active vouchers', value: String(s.activeVouchers ?? 0),
      meta: ['outstanding credits'],
    },
    {
      label: 'Member rev · 90d', value: `${s.memberRevenueSharePct ?? 0}%`,
      meta: [
        `AOV ${money(s.memberAovCents ?? 0)} vs ${money(s.guestAovCents ?? 0)}`,
        `${s.invitesConverted ?? 0}/${s.invitesSent ?? 0} invites converted`,
      ],
    },
  ];
}

function toQueue(items: AttentionItem[]): MemberQueueItem[] {
  return items.map((it) => {
    switch (it.kind) {
      case 'vip_at_risk':
        return {
          kind: it.kind, tone: it.tone, action: 'Review',
          title: `${it.count} VIP ${plural(it.count, 'member is', 'members are')} now At-Risk`,
          meta: `No order in 60+ days · combined lifetime ${money(it.detail?.lifetimeCents ?? 0)}`,
        };
      case 'reward_ready':
        return {
          kind: it.kind, tone: it.tone, action: 'Notify',
          title: `${it.count} ${plural(it.count, 'member has', 'members have')} a reward credit ready`,
          meta: 'Crossed 300 points · voucher not yet redeemed',
        };
      case 'discount_expiring':
        return {
          kind: it.kind, tone: it.tone, action: 'Renew',
          title: `${it.count} custom ${plural(it.count, 'discount expires', 'discounts expire')} within 14 days`,
          meta: 'Renew, or let it lapse deliberately',
        };
      case 'invites_stale':
      default:
        return {
          kind: 'invites_stale', tone: it.tone, action: 'Follow up',
          title: `${it.count} ${plural(it.count, 'invite', 'invites')} outstanding > 7 days`,
          meta: 'Sent, no signup yet',
        };
    }
  });
}

// ── roster hook ────────────────────────────────────────────────────────────

interface UseMembersDataArgs {
  segment: RosterSegment;
  sort: RosterSort;
  search: string;
}

interface UseMembersDataResult {
  data: MembersViewData | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  unmigrated: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function useMembersData({ segment, sort, search }: UseMembersDataArgs): UseMembersDataResult {
  const [stats, setStats] = useState<MemberStat[]>([]);
  const [queue, setQueue] = useState<MemberQueueItem[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unmigrated, setUnmigrated] = useState(false);

  // Debounce the search box so typing doesn't hammer the RPC.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change restarts pagination. Derived during render (React's
  // "adjust state when a prop changes" pattern) rather than in an effect, so
  // changing a filter doesn't cost an extra render pass.
  const filterKey = `${segment}|${sort}|${debouncedSearch}`;
  const [paging, setPaging] = useState({ key: filterKey, offset: 0 });
  if (paging.key !== filterKey) setPaging({ key: filterKey, offset: 0 });
  const offset = paging.key === filterKey ? paging.offset : 0;

  // Header (KPIs + queue) — independent of the roster's filters.
  useEffect(() => {
    let cancelled = false;
    async function loadHeader() {
      if (!supabase) return;
      const [statsRes, attnRes] = await Promise.all([
        supabase.rpc('admin_member_stats'),
        supabase.rpc('admin_member_attention'),
      ]);
      if (cancelled) return;
      if (statsRes.error) {
        if (isMissingBackend(statsRes.error)) setUnmigrated(true);
        else setError(statsRes.error.message);
        return;
      }
      setStats(toStats(statsRes.data as StatsResponse));
      if (!attnRes.error) {
        const payload = attnRes.data as { items?: AttentionItem[] } | null;
        setQueue(toQueue(payload?.items ?? []));
      }
    }
    loadHeader();
    return () => { cancelled = true; };
  }, []);

  // Roster page — server-side segment / sort / search / limit / offset.
  useEffect(() => {
    let cancelled = false;
    async function loadPage() {
      if (!supabase) {
        setError('Backend not configured.');
        setLoading(false);
        return;
      }
      const first = offset === 0;
      if (first) setLoading(true); else setLoadingMore(true);

      const { data, error: rpcError } = await supabase.rpc('admin_member_roster', {
        p_segment: segment,
        p_sort: sort,
        p_search: debouncedSearch.trim() === '' ? null : debouncedSearch.trim(),
        p_limit: MEMBERS_PAGE_SIZE,
        p_offset: offset,
      });
      if (cancelled) return;

      if (rpcError) {
        if (isMissingBackend(rpcError)) setUnmigrated(true);
        else setError(rpcError.message);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const payload = (data ?? { rows: [], total: 0 }) as RosterResponse;
      setMembers((prev) => (first ? payload.rows : [...prev, ...payload.rows]));
      setTotal(payload.total ?? 0);
      setLoading(false);
      setLoadingMore(false);
    }
    loadPage();
    return () => { cancelled = true; };
  }, [segment, sort, debouncedSearch, offset]);

  const loadMore = useCallback(() => {
    setPaging((p) => ({ ...p, offset: p.offset + MEMBERS_PAGE_SIZE }));
  }, []);

  return {
    data: unmigrated ? null : { stats, queue, members, total },
    loading,
    loadingMore,
    error,
    unmigrated,
    hasMore: members.length > 0 && members.length < total,
    loadMore,
  };
}

// ── per-member detail, loaded on row expand ────────────────────────────────

export function useMemberDetail(row: MemberRow | null): { detail: MemberDetail | null; loading: boolean } {
  // Cache is state (so a fetch re-renders) but is READ during render, not
  // pushed via setState in an effect — no cascading renders, and re-expanding
  // a row is instant.
  const [cache, setCache] = useState<Record<string, MemberDetail>>({});
  const inflight = useRef<Set<string>>(new Set());

  const key = row?.userId ?? null;
  const detail = key ? cache[key] ?? null : null;

  useEffect(() => {
    let cancelled = false;
    if (!row || !supabase) return;

    const k = row.userId;
    if (cache[k] || inflight.current.has(k)) return;
    inflight.current.add(k);

    async function load() {
      if (!row || !supabase) return;
      try {
        // Just the activity timeline — reward balance and discount rules are
        // owned by the shared management panels, which fetch their own data.
        // admin_member_activity keys on the CRM customer id; unlinked accounts
        // (id === null) simply have no timeline yet.
        const activityRes = row.id
          ? await supabase.rpc('admin_member_activity', { p_customer_id: row.id })
          : { data: null, error: null };

        const events = ((activityRes.data as { events?: Array<{ label: string; iso: string }> } | null)?.events ?? [])
          .slice(0, 6)
          .map((e) => ({ label: e.label, iso: e.iso }));

        if (!cancelled) setCache((prev) => ({ ...prev, [k]: { timeline: events } }));
      } finally {
        // ALWAYS release the claim — a cancelled or failed fetch that left `k`
        // in the set would block every future fetch for this member, wedging
        // the row on "Loading…" until a page reload (release-audit bug).
        inflight.current.delete(k);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [row, cache]);

  return { detail, loading: key !== null && detail === null };
}
