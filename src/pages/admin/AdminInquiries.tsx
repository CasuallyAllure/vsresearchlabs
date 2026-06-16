/**
 * AdminInquiries
 *
 * List of incoming inquiries. Each row expands to show the line items.
 * The "Create order" action calls `create_order_from_inquiry` RPC and
 * navigates to the new order's detail page.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import { AdminFilterBar } from './AdminFilterBar';

interface InquiryRow {
  id: string;
  reference_id: string;
  created_at: string;
  name: string;
  contact: string;
  organization: string | null;
  notes: string | null;
  status: 'OPEN' | 'REVIEWING' | 'RESPONDED' | 'CLOSED';
  item_count: number;
}

interface InquiryItemRow {
  id: string;
  sku: string;
  product_name: string;
  quantity: number;
  category: string | null;
  item_note: string | null;
}

const STATUS_FILTER_ORDER: Array<InquiryRow['status'] | 'ALL'> = [
  'ALL',
  'OPEN',
  'REVIEWING',
  'RESPONDED',
  'CLOSED',
];

export function AdminInquiries() {
  const [rows, setRows] = useState<InquiryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTER_ORDER)[number]>('OPEN');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itemsByInquiry, setItemsByInquiry] = useState<Record<string, InquiryItemRow[]>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError('Backend not configured.');
        return;
      }
      let q = supabase
        .from('inquiries')
        .select('id, reference_id, created_at, name, contact, organization, notes, status, item_count')
        .order('created_at', { ascending: false })
        .limit(200);
      if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as InquiryRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  async function expand(inquiryId: string) {
    if (expanded === inquiryId) {
      setExpanded(null);
      return;
    }
    setExpanded(inquiryId);
    if (itemsByInquiry[inquiryId]) return;
    if (!supabase) return;
    const { data, error } = await supabase
      .from('inquiry_items')
      .select('id, sku, product_name, quantity, category, item_note')
      .eq('inquiry_id', inquiryId);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load inquiry items:', error.message);
      return;
    }
    setItemsByInquiry((prev) => ({ ...prev, [inquiryId]: (data ?? []) as InquiryItemRow[] }));
  }

  async function createOrder(inquiryId: string) {
    if (!supabase) return;
    setCreating(inquiryId);
    const { data, error } = await supabase.rpc('create_order_from_inquiry', {
      p_inquiry_id: inquiryId,
    });
    setCreating(null);
    if (error) {
      alert(`Failed to create order: ${error.message}`);
      return;
    }
    if (typeof data === 'string') {
      navigate(`/admin/orders/${data}`);
    }
  }

  return (
    <AdminLayout>
      <header className="mb-[var(--space-6)] flex flex-col gap-[var(--space-4)]">
        <div>
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
            Inquiries
          </p>
          <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-ink">
            <span className="font-light text-ink/85">Incoming </span>
            <span className="font-medium text-ink">requests.</span>
          </h2>
        </div>
        <AdminFilterBar
          options={STATUS_FILTER_ORDER.map((s) => ({
            value: s,
            label: s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase(),
          }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </header>

      {error && (
        <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>
      )}

      {rows === null && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {rows && rows.length === 0 && (
        <div className="research-surface-solid p-[var(--space-6)]">
          <p className="text-[13px] text-ink/55">No inquiries in this filter.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="research-surface-solid divide-y divide-ink/[0.04]">
          {rows.map((row) => {
            const isExpanded = expanded === row.id;
            const items = itemsByInquiry[row.id] ?? [];
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => expand(row.id)}
                  className="w-full px-[var(--space-5)] py-[var(--space-4)] flex items-start gap-[var(--space-4)] text-left hover:bg-ink/[0.015] focus:outline-none focus-visible:bg-ink/[0.02] transition-colors"
                  aria-expanded={isExpanded}
                >
                  <span className="font-mono text-[10.5px] text-ink/35 tabular-nums shrink-0 pt-1 w-[120px]">
                    {formatTs(row.created_at)}
                  </span>
                  <span className="font-mono text-[11px] text-holo-light/80 tracking-[0.04em] shrink-0 pt-1 w-[170px] truncate">
                    {row.reference_id}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-ink truncate">{row.name}</span>
                    <span className="block text-[11px] text-ink/45 truncate">
                      {row.contact}
                      {row.organization && ` · ${row.organization}`}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-ink/55 tabular-nums shrink-0 w-[80px] text-right">
                    {row.item_count} {row.item_count === 1 ? 'unit' : 'units'}
                  </span>
                  <span className={`shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm border ${statusChipStyles(row.status)}`}>
                    {row.status}
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-[var(--space-5)] pb-[var(--space-5)] border-t border-ink/[0.04]">
                    {row.notes && (
                      <p className="mt-[var(--space-4)] text-[12.5px] text-ink/70 leading-relaxed max-w-[72ch]">
                        <span className="text-[10px] uppercase tracking-[0.22em] text-ink/35 mr-2">Notes</span>
                        {row.notes}
                      </p>
                    )}
                    {items.length > 0 && (
                      <div className="mt-[var(--space-4)] overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse">
                          <thead>
                            <tr className="border-y border-ink/[0.06]">
                              <th className="py-[var(--space-2)] text-left text-[10px] uppercase tracking-[0.18em] text-ink/40 font-normal pl-0">SKU</th>
                              <th className="py-[var(--space-2)] text-left text-[10px] uppercase tracking-[0.18em] text-ink/40 font-normal">Item</th>
                              <th className="py-[var(--space-2)] text-right text-[10px] uppercase tracking-[0.18em] text-ink/40 font-normal w-12">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((it) => (
                              <tr key={it.id} className="border-b border-ink/[0.04]">
                                <td className="py-[var(--space-2)] pl-0 font-mono text-[11px] text-holo-light/75">{it.sku}</td>
                                <td className="py-[var(--space-2)] text-[12px] text-ink/75">
                                  {it.product_name}
                                  {it.item_note && (
                                    <div className="text-[10.5px] text-ink/40 mt-0.5">Note: {it.item_note}</div>
                                  )}
                                </td>
                                <td className="py-[var(--space-2)] text-right font-mono tabular-nums text-[12px] text-ink/70">{it.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="mt-[var(--space-5)] flex items-center gap-[var(--space-3)]">
                      <button
                        type="button"
                        onClick={() => createOrder(row.id)}
                        disabled={creating === row.id || row.status === 'CLOSED'}
                        className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {creating === row.id ? 'Creating…' : 'Create order'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AdminLayout>
  );
}

function statusChipStyles(status: InquiryRow['status']): string {
  switch (status) {
    case 'OPEN':       return 'border-holo/40 text-holo-light/80 bg-holo/[0.08]';
    case 'REVIEWING':  return 'border-ink/25 text-ink/75 bg-ink/[0.05]';
    case 'RESPONDED':  return 'border-ink/15 text-ink/55 bg-ink/[0.02]';
    case 'CLOSED':     return 'border-ink/10 text-ink/35 bg-transparent';
  }
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}
