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
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../lib/useScrollLock';
import { supabase } from '../lib/supabase';
import { SKUCode } from '../components/ui/identifiers';
import { lineUnitCents, lineIsFast, cartHasMixedShipping } from '../lib/cartActions';
import { shippingCentsFor } from '../lib/shipping';
import { useCustomerAuth } from '../lib/customerAuth';
import { useProductOverrides } from '../lib/productOverrides';
import { placeOrder } from '../lib/placeOrder';
import { orderAttestationPayload } from '../lib/researchAttestation';
import { formatUsd } from '../lib/payment';
import { Turnstile } from '../components/security/Turnstile';
import { PromoCode, submittableCouponCodes } from '../components/cart/PromoCode';
import { couponBreakdown, type AccountDiscountPreview } from '../lib/coupons';
import { fetchMyAccountDiscount } from '../lib/accountDiscount';
import { FIELD_DEFAULT } from '../components/ui/Field';

const MAX_QTY = 999;

// Compact sibling of Field.tsx's FIELD_SURFACE — same border/focus-ring
// grammar, tighter padding for the drawer's narrower column.
const DRAWER_FIELD_SURFACE =
  'w-full rounded-field border bg-base-700 px-3 py-2.5 text-[13px] text-ink placeholder-ink/30 shadow-[inset_0_1px_2px_rgba(26,23,20,0.035)] focus:outline-none transition-[border-color,box-shadow] duration-150';

/* Per-line reveal — while the drawer is open, each cart line joins the
   staggered cascade (`.drawer-reveal` + inline --drawer-delay, see theme.css).
   Closed → nothing, so reopening replays the cascade. Reduced-motion flattens
   it to a plain present state. */
function lineReveal(open: boolean, delay: number) {
  return open
    ? { className: 'drawer-reveal', style: { '--drawer-delay': `${delay}ms` } as React.CSSProperties }
    : { className: '', style: undefined };
}

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
  // Wholesale is account-gated: only a signed-in buyer's pack lines count as
  // wholesale (7–10 day, never ⚡24hr) — mirrors place-order's server gate.
  const { user } = useCustomerAuth();
  const isMember = !!user;
  // Subscribe so prices + FAST/standard badges re-render when overrides load.
  useProductOverrides((s) => s.variantBySku);
  const itemCount = useCart((s) => s.itemCount());
  const updateQuantity = useCart((s) => s.updateQuantity);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const coupons = useCart((s) => s.coupons);

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

  // Modality enforcement — the panel declares aria-modal, so Tab must not walk
  // out into the page behind the scrim. Also restores focus to the header cart
  // button on close.
  const panelRef = useFocusTrap<HTMLElement>(open);

  // Signed-in account discount (lifetime/business) — PREVIEW only; place-order
  // re-resolves and applies it authoritatively server-side. Guests → null.
  const [accountDiscount, setAccountDiscount] = useState<AccountDiscountPreview | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchMyAccountDiscount().then((d) => {
      if (!cancelled) setAccountDiscount(d);
    });
    return () => {
      cancelled = true;
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

    const subtotalCents = items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0);
    const payload = {
      name: `${firstName.trim()} ${lastName.trim()}`,
      contact: email.trim(),
      ship_street: street.trim(),
      ship_city: city.trim(),
      ship_state: stateRegion.trim(),
      ship_zip: zip.trim(),
      ship_country: 'US',
      turnstile_token: tsToken ?? undefined,
      // Research-use disclaimer acceptance (21+/research-only/industry) from
      // the entry gate — stored on the order as the compliance audit trail.
      research_attestation: orderAttestationPayload(),
      // Only the CODES travel — the server re-validates and prices each,
      // stacks them (additive, capped at subtotal), and adds any free items.
      coupon_codes: submittableCouponCodes(subtotalCents),
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
        fast: lineIsFast(i, isMember),
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
      {/* Backdrop — deeper blur pulls focus onto the panel; opacity trails the
          slide slightly for a layered open. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-[color:var(--scrim)] backdrop-blur-[6px] transition-opacity duration-[420ms] ease-out ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel — glass chrome, inner edge rounded so it reads as a
          floating module, and a weighted decelerate slide (settles, never
          bounces). Enter slower than exit; reduced-motion zeroes both. */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Inquiry list"
        // Closed, the panel stays mounted and merely slides off-screen — so
        // without `inert` its buttons remain tabbable and a keyboard user
        // walks into invisible controls. `inert` also drops it from the a11y
        // tree, which `translateX` alone never did.
        inert={!open}
        className="glass-panel fixed top-0 right-0 z-[60] flex h-[100dvh] w-[344px] max-w-[90vw] sm:w-[388px] flex-col rounded-l-[22px] overflow-hidden"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: open
            ? 'transform 480ms cubic-bezier(0.32, 0.72, 0, 1)'
            : 'transform 320ms cubic-bezier(0.4, 0, 0.7, 1)',
          boxShadow: 'var(--glass-highlight), -28px 0 64px -24px rgba(26,23,20,0.4), var(--elev-3)',
        }}
      >
        {/* Header — identity + close */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-ink/[0.07]">
          <div className="flex flex-col gap-1.5">
            <span className="font-serif text-[21px] leading-none tracking-[-0.01em] text-ink">
              {submit.kind === 'success'
                ? 'Inquiry filed'
                : view === 'form'
                ? 'Buyer details'
                : 'Inquiry'}
            </span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-[1.5px] w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: 'var(--color-accent-gold)' }}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45 tabular-nums">
                {itemCount > 0
                  ? `${itemCount} item${itemCount === 1 ? '' : 's'}`
                  : submit.kind === 'success'
                  ? 'Invoice on its way'
                  : 'Empty'}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inquiry list"
            className="-mr-1.5 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/50 hover:text-ink hover:bg-ink/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── SUCCESS ─────────────────────────────────────────────────── */}
        {submit.kind === 'success' ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            {/* Gold check seated in a soft ring — no glow (retired register) */}
            <span
              aria-hidden="true"
              className="grid h-16 w-16 place-items-center rounded-full border border-gold/30 bg-gold/[0.07]"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full" style={{ backgroundColor: 'var(--color-accent-gold)' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16130F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </span>
            <p className="mt-6 font-serif text-[19px] leading-tight tracking-[-0.01em] text-ink">Inquiry received</p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-ink/55 max-w-[32ch]">
              We'll email your invoice to{' '}
              <span className="text-ink">{submit.email}</span> shortly.
            </p>
            {submit.reference && (
              <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40 tabular-nums">
                Ref · {submit.reference}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-9 min-h-[44px] rounded-full border border-ink/15 px-8 text-[11px] uppercase tracking-[0.22em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
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
                    className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
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
                    className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
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
                  className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
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
                  className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT, 'mb-2'].join(' ')}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-[1fr_70px_90px] gap-2">
                  <input
                    aria-label="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    autoComplete="address-level2"
                    required
                    className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
                    placeholder="City"
                  />
                  <input
                    aria-label="State"
                    value={stateRegion}
                    onChange={(e) => setStateRegion(e.target.value)}
                    autoComplete="address-level1"
                    required
                    maxLength={3}
                    className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT, 'uppercase'].join(' ')}
                    placeholder="ST"
                  />
                  <input
                    aria-label="ZIP code"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    autoComplete="postal-code"
                    inputMode="numeric"
                    required
                    className={[DRAWER_FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
                    placeholder="ZIP"
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-ink/40">The ZIP is how you’ll look up your order at <span className="font-mono">/track</span>.</p>
              </div>
              <label className="flex min-h-[40px] items-start gap-2 py-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={human}
                  onChange={(e) => setHuman(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-accent-gold)]"
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

            {/* overflow-hidden absorbs Turnstile's 300px minimum width on the
                narrowest phones (column is ~297px at a 375px viewport). */}
            <div className="mt-4 overflow-hidden">
              <Turnstile onToken={setTsToken} className="w-full" />
            </div>

            <div className="mt-auto pt-4">
              <button
                type="submit"
                disabled={formInvalid || submit.kind === 'submitting'}
                className="cta-mint group relative flex min-h-[52px] w-full items-center justify-center overflow-hidden rounded-full px-4 text-[11px] font-medium uppercase tracking-[0.2em] text-ink transition-transform motion-safe:active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
              >
                {submit.kind === 'submitting' ? 'Sending…' : 'Send & Email Invoice'}
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
            <div className="flex-1 overflow-y-auto px-3 py-4">
              {items.length === 0 ? (
                /* Empty state with character — a specimen vial resting in a
                   soft display well, an editorial line, and a quiet way in. */
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <span
                    aria-hidden="true"
                    className="grid h-20 w-20 place-items-center rounded-[20px] border border-ink/[0.08] bg-ink/[0.03] shadow-[inset_0_1px_2px_rgba(26,23,20,0.05)]"
                  >
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-content-tertiary)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 2h6" />
                      <path d="M10 2v4.6L6.2 15a2.2 2.2 0 0 0 2 3.1h7.6a2.2 2.2 0 0 0 2-3.1L14 6.6V2" />
                      <path d="M7.4 12h9.2" />
                    </svg>
                  </span>
                  <p className="mt-6 font-serif text-[19px] leading-tight tracking-[-0.01em] text-ink">
                    Your inquiry is empty
                  </p>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink/50 max-w-[30ch]">
                    Add compounds from any product page and they'll gather here for a single quoted inquiry.
                  </p>
                  <Link
                    to="/research-supplies"
                    onClick={onClose}
                    className="mt-7 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-ink/15 px-6 text-[11px] uppercase tracking-[0.2em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
                  >
                    Browse compounds
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {items.map((item, i) => {
                    const imageUrl = item.product.images?.[0] ?? null;
                    const atMax = item.quantity >= MAX_QTY;
                    const reveal = lineReveal(open, 120 + i * 55);
                    return (
                      <li
                        key={item.product.id}
                        {...reveal}
                        className={`group flex items-start gap-3.5 rounded-[16px] border border-ink/[0.07] bg-[color:var(--surface-product)] p-3 transition-[border-color,box-shadow] duration-200 hover:border-ink/[0.12] hover:shadow-[var(--surface-highlight),var(--elev-1)] ${reveal.className}`}
                      >
                        <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-[12px] border border-ink/[0.09] bg-display shadow-[inset_0_1px_2px_rgba(26,23,20,0.05)]">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.product.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-widest text-ink/20">
                              No img
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* Name + line total on one baseline */}
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="truncate text-[14px] font-medium tracking-[-0.01em] text-ink">
                              {item.product.name}
                            </p>
                            <p className="shrink-0 font-mono text-[14px] tabular-nums text-ink">
                              {formatUsd(lineUnitCents(item) * item.quantity)}
                            </p>
                          </div>
                          {/* SKU + ship class, one quiet meta line */}
                          <p className="mt-1.5 flex items-center gap-2 truncate">
                            <SKUCode value={item.product.sku} className="text-[10px] text-ink/40" />
                            {lineIsFast(item, isMember) ? (
                              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-[1px] rounded-full text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)] border border-[color:var(--color-status-success)]/25">
                                ⚡ 24 hr
                              </span>
                            ) : null}
                          </p>
                          {item.quantity > 1 && (
                            <p className="mt-1 font-mono text-[10.5px] tabular-nums text-ink/40">
                              {formatUsd(lineUnitCents(item))} each
                            </p>
                          )}
                          {/* Controls: segmented stepper (press feedback) + icon remove */}
                          <div className="mt-3 flex items-center gap-2">
                            <div className="inline-flex items-center rounded-full border border-ink/[0.14] bg-ink/[0.03]">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                aria-label="Decrease quantity"
                                className="grid h-9 w-9 place-items-center rounded-l-full text-[15px] text-ink/60 hover:text-ink hover:bg-ink/[0.05] transition-[color,background-color,transform] motion-safe:active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                              >
                                −
                              </button>
                              <span className="w-9 text-center text-[13px] tabular-nums text-ink border-x border-ink/[0.09]" aria-live="polite">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                disabled={atMax}
                                aria-label="Increase quantity"
                                className="grid h-9 w-9 place-items-center rounded-r-full text-[15px] text-ink/60 hover:text-ink hover:bg-ink/[0.05] transition-[color,background-color,transform] motion-safe:active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => remove(item.product.id)}
                              aria-label={`Remove ${item.product.name}`}
                              title="Remove"
                              className="ml-auto grid h-9 w-9 place-items-center rounded-full text-ink/35 hover:text-[color:var(--color-status-error)] hover:bg-[color:var(--color-status-errorMuted)] transition-colors motion-safe:active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer — order summary + continue to the details step. Hidden
                entirely when empty so the empty state (with its own CTA) owns
                the panel; no redundant disabled button. */}
            {items.length > 0 && (
            <div className="border-t border-ink/[0.07] px-6 pt-4 pb-5" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
              {cartHasMixedShipping(items, isMember) && (
                <div
                  className="mb-3 flex items-start gap-2 rounded-[12px] border border-gold/30 bg-gold/[0.07] px-3 py-2.5"
                  role="note"
                >
                  <span aria-hidden="true" className="text-[12px] leading-none mt-px">⚡</span>
                  <p className="text-[10.5px] leading-relaxed text-ink/70">
                    24-hour-shipping + standard items may arrive in <span className="font-medium text-ink/85">separate shipments</span> — <span className="font-medium text-ink/85">no extra charge</span>.
                  </p>
                </div>
              )}
              {items.length > 0 && (() => {
                const subtotalCents = items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0);
                const breakdown = accountDiscount
                  ? couponBreakdown(coupons, subtotalCents, items, accountDiscount)
                  : null;
                const hasAccountDisc = !!breakdown && breakdown.accountCents > 0;
                // Shipping rides on top of the discounted subtotal — mirrors
                // place-order, which recomputes it from the verified session.
                const shippingCents = shippingCentsFor(isMember);
                const totalCents = (hasAccountDisc
                  ? Math.max(subtotalCents - breakdown!.total, 0)
                  : subtotalCents) + shippingCents;
                return (
                  <>
                    {/* Subtotal + account perk — quiet rows above the anchor total */}
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-ink/45">Subtotal</span>
                      <span className="font-mono text-[13px] tabular-nums text-ink/70">
                        {formatUsd(subtotalCents)}
                      </span>
                    </div>
                    <PromoCode variant="drawer" subtotalCents={subtotalCents} />
                    {hasAccountDisc && (
                      <div className="mb-3 flex items-baseline justify-between">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-ink/45">
                          {accountDiscount!.label}
                        </span>
                        <span className="font-mono text-[13px] tabular-nums text-[color:var(--color-status-success)]">
                          −{formatUsd(breakdown!.accountCents)}
                        </span>
                      </div>
                    )}
                    {/* Shipping — members ship free; guests pay the flat fee and
                        get a one-tap path to waive it. */}
                    <div className="mb-3 flex items-baseline justify-between">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-ink/45">Shipping</span>
                      <span className="font-mono text-[13px] tabular-nums text-ink/70">
                        {isMember ? 'Free — member' : formatUsd(shippingCents)}
                      </span>
                    </div>
                    {!isMember && (
                      <p className="-mt-1.5 mb-3 text-[11px] leading-relaxed text-ink/45">
                        <Link
                          to="/account?mode=signup"
                          onClick={onClose}
                          className="font-medium text-ink underline decoration-ink/30 underline-offset-2 transition-colors hover:decoration-ink"
                        >
                          Create a free profile
                        </Link>{' '}
                        and we'll waive this — members always ship free and unlock wholesale case
                        pricing. Your cart stays as it is.
                      </p>
                    )}
                    {/* Total — the anchor. A hairline separates it from the line
                        items above; the figure is the largest number on screen. */}
                    <div className="mb-4 flex items-baseline justify-between border-t border-ink/[0.08] pt-3.5">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-ink/60">Total</span>
                      <span className="font-mono text-[19px] tabular-nums text-ink">
                        {formatUsd(totalCents)}
                      </span>
                    </div>
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => setView('form')}
                disabled={items.length === 0}
                className="cta-mint group relative flex min-h-[52px] w-full items-center justify-center overflow-hidden rounded-full px-5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink transition-transform motion-safe:active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
              >
                Review &amp; Send Inquiry
              </button>
            </div>
            )}
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}
