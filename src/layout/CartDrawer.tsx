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
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useScrollLock } from '../lib/useScrollLock';
import { supabase } from '../lib/supabase';
import { SKUCode } from '../components/ui/identifiers';
import { lineUnitCents, lineIsFast, cartHasMixedShipping } from '../lib/cartActions';
import { useProductOverrides } from '../lib/productOverrides';
import { placeOrder } from '../lib/placeOrder';
import { formatUsd } from '../lib/payment';
import { Turnstile } from '../components/security/Turnstile';

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
  // Subscribe so prices + FAST/standard badges re-render when overrides load.
  useProductOverrides((s) => s.variantBySku);
  const itemCount = useCart((s) => s.itemCount());
  const updateQuantity = useCart((s) => s.updateQuantity);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);

  const [view, setView] = useState<View>('list');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [zip, setZip] = useState('');
  const [human, setHuman] = useState(false);
  const [tsToken, setTsToken] = useState<string | null>(null);
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

  // Body scroll lock while open (ref-counted; overflow:hidden preserves position)
  useScrollLock(open);

  // Reset to the list step shortly after the drawer closes.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setView('list');
      setSubmit({ kind: 'idle' });
    }, 300);
    return () => clearTimeout(t);
  }, [open]);

  const emailValid = /.+@.+\..+/.test(email.trim());
  const formInvalid =
    firstName.trim().length === 0 ||
    lastName.trim().length === 0 ||
    !emailValid ||
    street.trim().length === 0 ||
    city.trim().length === 0 ||
    stateRegion.trim().length === 0 ||
    zip.trim().length === 0 ||
    !human ||
    !tsToken ||
    items.length === 0;

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
      name: `${firstName.trim()} ${lastName.trim()}`,
      contact: email.trim(),
      ship_street: street.trim(),
      ship_city: city.trim(),
      ship_state: stateRegion.trim(),
      ship_zip: zip.trim(),
      ship_country: 'US',
      turnstile_token: tsToken ?? undefined,
      items: items.map((i) => ({
        product: {
          id: i.product.id,
          name: i.product.name,
          category: i.product.category,
          sku: i.product.sku,
        },
        quantity: i.quantity,
        note: i.note?.trim() || undefined,
        // Same resolver the cart display uses (lib/cartActions.lineUnitCents).
        unitPriceCents: lineUnitCents(i),
        // FAST vs standard ship — carried into the emails so labels match.
        fast: lineIsFast(i),
      })),
    };

    const outcome = await placeOrder(payload);

    if (!outcome.ok) {
      setSubmit({ kind: 'error', message: outcome.message });
      return;
    }

    const reference = outcome.data.orderNumber;
    const sentEmail = email.trim();
    clear();
    setFirstName('');
    setLastName('');
    setEmail('');
    setStreet('');
    setCity('');
    setStateRegion('');
    setZip('');
    setHuman(false);
    setTsToken(null);
    setSubmit({ kind: 'success', email: sentEmail, reference });
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-ink/65 backdrop-blur-[2px] transition-opacity duration-300 ${
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
          backgroundColor: 'var(--color-surface-elevated)',
          borderLeft: '1px solid rgba(26, 23, 20, 0.12)',
          boxShadow: '-24px 0 60px -20px rgba(26,23,20,0.25)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* Header — identity + close */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/[0.06]">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.3em] text-holo-light/70">
              {submit.kind === 'success'
                ? 'Inquiry Filed'
                : view === 'form'
                ? 'Buyer Details'
                : 'Inquiry List'}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-ink/35">
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
            className="-mr-2 p-2 text-ink/55 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 rounded-sm"
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
              style={{ borderColor: 'rgba(140, 144, 148,0.4)', boxShadow: '0 0 18px rgba(140, 144, 148,0.25)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(140,144,148,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <p className="mt-5 text-[14px] tracking-tight text-ink">Inquiry received.</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink/50 max-w-[30ch]">
              We'll email your invoice to{' '}
              <span className="text-holo-light">{submit.email}</span> shortly.
            </p>
            {submit.reference && (
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/35">
                Ref · {submit.reference}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-full border border-ink/15 px-6 py-2 text-[10px] uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            >
              Done
            </button>
          </div>
        ) : view === 'form' ? (
          /* ── FORM ──────────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-5 py-5">
            <p className="text-[12px] leading-relaxed text-ink/50">
              Enter your details and we'll email an invoice for{' '}
              {itemCount} item{itemCount === 1 ? '' : 's'}.
            </p>

            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cart-first" className="block text-[10px] uppercase tracking-[0.2em] text-ink/50 mb-1.5">
                    First name *
                  </label>
                  <input
                    id="cart-first"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                    className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors"
                    placeholder="First"
                  />
                </div>
                <div>
                  <label htmlFor="cart-last" className="block text-[10px] uppercase tracking-[0.2em] text-ink/50 mb-1.5">
                    Last name *
                  </label>
                  <input
                    id="cart-last"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                    className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors"
                    placeholder="Last"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="cart-email" className="block text-[10px] uppercase tracking-[0.2em] text-ink/50 mb-1.5">
                  Email *
                </label>
                <input
                  id="cart-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="cart-street" className="block text-[10px] uppercase tracking-[0.2em] text-ink/50 mb-1.5">
                  Shipping address *
                </label>
                <input
                  id="cart-street"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  autoComplete="street-address"
                  required
                  className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors mb-2"
                  placeholder="Street address"
                />
                <div className="grid grid-cols-[1fr_70px_90px] gap-2">
                  <input
                    aria-label="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    autoComplete="address-level2"
                    required
                    className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors"
                    placeholder="City"
                  />
                  <input
                    aria-label="State"
                    value={stateRegion}
                    onChange={(e) => setStateRegion(e.target.value)}
                    autoComplete="address-level1"
                    required
                    maxLength={3}
                    className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors uppercase"
                    placeholder="ST"
                  />
                  <input
                    aria-label="ZIP code"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    autoComplete="postal-code"
                    inputMode="numeric"
                    required
                    className="w-full rounded-sm border border-ink/10 bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 focus:border-ink/40 focus:outline-none transition-colors"
                    placeholder="ZIP"
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-ink/40">The ZIP is how you’ll look up your order at <span className="font-mono">/track</span>.</p>
              </div>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={human}
                  onChange={(e) => setHuman(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ accentColor: '#868A90' }}
                />
                <span className="text-[11px] leading-relaxed text-ink/55">
                  I confirm I'm a real person acquiring these materials for legitimate research use.
                </span>
              </label>
            </div>

            {/* B2B note */}
            <div className="mt-4 rounded-md border border-ink/[0.09] bg-ink/[0.03] px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-ink/55">
                <span className="font-medium text-ink/80">We're primarily a B2B research lab</span> — labs &amp; clinics get volume pricing.{' '}
                <Link to="/contact" onClick={onClose} className="text-holo underline underline-offset-2 hover:opacity-80">
                  Find out more →
                </Link>
              </p>
            </div>

            {submit.kind === 'error' && (
              <p role="alert" className="mt-4 text-[11px] text-red-400">
                {submit.message}
              </p>
            )}

            <div className="mt-4">
              <Turnstile onToken={setTsToken} />
            </div>

            <div className="mt-auto pt-4">
              <button
                type="submit"
                disabled={formInvalid || submit.kind === 'submitting'}
                className="cta-mint group relative flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2 text-[9.5px] font-medium uppercase tracking-[0.2em] text-ink disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base-900"
              >
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
                className="mt-2 w-full text-center text-[10px] uppercase tracking-[0.2em] text-ink/40 hover:text-ink transition-colors focus:outline-none"
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
                  <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-ink/30">
                    No items
                  </p>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink/45 max-w-[28ch]">
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
                        className="flex items-center gap-3 px-3 py-3 border-b border-ink/[0.05] last:border-b-0"
                      >
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[3px] border border-ink/[0.09] bg-display">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.product.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-widest text-ink/20">
                              No img
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] tracking-tight text-ink/85">
                            {item.product.name}
                          </p>
                          <p className="mt-0.5 truncate">
                            <SKUCode value={item.product.sku} className="text-ink/35" />
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/60">
                            {formatUsd(lineUnitCents(item))}
                            {item.quantity > 1 && (
                              <span className="text-ink/35">
                                {' '}× {item.quantity} ={' '}
                                <span className="text-ink/75">{formatUsd(lineUnitCents(item) * item.quantity)}</span>
                              </span>
                            )}
                          </p>
                          <p className="mt-1">
                            {lineIsFast(item) ? (
                              <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] px-1 py-0.5 rounded-[3px]" style={{ color: '#2E7D5B', backgroundColor: 'rgba(46,125,91,0.10)', border: '1px solid rgba(46,125,91,0.30)' }}>⚡ Fast</span>
                            ) : (
                              <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] px-1 py-0.5 rounded-[3px]" style={{ color: 'rgba(26,23,20,0.50)', backgroundColor: 'rgba(26,23,20,0.04)', border: '1px solid rgba(26,23,20,0.12)' }}>Standard</span>
                            )}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                              aria-label="Decrease quantity"
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-ink/15 text-ink/70 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                            >
                              −
                            </button>
                            <span className="w-5 text-center text-[12.5px] tabular-nums text-ink" aria-live="polite">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                              disabled={atMax}
                              aria-label="Increase quantity"
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-ink/15 text-ink/70 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(item.product.id)}
                              aria-label={`Remove ${item.product.name}`}
                              className="ml-auto text-[9px] uppercase tracking-[0.2em] text-ink/35 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
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
            <div className="border-t border-ink/[0.06] px-5 py-3">
              {cartHasMixedShipping(items) && (
                <div
                  className="mb-2.5 flex items-start gap-1.5 rounded-[5px] px-2.5 py-2"
                  style={{ backgroundColor: 'rgba(214,158,46,0.10)', border: '1px solid rgba(214,158,46,0.40)' }}
                  role="note"
                >
                  <span aria-hidden="true" className="text-[11px] leading-none mt-0.5">⚡</span>
                  <p className="text-[10px] leading-relaxed text-ink/75">
                    Fast-ship + standard items may arrive in <span className="font-medium">separate shipments</span> — <span className="font-medium">no extra charge</span>.
                  </p>
                </div>
              )}
              {items.length > 0 && (
                <div className="mb-2.5 flex items-baseline justify-between">
                  <span className="text-[9px] uppercase tracking-[0.25em] text-ink/45">Subtotal</span>
                  <span className="font-mono text-[12.5px] tabular-nums text-ink">
                    {formatUsd(items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0))}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setView('form')}
                disabled={items.length === 0}
                className="cta-mint group relative flex w-full items-center justify-center overflow-hidden rounded-full px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ink disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base-900"
              >
                <span className="relative">Review &amp; Send Inquiry</span>
              </button>
            </div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}
