/**
 * AdminNewOrder
 *
 * Admin-initiated order composer — for B2B/offline buyers who never touch the
 * cart. Reuses the same compound → dose enumeration and live per-dose pricing
 * as OrderView's itemized editor (ItemizedEditor), so line items line up with
 * the real catalog; the unit price stays hand-editable for negotiated pricing.
 *
 * On submit, calls `admin_create_order` and lands on the created order's
 * detail page — the same page any other order opens on.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminLayout } from './AdminLayout';
import productsData from '../../data/products.json';
import generatedCompounds from '../../data/biopeptideCompounds.generated.json';
import type { Product } from '../../types';
import { effectiveTierPriceCents } from '../../lib/pricing';
import { isVariantPublic, useProductOverrides } from '../../lib/productOverrides';

/** SKU → catalog product, for enumerating compound/dose options. */
const productBySku = new Map<string, Product>();
for (const p of [...productsData, ...generatedCompounds] as unknown as Product[]) {
  if (p.sku) productBySku.set(p.sku, p);
}

interface VariantOption {
  sku: string;
  dose: string;
  /** "5-Amino-1MQ — 10mg" — same label format OrderView's line editor uses. */
  name: string;
  priceCents: number;
}

interface DraftRow {
  key: string;
  compound: string;
  dose: string;
  sku: string;
  productName: string;
  quantity: string;
  unitUsd: string;
}

function emptyRow(key: string): DraftRow {
  return { key, compound: '', dose: '', sku: '', productName: '', quantity: '1', unitUsd: '' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldCls =
  'w-full rounded-field border border-ink/12 bg-base-700 px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-ink placeholder-ink/30 transition-[border-color,box-shadow] duration-150 hover:border-ink/20 focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15';

export function AdminNewOrder() {
  const navigate = useNavigate();
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow('r0')]);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure per-variant admin prices are loaded so the picker shows real
  // prices (not a $0 placeholder) even if the admin lands here cold.
  useEffect(() => { void useProductOverrides.getState().load(); }, []);

  const variantBySku = useProductOverrides((s) => s.variantBySku);
  const { compoundNames, byCompound } = useMemo(() => {
    const byCompound = new Map<string, VariantOption[]>();
    for (const p of productBySku.values()) {
      for (const v of p.variants ?? []) {
        if (!isVariantPublic(p.sku, v.dose)) continue;
        const cents = effectiveTierPriceCents(p, v.dose);
        if (cents == null) continue;
        const name = v.dose ? `${p.name} — ${v.dose}` : p.name;
        const opt: VariantOption = { sku: p.sku, dose: v.dose, name, priceCents: cents };
        const arr = byCompound.get(p.name) ?? [];
        arr.push(opt);
        byCompound.set(p.name, arr);
      }
    }
    const compoundNames = [...byCompound.keys()].sort();
    return { compoundNames, byCompound };
  }, [variantBySku]);

  function update(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }
  function add() {
    setRows((rs) => [...rs, emptyRow(`r${Date.now()}-${rs.length}`)]);
  }

  function onPickCompound(key: string, compound: string) {
    update(key, { compound, dose: '', sku: '', productName: '', unitUsd: '' });
  }

  function onPickDose(key: string, variantKey: string) {
    if (!variantKey) { update(key, { dose: '', sku: '', productName: '', unitUsd: '' }); return; }
    const [sku, dose] = variantKey.split('|');
    for (const opts of byCompound.values()) {
      const opt = opts.find((o) => o.sku === sku && o.dose === dose);
      if (opt) { update(key, { sku: opt.sku, dose: opt.dose, productName: opt.name, unitUsd: (opt.priceCents / 100).toFixed(2) }); return; }
    }
  }

  const emailValid = EMAIL_RE.test(buyerEmail.trim());
  const nameValid = buyerName.trim().length > 0;
  const completeRows = rows.filter((r) => r.sku.trim() && r.dose.trim() && r.quantity.trim());
  const canSubmit = nameValid && emailValid && completeRows.length > 0 && !submitting;

  async function submit() {
    setTouched(true);
    setError(null);
    if (!nameValid || !emailValid || completeRows.length === 0) return;
    if (!supabase) { setError('Backend not configured.'); return; }

    const linesPayload = completeRows.map((r) => {
      const q = parseInt(r.quantity, 10);
      return {
        sku: r.sku.trim(),
        product_name: r.productName.trim() || r.sku.trim(),
        quantity: Number.isFinite(q) && q > 0 ? q : 1,
        unit_price_cents: r.unitUsd.trim() === '' ? 0 : Math.round(parseFloat(r.unitUsd) * 100),
        item_note: null,
      };
    });

    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_order', {
        p_buyer_name: buyerName.trim(),
        p_buyer_contact: buyerEmail.trim(),
        p_buyer_organization: organization.trim() || null,
        p_notes: notes.trim() || null,
        p_lines: linesPayload,
      });
      if (rpcError) throw rpcError;
      const result = data as { order_id?: string } | null;
      if (!result?.order_id) throw new Error('Order created, but no order id was returned.');
      navigate(`/admin/orders/${result.order_id}`);
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Failed to create order.');
    }
  }

  return (
    <AdminLayout backTo="/admin/orders" backLabel="All orders">
      <div className="research-surface-solid p-[var(--space-6)]">
        <p className="holo-text-caption mb-[var(--space-2)] text-[10px] uppercase tracking-[0.3em] text-ink/40">
          New order
        </p>
        <h2 className="mb-[var(--space-5)] text-[clamp(1.1rem,2.4vw,1.4rem)] leading-[1.1] tracking-[-0.01em] text-ink">
          Create an order for a buyer.
        </h2>

        {/* Buyer */}
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-ink/45">Buyer name *</span>
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Full name" className={fieldCls} />
            {touched && !nameValid && <p className="mt-1 text-[10.5px] text-red-400">Buyer name is required.</p>}
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-ink/45">Buyer email *</span>
            <input
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              placeholder="buyer@example.com"
              className={fieldCls}
            />
            {touched && !emailValid && <p className="mt-1 text-[10.5px] text-red-400">Enter a valid email address.</p>}
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-ink/45">Organization (optional)</span>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="Lab, university, or entity" className={fieldCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-ink/45">Notes (optional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes for this order" className={`${fieldCls} resize-y`} />
          </label>
        </div>

        {/* Line items */}
        <div className="mt-[var(--space-6)] border-t border-ink/[0.08] pt-[var(--space-4)]">
          <p className="mb-[var(--space-2)] text-[10px] uppercase tracking-[0.26em] text-ink/40">Itemized</p>
          <div className="space-y-[var(--space-2)] rounded-[14px] border border-ink/[0.12] bg-ink/[0.015] p-[var(--space-3)]">
            {rows.map((r) => {
              const doseOptions = byCompound.get(r.compound) ?? [];
              const variantKey = r.sku && r.dose ? `${r.sku}|${r.dose}` : '';
              const cents = r.unitUsd.trim() === '' ? 0 : Math.round(parseFloat(r.unitUsd) * 100);
              const qty = parseInt(r.quantity, 10);
              const lineCents = Number.isFinite(cents) && Number.isFinite(qty) ? cents * qty : 0;
              return (
                <div key={r.key} className="space-y-1.5 border-b border-ink/[0.05] pb-[var(--space-2)] last:border-b-0 last:pb-0">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink/40">Compound</span>
                      <select value={r.compound} onChange={(e) => onPickCompound(r.key, e.target.value)} className={fieldCls}>
                        <option value="">— Select compound —</option>
                        {compoundNames.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink/40">Dose / size</span>
                      <select
                        value={variantKey}
                        onChange={(e) => onPickDose(r.key, e.target.value)}
                        disabled={!r.compound}
                        className={`${fieldCls} disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        <option value="">{r.compound ? '— Select dose —' : '— Pick compound first —'}</option>
                        {doseOptions.map((o) => (
                          <option key={`${o.sku}|${o.dose}`} value={`${o.sku}|${o.dose}`}>
                            {o.dose || o.name} &middot; ${(o.priceCents / 100).toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 items-center gap-[var(--space-2)] sm:grid-cols-[1fr_auto]">
                    <div className="flex min-w-0 flex-wrap items-center gap-3 pl-0.5">
                      {lineCents > 0 && <span className="font-mono text-[10px] tabular-nums text-ink/35">line ${(lineCents / 100).toFixed(2)}</span>}
                    </div>
                    <div className="flex items-center gap-[var(--space-2)]">
                      <label className="block w-[56px]">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink/40">Qty</span>
                        <input type="number" min="1" max="9999" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className={`${fieldCls} text-right`} />
                      </label>
                      <label className="block w-[80px]">
                        <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-ink/40">Unit $</span>
                        <input type="number" step="0.01" min="0" value={r.unitUsd} onChange={(e) => update(r.key, { unitUsd: e.target.value })} placeholder="—" className={`${fieldCls} text-right`} />
                      </label>
                      <button
                        type="button"
                        onClick={() => remove(r.key)}
                        disabled={rows.length === 1}
                        aria-label="Remove"
                        className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full border border-red-400/30 text-red-400/75 hover:border-red-400/55 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={add} className="mt-[var(--space-2)] text-[10px] uppercase tracking-[0.16em] text-holo hover:text-holo-light">
              + Add item
            </button>
          </div>
          {touched && completeRows.length === 0 && (
            <p className="mt-[var(--space-2)] text-[10.5px] text-red-400">Add at least one complete line item (compound, dose, and quantity).</p>
          )}
        </div>

        {error && <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{error}</p>}

        <div className="mt-[var(--space-5)] flex items-center justify-end gap-[var(--space-2)]">
          <button
            type="button"
            onClick={() => navigate('/admin/orders')}
            className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-ink/15 px-[var(--space-4)] text-[10px] uppercase tracking-[0.16em] text-ink/70 hover:border-ink/30 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-ink/10 bg-[color:var(--color-status-successMuted)] px-[var(--space-5)] text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--color-status-success)] hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create order'}
          </button>
        </div>
      </div>
    </AdminLayout>
  );
}
