/**
 * TrackOrder — public order-status lookup.
 *
 * A customer enters their order number OR email, plus the shipping ZIP, and
 * sees the order's status, tracking number, and a deep-link to the carrier's
 * own tracking page. Backed by the ZIP-gated `lookup_order` RPC (migration
 * 012) which is the only order data exposed to anon — no address, no PII.
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  carrierLabel,
  carrierTrackingUrl,
  statusPresentation,
  STATUS_STEPS,
  type OrderLookupResult,
} from '../lib/tracking';

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: OrderLookupResult[] }
  | { kind: 'error'; message: string };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TrackOrder() {
  const [identifier, setIdentifier] = useState('');
  const [zip, setZip] = useState('');
  const [state, setState] = useState<LookupState>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = identifier.trim();
    const z = zip.trim();
    if (!id || !z) return;
    if (!supabase) {
      setState({ kind: 'error', message: 'Order tracking is temporarily unavailable.' });
      return;
    }
    setState({ kind: 'loading' });
    const { data, error } = await supabase.rpc('lookup_order', { p_identifier: id, p_zip: z });
    if (error) {
      setState({ kind: 'error', message: error.message });
      return;
    }
    setState({ kind: 'done', results: (data ?? []) as OrderLookupResult[] });
  }

  return (
    <section className="py-[var(--space-8)] max-w-[760px] mx-auto px-[var(--space-4)]">
      <header className="mb-[var(--space-6)]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">Order status</p>
        <h1 className="text-[clamp(1.5rem,3.4vw,2.1rem)] leading-[1.05] tracking-[-0.01em] text-ink">
          <span className="font-light text-ink/85">Track your </span>
          <span className="font-medium text-ink">order.</span>
        </h1>
        <p className="mt-[var(--space-3)] text-[13px] leading-relaxed text-ink/70 max-w-[58ch]">
          Enter your order number or the email you ordered with, plus the shipping ZIP code.
        </p>
      </header>

      <form onSubmit={onSubmit} className="research-surface-solid p-[var(--space-5)] mb-[var(--space-5)]">
        <div className="grid gap-[var(--space-4)] sm:grid-cols-[1fr_140px]">
          <div>
            <label htmlFor="track-id" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">
              Order number or email
            </label>
            <input
              id="track-id"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="VSR-ORD-… or you@email.com"
              autoComplete="off"
              className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
            />
          </div>
          <div>
            <label htmlFor="track-zip" className="block text-[10px] uppercase tracking-[0.22em] text-ink/50 mb-[var(--space-1)]">
              Shipping ZIP
            </label>
            <input
              id="track-zip"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="85001"
              autoComplete="off"
              className="w-full rounded-sm border border-ink/15 bg-base-800 px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink/40"
            />
          </div>
        </div>
        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">
          <button
            type="submit"
            disabled={state.kind === 'loading' || !identifier.trim() || !zip.trim()}
            className="rounded-full bg-ink/[0.10] border border-ink/30 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-ink hover:bg-ink/[0.15] hover:border-ink/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.kind === 'loading' ? 'Searching…' : 'Track'}
          </button>
        </div>
        {state.kind === 'error' && (
          <p role="alert" className="mt-[var(--space-3)] text-[12px] text-red-400">{state.message}</p>
        )}
      </form>

      {state.kind === 'done' && state.results.length === 0 && (
        <div className="research-surface-solid p-[var(--space-5)]">
          <p className="text-[13px] text-ink/75">
            No order found with that order number/email and ZIP. Double-check the ZIP matches the
            shipping address, or <a href="/contact" className="text-holo-light underline underline-offset-2">contact us</a>.
          </p>
        </div>
      )}

      {state.kind === 'done' && state.results.map((order) => (
        <OrderCard key={order.order_number} order={order} />
      ))}
    </section>
  );
}

function OrderCard({ order }: { order: OrderLookupResult }) {
  const pres = statusPresentation(order.status);
  const url = carrierTrackingUrl(order.carrier, order.tracking_number);
  const placed = formatDate(order.placed_at);
  const shipped = formatDate(order.shipped_at);
  const delivered = formatDate(order.delivered_at);

  return (
    <article className="research-surface-solid p-[var(--space-5)] mb-[var(--space-4)]">
      <div className="flex items-start justify-between gap-[var(--space-4)] flex-wrap mb-[var(--space-4)]">
        <div>
          <p className="font-mono text-[11px] tracking-[0.06em] text-ink/55">{order.order_number}</p>
          <h2 className="mt-1 text-[1.15rem] font-medium text-ink">{pres.label}</h2>
          {pres.detail && <p className="mt-1 text-[12px] text-ink/65 max-w-[52ch]">{pres.detail}</p>}
        </div>
        {placed && (
          <p className="text-[11px] text-ink/45">
            <span className="uppercase tracking-[0.18em] text-ink/35">Placed</span><br />{placed}
          </p>
        )}
      </div>

      {/* Progress stepper */}
      {pres.tone !== 'stopped' && (
        <ol className="flex items-center gap-1 mb-[var(--space-4)]" aria-label="Order progress">
          {STATUS_STEPS.map((label, i) => {
            const reached = i <= pres.step;
            return (
              <li key={label} className="flex-1 min-w-0">
                <div
                  className={`h-1 rounded-full transition-colors ${reached ? 'bg-holo' : 'bg-ink/12'}`}
                  aria-current={i === pres.step ? 'step' : undefined}
                />
                <span className={`mt-1 block truncate text-[9px] uppercase tracking-[0.14em] ${reached ? 'text-ink/70' : 'text-ink/35'}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Tracking */}
      {order.tracking_number ? (
        <div className="flex items-center justify-between gap-[var(--space-4)] flex-wrap border-t border-ink/[0.08] pt-[var(--space-4)]">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/40">{carrierLabel(order.carrier)} tracking</p>
            <p className="font-mono text-[12px] text-ink/80 break-all">{order.tracking_number}</p>
            {(shipped || delivered) && (
              <p className="mt-1 text-[11px] text-ink/45">
                {delivered ? `Delivered ${delivered}` : shipped ? `Shipped ${shipped}` : null}
              </p>
            )}
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-full bg-holo/[0.15] border border-holo/40 px-[var(--space-5)] py-[var(--space-2)] text-[10px] uppercase tracking-[0.2em] font-medium text-holo-light hover:bg-holo/[0.22] transition-colors"
            >
              Track on {carrierLabel(order.carrier)} ↗
            </a>
          )}
        </div>
      ) : (
        pres.step >= 3 && (
          <p className="border-t border-ink/[0.08] pt-[var(--space-4)] text-[12px] text-ink/55">
            A tracking number will appear here once it’s posted.
          </p>
        )
      )}
    </article>
  );
}
