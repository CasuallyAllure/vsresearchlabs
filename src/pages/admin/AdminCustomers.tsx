/**
 * AdminCustomers
 *
 * Customer directory deduped by lowercase(contact), enriched into an
 * outreach surface: every row carries lifetime paid spend, the reward
 * points that spend has earned (mirrors migration 044's accrual:
 * floor(invoice_amount_cents/100) per paid order), and a Member/Guest
 * chip. Guests who've already banked points get a one-tap "Invite"
 * mailto — sign up and we credit what you've earned — so the list
 * doubles as the outreach queue. Each row clicks through to
 * AdminCustomerDetail. Counts are maintained by triggers (see migration
 * 004 — trg_upsert_customer_on_inquiry and trg_bump_customer_order_count).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';
import { CHIP_BASE } from '../../components/ui/OrderStatusChip';
import { formatUsd } from '../../lib/payment';
import { InviteSheet } from './CustomerInvite';

interface CustomerRow {
  id: string;
  contact_key: string;
  display_name: string;
  contact: string;
  organization: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'blocked';
  first_seen_at: string;
  last_seen_at: string;
  inquiry_count: number;
  order_count: number;
  last_inquiry_at: string | null;
  last_order_at:   string | null;
}

/** Revenue-recognized money + earned points per contact_key. Points mirror
 *  the 044 ledger accrual — floor(cents/100) PER paid order, then summed —
 *  so the number here equals what a backfill would actually credit. */
interface SpendStats {
  spendCents: number;
  paidOrders: number;
  points: number;
}

const STATUS_FILTERS: Array<CustomerRow['status'] | 'all'> = [
  'all', 'active', 'inactive', 'blocked',
];

type MemberFilter = 'everyone' | 'members' | 'guests';

const MEMBER_FILTERS: Array<{ value: MemberFilter; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'members', label: 'Members' },
  { value: 'guests', label: 'Guests' },
];

type SortValue = 'recent' | 'spend' | 'points' | 'orders';

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'spend', label: 'Spend ↓' },
  { value: 'points', label: 'Points ↓' },
  { value: 'orders', label: 'Orders ↓' },
];

export function AdminCustomers() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [statsByKey, setStatsByKey] = useState<Record<string, SpendStats>>({});
  const [memberCustomerIds, setMemberCustomerIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('everyone');
  const [sort, setSort] = useState<SortValue>('recent');
  const [inviteFor, setInviteFor] = useState<CustomerRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('customer_with_history')
        .select('id, contact_key, display_name, contact, organization, phone, status, first_seen_at, last_seen_at, inquiry_count, order_count, last_inquiry_at, last_order_at')
        .order('last_seen_at', { ascending: false })
        .limit(500);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) { setError(error.message); return; }
      setRows((data ?? []) as CustomerRow[]);

      // Lifetime paid spend per contact — one pass over revenue-recognized
      // orders, grouped by lowercase contact to match contact_key.
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .select('buyer_contact, invoice_amount_cents, status')
        .in('status', ['paid', 'fulfilled'])
        .limit(5000);
      if (cancelled) return;
      if (!orderErr) {
        const map: Record<string, SpendStats> = {};
        for (const o of (orderData ?? []) as Array<{ buyer_contact: string; invoice_amount_cents: number | null }>) {
          const key = (o.buyer_contact ?? '').trim().toLowerCase();
          if (!key) continue;
          const cents = o.invoice_amount_cents ?? 0;
          const cur = map[key] ?? { spendCents: 0, paidOrders: 0, points: 0 };
          map[key] = {
            spendCents: cur.spendCents + cents,
            paidOrders: cur.paidOrders + 1,
            points: cur.points + Math.floor(cents / 100),
          };
        }
        setStatsByKey(map);
      }

      // Which CRM rows have a portal account — customer_profiles soft-links
      // back via customer_id (admin-read RLS policy, migration 028).
      const { data: profileData, error: profileErr } = await supabase
        .from('customer_profiles')
        .select('customer_id')
        .not('customer_id', 'is', null)
        .limit(2000);
      if (cancelled) return;
      if (!profileErr) {
        setMemberCustomerIds(new Set(
          ((profileData ?? []) as Array<{ customer_id: string }>).map((p) => p.customer_id),
        ));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter((r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.contact.toLowerCase().includes(q) ||
        (r.organization?.toLowerCase().includes(q) ?? false),
      );
    }
    if (memberFilter !== 'everyone') {
      list = list.filter((r) =>
        memberFilter === 'members' ? memberCustomerIds.has(r.id) : !memberCustomerIds.has(r.id),
      );
    }
    if (sort !== 'recent') {
      const stat = (r: CustomerRow) => statsByKey[r.contact_key] ?? { spendCents: 0, paidOrders: 0, points: 0 };
      const copy = [...list];
      if (sort === 'spend') copy.sort((a, b) => stat(b).spendCents - stat(a).spendCents);
      else if (sort === 'points') copy.sort((a, b) => stat(b).points - stat(a).points);
      else copy.sort((a, b) => b.order_count - a.order_count);
      list = copy;
    }
    return list;
  }, [rows, query, memberFilter, sort, memberCustomerIds, statsByKey]);

  return (
    <AdminLayout>
      <header className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Customers</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <AdminFilterBar
            label=""
            dense
            options={SORT_OPTIONS}
            value={sort}
            onChange={setSort}
          />
          <AdminFilterBar
            label=""
            dense
            options={MEMBER_FILTERS}
            value={memberFilter}
            onChange={setMemberFilter}
          />
          <AdminFilterBar
            label=""
            dense
            options={STATUS_FILTERS.map((s) => ({ value: s, label: s }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <input
            type="search"
            placeholder="Name / email / org"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 min-h-[40px] flex-1 rounded-full border border-ink/10 bg-base-700 px-[var(--space-3)] py-[5px] text-[12px] text-ink placeholder-ink/30 transition-colors focus:border-ink/30 focus:outline-none"
          />
        </div>
      </header>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">
            No customers on file yet. Records are auto-created when the
            first inquiry from a contact lands.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {filtered.map((row) => {
            const stats = statsByKey[row.contact_key] ?? { spendCents: 0, paidOrders: 0, points: 0 };
            const isMember = memberCustomerIds.has(row.id);
            const invitable = !isMember && stats.points > 0;
            return (
              <li key={row.id} className="flex items-stretch">
                <Link
                  to={`/admin/customers/${row.id}`}
                  className="block min-w-0 flex-1 min-h-[44px] px-[var(--space-5)] py-[var(--space-4)] hover:bg-ink/[0.015] focus:outline-none focus-visible:bg-ink/[0.02] transition-colors"
                >
                  <div className="flex flex-wrap items-start gap-x-[var(--space-4)] gap-y-1">
                    <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                      <p className="flex items-center gap-1.5 text-[13px] text-ink">
                        <span className="truncate">{row.display_name}</span>
                        <span className={`${CHIP_BASE} shrink-0 ${isMember
                          ? 'border-holo/35 text-holo bg-holo/[0.07]'
                          : 'border-ink/15 text-ink/50 bg-ink/[0.02]'}`}
                        >
                          {isMember ? 'member' : 'guest'}
                        </span>
                      </p>
                      <p className="font-mono text-[11px] text-ink/55 truncate">
                        {row.contact}
                        {row.organization && (
                          <span className="text-ink/35"> · {row.organization}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-mono text-[11.5px] text-ink/80 tabular-nums">
                        {formatUsd(stats.spendCents)} · {stats.paidOrders} paid
                      </p>
                      <p className="font-mono text-[10px] tabular-nums">
                        {stats.points > 0 ? (
                          <span className={invitable ? 'text-holo' : 'text-ink/45'}>
                            {stats.points.toLocaleString()} pts{invitable ? ' unclaimed' : ''}
                          </span>
                        ) : (
                          <span className="text-ink/35">last seen {formatDate(row.last_seen_at)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </Link>
                {invitable && (
                  <button
                    type="button"
                    onClick={() => setInviteFor(row)}
                    title={`Email ${row.display_name}: sign up and we'll credit your ${stats.points.toLocaleString()} points`}
                    className="flex min-w-[64px] shrink-0 items-center justify-center border-l border-ink/[0.05] px-[var(--space-3)] font-mono text-[9.5px] uppercase tracking-[0.16em] text-holo transition-colors hover:bg-holo/[0.05] focus:outline-none focus-visible:bg-holo/[0.06]"
                  >
                    Invite
                  </button>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-[var(--space-5)] py-[var(--space-8)] text-center text-[12px] text-ink/40">
              No matches.
            </li>
          )}
        </ul>
      )}

      {inviteFor && (
        <InviteSheet
          target={inviteFor}
          points={(statsByKey[inviteFor.contact_key] ?? { points: 0 }).points}
          onClose={() => setInviteFor(null)}
        />
      )}
    </AdminLayout>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
