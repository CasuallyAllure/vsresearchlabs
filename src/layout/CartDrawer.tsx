/**
 * CartDrawer
 *
 * Slide-out inquiry panel triggered by the GlobalHeader cart button.
 * The cart no longer jumps straight to /cart — the whole flow lives in
 * this column, mirroring the NavDrawer surface so the two header
 * affordances feel like one system:
 *
 *   1. list    — review / adjust the inquiry items
 *   2. form    — enter name + email to receive an invoice
 *   3. success — confirmation that the invoice is on its way
 *
 * Submission reuses the same supabase `send-inquiry` contract as the
 * full /cart page ({ name, contact, notes, items }), so the backend
 * receives the identical payload shape.
 *
 * Surface posture matches NavDrawer:
 *   - Frosted black + hairline border (left edge — cart is right-side)
 *   - Holo cyan accents; gold reserved for the primary inquiry action
 *   - Silver mono captions for headers and meta
 *
 * Interaction parity with NavDrawer:
 *   - Slides from the right · backdrop / ESC closes
 *   - Body scroll-locked while open · reduced-motion disables the slide
 *   - 100dvh height so the footer action clears mobile browser chrome
 */

import { useEffect, useState } from 'react';
import { useCart } from '../hooks/useCart';
import { supabase } from '../lib/supabase';
import { SKUCode } from '../components/ui/identifiers';

const MAX_QTY = 999;

type View = 'list' | 'form';
type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; email: string; reference?: string }
  | { kind: 'error'; message: string };

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const items = useCart((s) => s.items);
  const itemCount = useCart((s) => s.itemCount());
  const updateQuantity = useCart((s) => s.updateQuantity);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);

  const [view, setView] = useState<View>('list');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      window.scrollTo(0, y);
    };
  }, [open]);

  // Reset to the list step shortly after the drawer closes.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setView('list');
      setSubmit({ kind: 'idle' });
    }, 300);
    return () => clearTimeout(t);
  }, [open]);

  const nameEmpty = name.trim().length === 0;
  const emailEmpty = email.trim().length === 0;
  const formInvalid = nameEmpty || emailEmpty || items.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formInvalid || submit.kind === 'submitting') return;

    setSubmit({ kind: 'submitting' });

    if (!supabase) {
      setSubmit({
        kind: 'error',
        message: 'Inquiry service is not configured. Please try again later.',
      });
      return;
    }

    const payload = {
      name: name.trim(),
      contact: email.trim(),
      items: items.map((i) => ({
        product: {
          id: i.product.id,
          name: i.product.name,
          category: i.product.category,
          sku: i.product.sku,
        },
        quantity: i.quantity,
        note: i.note?.trim() || undefined,
      })),
    };

    const { data, error } = await supabase.functions.invoke('send-inquiry', {
      body: payload,
    });

    if (error || !data?.success) {
      const message =
        (data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : null) ??
        error?.message ??
        'Failed to send inquiry. Please try again.';
      setSubmit({ kind: 'error', message });
      return;
    }

    const reference =
      data && typeof data === 'object' && 'referenceId' in data
        ? String((data as { referenceId: unknown }).referenceId)
        : undefined;

    const sentEmail = email.trim();
    clear();
    setName('');
    setEmail('');
    setSubmit({ kind: 'success', email: sentEmail, reference });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-black/65 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Inquiry list"
        className={`fixed top-0 right-0 z-[60] flex h-[100dvh] w-[340px] max-w-[90vw] sm:w-[380px] flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          backgroundColor: 'rgba(7, 10, 14, 0.96)',
          borderLeft: '1px solid rgba(160, 200, 235, 0.18)',
          boxShadow:
            '0 0 0 1px rgba(160,200,235,0.06), -24px 0 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.04)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Header — identity + close */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.3em] text-holo-light/70">
              {submit.kind === 'success'
                ? 'Inquiry Filed'
                : view === 'form'
                ? 'Buyer Details'
                : 'Inquiry List'}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-white/35">
              {itemCount > 0
                ? `${itemCount} item${itemCount === 1 ? '' : 's'} pending`
                : submit.kind === 'success'
                ? 'Invoice on its way'
                : 'Empty'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inquiry list"
            className="-mr-2 p-2 text-white/55 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── SUCCESS ─────────────────────────────────────────────────── */}
        {submit.kind === 'success' ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full border"
              style={{ borderColor: 'rgba(120,210,255,0.4)', boxShadow: '0 0 18px rgba(100,200,255,0.25)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(150,220,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <p className="mt-5 text-[14px] tracking-tight text-white">Inquiry received.</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-white/50 max-w-[30ch]">
              We'll email your invoice to{' '}
              <span className="text-holo-light">{submit.email}</span> shortly.
            </p>
            {submit.reference && (
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                Ref · {submit.reference}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-full border border-white/15 px-6 py-2 text-[10px] uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
            >
              Done
            </button>
          </div>
        ) : view === 'form' ? (
          /* ── FORM ──────────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-5 py-5">
            <p className="text-[12px] leading-relaxed text-white/50">
              Enter your details and we'll email an invoice for{' '}
              {itemCount} item{itemCount === 1 ? '' : 's'}.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="cart-name" className="block text-[10px] uppercase tracking-[0.2em] text-white/50 mb-1.5">
                  Name
                </label>
                <input
                  id="cart-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded-sm border border-white/10 bg-black px-3 py-2.5 text-[13px] text-white placeholder-white/30 focus:border-white/40 focus:outline-none transition-colors"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label htmlFor="cart-email" className="block text-[10px] uppercase tracking-[0.2em] text-white/50 mb-1.5">
                  Email
                </label>
                <input
                  id="cart-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full rounded-sm border border-white/10 bg-black px-3 py-2.5 text-[13px] text-white placeholder-white/30 focus:border-white/40 focus:outline-none transition-colors"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {submit.kind === 'error' && (
              <p role="alert" className="mt-4 text-[11px] text-red-400">
                {submit.message}
              </p>
            )}

            <div className="mt-auto pt-6">
              <button
                type="submit"
                disabled={formInvalid || submit.kind === 'submitting'}
                className="cta-mint group relative flex w-full items-center justify-center overflow-hidden rounded-full px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-black disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
              >
                <span aria-hidden="true" className="cta-mint-sheen pointer-events-none absolute inset-0" />
                <span className="relative">
                  {submit.kind === 'submitting' ? 'Sending…' : 'Send & Email Invoice'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView('list');
                  setSubmit({ kind: 'idle' });
                }}
                className="mt-2 w-full text-center text-[10px] uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors focus:outline-none"
              >
                ← Back to items
              </button>
            </div>
          </form>
        ) : (
          /* ── LIST ──────────────────────────────────────────────────── */
          <>
            <div className="flex-1 overflow-y-auto px-2 py-3">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
                  <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/30">
                    No items
                  </p>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-white/45 max-w-[28ch]">
                    Add inventory from any product page to start an inquiry.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {items.map((item) => {
                    const imageUrl = item.product.images?.[0] ?? null;
                    const atMax = item.quantity >= MAX_QTY;
                    return (
                      <li
                        key={item.product.id}
                        className="flex items-center gap-3 px-3 py-3 border-b border-white/[0.05] last:border-b-0"
                      >
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[3px] border border-white/[0.09] bg-[#050505]">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.product.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-widest text-white/20">
                              No img
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] tracking-tight text-white/85">
                            {item.product.name}
                          </p>
                          <p className="mt-0.5 truncate">
                            <SKUCode value={item.product.sku} className="text-white/35" />
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                              aria-label="Decrease quantity"
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
                            >
                              −
                            </button>
                            <span className="w-5 text-center text-[12.5px] tabular-nums text-white" aria-live="polite">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                              disabled={atMax}
                              aria-label="Increase quantity"
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(item.product.id)}
                              aria-label={`Remove ${item.product.name}`}
                              className="ml-auto text-[9px] uppercase tracking-[0.2em] text-white/35 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer — continue to the details step */}
            <div className="border-t border-white/[0.06] px-5 py-3">
              <button
                type="button"
                onClick={() => setView('form')}
                disabled={items.length === 0}
                className="cta-mint group relative flex w-full items-center justify-center overflow-hidden rounded-full px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-black disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
              >
                <span aria-hidden="true" className="cta-mint-sheen pointer-events-none absolute inset-0" />
                <span className="relative">Review &amp; Send Inquiry</span>
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
