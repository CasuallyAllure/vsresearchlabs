/**
 * AdminCustomerDetail
 *
 * Per-customer view: identity, status, internal notes, full inquiry +
 * order history. Notes and status are mutated via SECURITY DEFINER
 * RPCs (`set_customer_notes`, `set_customer_status`) which audit-log
 * automatically.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';

interface CustomerRow {
  id: string;
  contact_key: string;
  display_name: string;
  contact: string;
  organization: string | null;
  phone: string | null;
  notes: string | null;
  status: 'active' | 'inactive' | 'blocked';
  first_seen_at: string;
  last_seen_at: string;
  inquiry_count: number;
  order_count: number;
}

interface InquiryRow {
  id: string;
  reference_id: string;
  created_at: string;
  status: string;
  item_count: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  invoice_amount_cents: number | null;
}

export function AdminCustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [notesDraft, setNotesDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !id) return;
    const { data: c, error: cErr } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    if (cErr) {
      setError(cErr.message);
      return;
    }
    const row = c as CustomerRow;
    setCustomer(row);
    setNotesDraft(row.notes ?? '');

    const [inqs, ords] = await Promise.all([
      supabase
        .from('inquiries')
        .select('id, reference_id, created_at, status, item_count')
        .ilike('contact', row.contact)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('id, order_number, created_at, status, invoice_amount_cents')
        .ilike('buyer_contact', row.contact)
        .order('created_at', { ascending: false }),
    ]);

    setInquiries((inqs.data ?? []) as InquiryRow[]);
    setOrders((ords.data ?? []) as OrderRow[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveNotes() {
    if (!supabase || !customer) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('set_customer_notes', {
      p_customer_id: customer.id,
      p_notes: notesDraft.trim() || null,
    });
    setBusy(false);
    if (error) setError(error.message);
    else load();
  }

  async function setStatus(next: CustomerRow['status']) {
    if (!supabase || !customer) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('set_customer_status', {
      p_customer_id: customer.id,
      p_status: next,
    });
    setBusy(false);
    if (error) setError(error.message);
    else load();
  }

  return (
    <AdminLayout>
      <button
        type="button"
        onClick={() => navigate('/admin/customers')}
        className="text-[10px] uppercase tracking-[0.22em] text-white/45 hover:text-white/80 transition-colors mb-[var(--space-5)]"
      >
        ← All customers
      </button>

      {error && <p role="alert" className="mb-[var(--space-4)] text-[12px] text-red-400">{error}</p>}

      {!customer && !error && (
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.22em]">Loading…</p>
      )}

      {customer && (
        <>
          <header className="mb-[var(--space-6)] pb-[var(--space-5)] border-b border-white/[0.06]">
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
              Customer
            </p>
            <h2 className="text-[clamp(1.3rem,2.6vw,1.7rem)] leading-[1.1] tracking-[-0.01em] text-white">
              {customer.display_name}
            </h2>
            <dl className="mt-[var(--space-4)] grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-4)] text-[12px]">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-0.5">Contact</dt>
                <dd className="font-mono text-white/85">{customer.contact}</dd>
                {customer.organization && <dd className="text-white/55">{customer.organization}</dd>}
                {customer.phone && <dd className="text-white/55">{customer.phone}</dd>}
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-0.5">Activity</dt>
                <dd className="text-white/75">
                  <span className="font-mono tabular-nums">{customer.inquiry_count}</span> inquiry / <span className="font-mono tabular-nums">{customer.order_count}</span> order
                </dd>
                <dd className="font-mono text-[11px] text-white/45 tabular-nums">
                  First {formatDate(customer.first_seen_at)} · Last {formatDate(customer.last_seen_at)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-0.5">Status</dt>
                <dd className="flex items-center gap-1.5 mt-0.5">
                  {(['active', 'inactive', 'blocked'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      disabled={busy || customer.status === s}
                      className={[
                        'rounded-full px-[var(--space-3)] py-[var(--space-1)] text-[10px] uppercase tracking-[0.18em] transition-colors',
                        customer.status === s
                          ? statusChipStyles(s)
                          : 'border border-white/[0.08] text-white/55 hover:text-white/90',
                      ].join(' ')}
                    >
                      {s}
                    </button>
                  ))}
                </dd>
              </div>
            </dl>
          </header>

          {/* Notes */}
          <section className="mb-[var(--space-8)] research-surface-solid p-[var(--space-5)]">
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
              Internal notes
            </p>
            <textarea
              rows={3}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Admin-only notes. Customer never sees these."
              className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black border border-white/10 rounded-sm text-[12.5px] text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors resize-y"
            />
            <div className="mt-[var(--space-3)] flex items-center justify-end gap-[var(--space-3)]">
              <button
                type="button"
                onClick={saveNotes}
                disabled={busy || notesDraft === (customer.notes ?? '')}
                className="rounded-full bg-white/[0.10] border border-white/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.22em] font-medium text-white hover:bg-white/[0.15] hover:border-white/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </section>

          {/* Inquiries */}
          <section className="mb-[var(--space-6)]">
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
              Inquiries ({inquiries.length})
            </p>
            {inquiries.length === 0 ? (
              <p className="text-[12px] text-white/40">None on file.</p>
            ) : (
              <ul className="research-surface-solid divide-y divide-white/[0.04]">
                {inquiries.map((row) => (
                  <li key={row.id} className="px-[var(--space-5)] py-[var(--space-3)] flex items-center gap-[var(--space-4)]">
                    <span className="font-mono text-[10.5px] text-white/45 tabular-nums w-[120px] shrink-0">{formatTs(row.created_at)}</span>
                    <span className="font-mono text-[11px] text-holo-light/80 tracking-[0.04em] w-[170px] shrink-0 truncate">{row.reference_id}</span>
                    <span className="flex-1 text-[12px] text-white/65">
                      {row.item_count} {row.item_count === 1 ? 'unit' : 'units'}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-white/55">{row.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Orders */}
          <section>
            <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-3)]">
              Orders ({orders.length})
            </p>
            {orders.length === 0 ? (
              <p className="text-[12px] text-white/40">None on file.</p>
            ) : (
              <ul className="research-surface-solid divide-y divide-white/[0.04]">
                {orders.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={`/admin/orders/${row.id}`}
                      className="px-[var(--space-5)] py-[var(--space-3)] flex items-center gap-[var(--space-4)] hover:bg-white/[0.015] transition-colors"
                    >
                      <span className="font-mono text-[10.5px] text-white/45 tabular-nums w-[120px] shrink-0">{formatTs(row.created_at)}</span>
                      <span className="font-mono text-[11px] text-holo-light/80 tracking-[0.04em] w-[170px] shrink-0 truncate">{row.order_number}</span>
                      <span className="flex-1 font-mono text-[12px] text-white/75 tabular-nums">{formatCents(row.invoice_amount_cents)}</span>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-white/55">{row.status.replace(/_/g, ' ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AdminLayout>
  );
}

function statusChipStyles(status: CustomerRow['status']): string {
  switch (status) {
    case 'active':   return 'border-[#7CD992]/40 text-[#7CD992]/90 bg-[#7CD992]/[0.10]';
    case 'inactive': return 'border-white/25 text-white/85 bg-white/[0.05]';
    case 'blocked':  return 'border-red-400/40 text-red-300/85 bg-red-400/[0.08]';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
