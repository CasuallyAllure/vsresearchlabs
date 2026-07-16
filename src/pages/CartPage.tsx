/**
 * CartPage (Inquiry List)
 * Phase 3 — Inquiry flow polish.
 * Wave 4 — Module composition (items + form columns).
 * Reconciliation Pass D — Procurement intake alignment.
 *
 * The itemized procurement intake surface. Reconciled into the same
 * institutional register as /catalog and the documentation library:
 * the form reads as a procurement intake document, not a contact
 * form. Three procurement section headings group the inputs (Buyer
 * Identification / Organization or Lab / Procurement Notes) and the
 * items column is labeled Requested Inventory.
 *
 * Surface posture: the form column is now a Level 1 solid surface
 * (was Level 3 glass in Wave 4). Removing the glass aligns with the
 * editorial restraint established by Passes A–C and reduces the
 * page's only remaining glass surface to zero.
 *
 * Submission contract is unchanged: { name, contact, notes, items }.
 * The optional Organization input merges into `notes` client-side
 * before submit so the supabase send-inquiry function receives the
 * exact same payload shape it has always received.
 *
 * Phase 2 invariants preserved: hairline grammar, no blur, validation
 * behavior (touched + empty), accessibility (labels, aria-invalid,
 * aria-describedby, aria-live).
 */

import { useEffect, useState } from 'react';
import { Turnstile } from '../components/security/Turnstile';
import { Link } from 'react-router-dom';
import { BrandStamp } from '../components/brand/BrandStamp';
import { useCart } from '../hooks/useCart';
import { supabase } from '../lib/supabase';
import { SKUCode } from '../components/ui/identifiers';
import { FIELD_SURFACE, FIELD_DEFAULT, FIELD_ERROR } from '../components/ui/Field';
import { generateInquiryRecord } from '../lib/inquiry';
import type { InquiryRecord, InquiryServerData } from '../lib/inquiry';
import { lineUnitCents, lineIsFast, cartHasMixedShipping } from '../lib/cartActions';
import { GUEST_SHIPPING_CENTS } from '../lib/shipping';
import { useCustomerAuth } from '../lib/customerAuth';
import { useProductOverrides } from '../lib/productOverrides';
import { placeOrder } from '../lib/placeOrder';
import { orderAttestationPayload } from '../lib/researchAttestation';
import { PaymentInstructions } from '../components/order/PaymentInstructions';
import { formatUsd } from '../lib/payment';
import { PromoCode, submittableCouponCodes } from '../components/cart/PromoCode';
import { couponBreakdown, type AccountDiscountPreview } from '../lib/coupons';
import { fetchMyAccountDiscount } from '../lib/accountDiscount';
import { siteConfig } from '../config';

interface OrderResult {
  orderNumber: string;
  amountCents: number;
  invoiceEmailSent: boolean;
  contact: string;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const MAX_QTY = 999;

export function CartPage() {
  const items = useCart((s) => s.items);
  // Wholesale is account-gated: only a signed-in buyer's pack lines count as
  // wholesale (7–10 day, never ⚡24hr) — mirrors place-order's server gate.
  const { user } = useCustomerAuth();
  const isMember = !!user;
  // Subscribe to variant overrides so prices + FAST/standard ship badges
  // re-render once the store finishes loading (e.g. on a direct /cart load).
  useProductOverrides((s) => s.variantBySku);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const setItemNote = useCart((s) => s.setItemNote);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const coupons = useCart((s) => s.coupons);

  // Signed-in account discount (lifetime/business) — PREVIEW only; place-order
  // re-resolves and applies it authoritatively server-side. Guests → null.
  const [accountDiscount, setAccountDiscount] = useState<AccountDiscountPreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchMyAccountDiscount().then((d) => {
      if (!cancelled) setAccountDiscount(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [organization, setOrganization] = useState('');
  const [shipStreet, setShipStreet] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipState, setShipState] = useState('');
  const [shipZip, setShipZip] = useState('');
  const [notes, setNotes] = useState('');
  const [tsToken, setTsToken] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });
  const [record, setRecord] = useState<InquiryRecord | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);

  // Field-level validation tracking. We only show errors after a field
  // has been touched (blur) so users aren't yelled at on first paint.
  const [touched, setTouched] = useState<{ name: boolean; contact: boolean }>({
    name: false,
    contact: false,
  });

  // Track which items have their note editor open. The note value itself
  // lives in the cart store via setItemNote.
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  const nameEmpty = name.trim().length === 0;
  const contactEmpty = contact.trim().length === 0;
  const showNameError = touched.name && nameEmpty;
  const showContactError = touched.contact && contactEmpty;

  const formInvalid = nameEmpty || contactEmpty || !tsToken || items.length === 0;

  function toggleNote(productId: string) {
    setNotesOpen((prev) => ({ ...prev, [productId]: !prev[productId] }));
  }

  function handleIncrement(productId: string, current: number) {
    if (current >= MAX_QTY) return;
    updateQuantity(productId, current + 1);
  }

  function handleDecrement(productId: string, current: number) {
    // updateQuantity with quantity ≤ 0 removes the item. So a single
    // click on − at qty=1 removes the row, per spec.
    updateQuantity(productId, current - 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formInvalid || submit.kind === 'submitting') return;

    setSubmit({ kind: 'submitting' });

    if (!supabase) {
      setSubmit({
        kind: 'error',
        message: 'Ordering service is not configured. Please try again later.',
      });
      return;
    }

    const orgTrim   = organization.trim();
    const notesTrim = notes.trim();
    const contactTrim = contact.trim();

    const subtotalCents = items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0);
    const payload = {
      name:         name.trim(),
      contact:      contactTrim,
      organization: orgTrim || undefined,
      notes:        notesTrim || undefined,
      ship_street:  shipStreet.trim() || undefined,
      ship_city:    shipCity.trim() || undefined,
      ship_state:   shipState.trim() || undefined,
      ship_zip:     shipZip.trim() || undefined,
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
          id:       i.product.id,
          name:     i.product.name,
          category: i.product.category,
          sku:      i.product.sku,
        },
        quantity: i.quantity,
        note: i.note?.trim() || undefined,
        // Same resolver the cart display uses (lib/cartActions.lineUnitCents):
        // (sku, dose) admin override → captured priceCents → 0.
        unitPriceCents: lineUnitCents(i),
        // FAST = reachable from shelf/in-transit; standard = drop-ship warehouse.
        // Carried into the invoice + business emails so labels match the cart.
        fast: lineIsFast(i, isMember),
      })),
    };

    const outcome = await placeOrder(payload);

    if (!outcome.ok) {
      setSubmit({ kind: 'error', message: outcome.message });
      return;
    }

    // Server-authoritative order data.
    const serverResp = outcome.data;

    if (!serverResp.orderNumber) {
      setSubmit({
        kind: 'error',
        message: 'Order placed but no order number was returned. Contact us to confirm.',
      });
      return;
    }

    // Build the receipt record (uses the order number as the identifier).
    const server: InquiryServerData = {
      referenceId:          serverResp.orderNumber,
      submittedAt:          serverResp.createdAt ?? new Date().toISOString(),
      intakeChannel:        siteConfig.order.intakeChannel,
      processingNode:       siteConfig.order.processingNode,
      classificationStatus: 'INVOICE SENT',
    };

    // Capture snapshot before clearing — items are gone after clear().
    const generatedRecord = generateInquiryRecord(
      {
        name:         name.trim(),
        contact:      contactTrim,
        organization: organization.trim(),
        items:        [...items],
      },
      server,
    );
    clear();
    setName('');
    setContact('');
    setTsToken(null);
    setOrganization('');
    setNotes('');
    setRecord(generatedRecord);
    setOrder({
      orderNumber:      serverResp.orderNumber,
      amountCents:      serverResp.amountCents ?? 0,
      invoiceEmailSent: serverResp.invoiceEmailSent ?? false,
      contact:          contactTrim,
    });
    setSubmit({ kind: 'success' });
  }

  // ---------------------------------------------------------------------
  // Intake record — filed procurement receipt
  // ---------------------------------------------------------------------
  if (submit.kind === 'success' && record) {
    const ts = record.submittedAt;
    const tsDisplay = `${ts.slice(0, 10)} · ${ts.slice(11, 19)} UTC`;

    return (
      <div className="py-[var(--space-8)] pb-[var(--space-24)] lg:pb-[var(--space-8)]">

        {/* Print-only classification header */}
        <p className="hidden print:block text-[9px] font-mono uppercase tracking-[0.2em] text-ink/35 border-b border-black/10 pb-[var(--space-3)] mb-[var(--space-6)]">
          Uncontrolled Copy · For Buyer Reference Only · Do Not Redistribute
        </p>

        {/* Document header — identifier band */}
        <header className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-ink/[0.06] print:border-black/15">
          {/* Brand stamp — themeable ink (light on screen, dark in print). */}
          <div className="mb-[var(--space-5)] text-ink/85 print:text-black">
            <BrandStamp width={248} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-ink/35 print:text-black/50 mb-[var(--space-4)]">
            {siteConfig.brand.name} · Order Confirmation
          </p>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink/30 print:text-black/45 mb-[var(--space-2)]">
            Order Number
          </p>
          <code className="block text-2xl sm:text-3xl font-mono tabular-nums tracking-[0.04em] text-ink print:text-black">
            {record.referenceId}
          </code>
          <p className="mt-[var(--space-3)] text-[11px] font-mono tabular-nums text-ink/35 print:text-black/50 uppercase tracking-[0.1em]">
            {tsDisplay}
            <span className="ml-[var(--space-4)] text-ink/25 print:text-black/35">
              · {record.itemCount} unit{record.itemCount !== 1 ? 's' : ''}
            </span>
            {order && (
              <span className="ml-[var(--space-4)] text-ink/55 print:text-black/60">
                · Total {formatUsd(order.amountCents)}
              </span>
            )}
          </p>
          {order && (
            <p className="mt-[var(--space-3)] text-[12px] leading-relaxed text-ink/55 print:text-black/65 max-w-[64ch]">
              {order.invoiceEmailSent ? (
                <>An invoice with payment instructions has been emailed to{' '}
                <span className="text-ink/80 print:text-black">{order.contact}</span>. </>
              ) : (
                <>Your order is recorded. </>
              )}
              Follow the payment instructions below and include your order number in the payment note.
            </p>
          )}
        </header>

        {/* Payment instructions — the key call to action */}
        {order && (
          <div className="mb-[var(--space-8)]">
            <PaymentInstructions orderNumber={record.referenceId} amountCents={order.amountCents} />
          </div>
        )}

        {/* Intake record surface */}
        <div className="research-surface-solid p-[var(--space-6)] print:bg-white print:border-black/15 print:rounded-none">

          {/* Buyer */}
          <div className="mb-[var(--space-6)]">
            <p className="text-[10px] uppercase tracking-[0.25em] text-ink/30 print:text-black/50 mb-[var(--space-2)]">
              Buyer
            </p>
            <dl className="border-t border-ink/[0.06] print:border-black/15">
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Name</dt>
                <dd className="text-sm text-ink/80 print:text-black text-right">{record.contactSummary.name}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Contact</dt>
                <dd className="text-sm font-mono tabular-nums text-ink/80 print:text-black text-right">{record.contactSummary.contact}</dd>
              </div>
              {record.contactSummary.organization && (
                <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Institution</dt>
                  <dd className="text-sm text-ink/80 print:text-black text-right">{record.contactSummary.organization}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Requested inventory — tabular summary */}
          <div className="mb-[var(--space-6)]">
            <p className="text-[10px] uppercase tracking-[0.25em] text-ink/30 print:text-black/50 mb-[var(--space-2)]">
              Requested Inventory
              <span className="ml-[var(--space-3)] text-ink/20 print:text-black/30">
                · {record.itemCount} unit{record.itemCount !== 1 ? 's' : ''}
              </span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr className="border-t border-b border-ink/[0.06] print:border-black/15">
                    <th className="py-[var(--space-2)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/25 print:text-black/40 font-normal">
                      SKU
                    </th>
                    <th className="py-[var(--space-2)] text-left text-[10px] uppercase tracking-[0.2em] text-ink/25 print:text-black/40 font-normal pl-[var(--space-4)]">
                      Item
                    </th>
                    <th className="py-[var(--space-2)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/25 print:text-black/40 font-normal w-12">
                      Qty
                    </th>
                    <th className="py-[var(--space-2)] text-right text-[10px] uppercase tracking-[0.2em] text-ink/25 print:text-black/40 font-normal w-20 pl-[var(--space-4)]">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {record.procurementSummary.map((item) => (
                    <tr
                      key={item.sku}
                      className="border-b border-ink/[0.06] print:border-black/10"
                    >
                      <td className="py-[var(--space-3)] align-baseline">
                        <SKUCode value={item.sku} className="text-ink/60 print:text-black/60" />
                      </td>
                      <td className="py-[var(--space-3)] pl-[var(--space-4)] align-baseline text-sm text-ink/75 print:text-black">
                        {item.name}
                      </td>
                      <td className="py-[var(--space-3)] text-right align-baseline text-sm font-mono tabular-nums text-ink/70 print:text-black">
                        {item.quantity}
                      </td>
                      <td className="py-[var(--space-3)] pl-[var(--space-4)] text-right align-baseline text-[10px] font-mono uppercase tracking-[0.1em] text-ink/35 print:text-black/40 print:text-left">
                        <span className="print:hidden">{item.note ? 'Attached' : '—'}</span>
                        <span className="hidden print:inline text-[9px] font-sans font-normal normal-case tracking-normal text-ink/55 leading-relaxed">
                          {item.note || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Operational status */}
          <div className="pt-[var(--space-4)] border-t border-ink/[0.06] print:border-black/15">
            <p className="text-[10px] uppercase tracking-[0.25em] text-ink/30 print:text-black/50 mb-[var(--space-2)]">
              Operational Status
            </p>
            <dl className="border-t border-ink/[0.06] print:border-black/15 mb-[var(--space-4)]">
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Status</dt>
                <dd className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink/60 print:text-black/70 text-right">{record.classificationStatus}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Response Window</dt>
                <dd className="text-[11px] font-mono tabular-nums text-ink/60 print:text-black/70 text-right">{record.estimatedResponseWindow}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Channel</dt>
                <dd className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink/40 print:text-black/55 text-right">{record.intakeChannel}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-3)] border-b border-ink/[0.06] print:border-black/10">
                <dt className="text-[11px] uppercase tracking-[0.2em] text-ink/40 print:text-black/55 shrink-0">Processing Node</dt>
                <dd className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink/40 print:text-black/55 text-right">{record.processingNode}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-ink/40 print:text-black/50 leading-relaxed max-w-[72ch]">
              Reference{' '}
              <span className="font-mono tabular-nums">{record.referenceId}</span>{' '}
              has been filed. Retain for procurement tracking. Documentation
              requests or specifications outside the active catalog may extend
              response time.
            </p>
          </div>

        </div>

        {/* Print-only record footer */}
        <div className="hidden print:block mt-[var(--space-8)] pt-[var(--space-4)] border-t border-black/15">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink/35">
            {siteConfig.brand.name} · Procurement Intake Record · {record.referenceId}
          </p>
          <p className="mt-[var(--space-2)] text-[9px] font-mono uppercase tracking-[0.2em] text-ink/25">
            For buyer reference only. Does not constitute a confirmed commitment or binding agreement.
          </p>
        </div>

        {/* Actions — suppressed in print */}
        <div className="mt-[var(--space-8)] flex flex-col sm:flex-row gap-[var(--space-3)] print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            Print Record
          </button>
          <Link
            to="/documentation"
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            Documentation Archive
          </Link>
          <Link
            to="/research-supplies"
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
          >
            Research Supplies
          </Link>
        </div>

      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------
  if (items.length === 0) {
    return (
      <div className="py-[var(--space-12)]">
        <header className="mb-[var(--space-10)]">
          <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
            Checkout
          </p>
          <h1 className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
            <span className="font-light text-ink/85">Your </span>
            <span className="font-light text-ink">order.</span>
          </h1>
        </header>

        <div className="py-[var(--space-12)] border-y border-ink/[0.06] text-center">
          <p className="holo-text-body text-[13px] mb-[var(--space-8)]">
            Your cart is empty. Add inventory from any product page.
          </p>
          <div className="flex flex-col sm:flex-row gap-[var(--space-3)] justify-center">
            <Link
              to="/research-supplies"
              className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            >
              Research Supplies
            </Link>
            <Link
              to="/laboratory-equipment"
              className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-ink/15 text-xs uppercase tracking-[0.25em] text-ink/80 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
            >
              Laboratory Equipment
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Default state — list + form
  // ---------------------------------------------------------------------
  return (
    <div className="py-[var(--space-8)]">
      <header className="mb-[var(--space-10)]">
        <p className="holo-text-caption mb-[var(--space-3)] text-[10px] uppercase tracking-[0.3em]">
          Checkout
        </p>
        <h1 className="font-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] tracking-[-0.02em] text-ink">
          <span className="font-light text-ink/85">Your </span>
          <span className="font-light text-ink">order.</span>
        </h1>
      </header>

      {/*
        Wave 4 — Module composition
        Mobile: stacked (items module above form module).
        Desktop (lg+): 12-col grid; items col-span-8, form col-span-4.
        Items module = Level 1 solid surface. Form module = Level 3 glass
        (the single glass surface on this page). Both modules host markup
        that is structurally unchanged from the pre-Wave-4 implementation;
        only the surrounding containers were added.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[var(--space-6)]">
        {/* Items column — Level 1 solid surface module.
            Pass D: a section eyebrow above the surface labels the
            column as "Requested Inventory," propagating the
            procurement-grouping vocabulary into this region. */}
        <div className="lg:col-span-8">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink/40 mb-[var(--space-4)]">
            Requested Inventory
          </p>
          <div className="research-surface-solid overflow-hidden">
            <ul>
        {items.map((item) => {
          const imageUrl = item.product.images?.[0] ?? null;
          const noteValue = item.note ?? '';
          const isNoteOpen = !!notesOpen[item.product.id] || noteValue.length > 0;
          const atMax = item.quantity >= MAX_QTY;
          const unit = lineUnitCents(item);
          const lineTotal = unit * item.quantity;
          return (
            <li
              key={item.product.id}
              className="px-[var(--space-5)] py-[var(--space-5)] border-b border-ink/[0.06]"
            >
              {/* flex-wrap + the text block's min-w let the qty/remove cluster
                  drop to its own line on phones instead of crushing the name. */}
              <div className="flex flex-wrap items-center gap-[var(--space-4)]">
                <div className="w-16 h-16 shrink-0 overflow-hidden rounded-[10px] bg-display border border-ink/[0.09]">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink/20 text-[10px] uppercase tracking-widest">
                      No image
                    </div>
                  )}
                </div>

                <div className="min-w-[160px] flex-1">
                  <p className="text-sm text-ink truncate">
                    {item.product.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink/40 truncate">
                    <SKUCode value={item.product.sku} className="text-ink/40" />
                    {item.product.category && (
                      <>
                        <span className="mx-1.5 text-ink/20" aria-hidden="true">·</span>
                        {item.product.category.replace(/-/g, ' ')}
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[12px] font-mono tabular-nums text-ink/70">
                    {formatUsd(unit)}
                    {item.quantity > 1 && (
                      <span className="text-ink/40">
                        {' '}× {item.quantity} ={' '}
                        <span className="text-ink/80">{formatUsd(lineTotal)}</span>
                      </span>
                    )}
                  </p>
                  <p className="mt-1">
                    {lineIsFast(item, isMember) ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border border-ink/10 text-[color:var(--color-status-success)] bg-[color:var(--color-status-successMuted)]">
                        ⚡ 24 Hour Shipping
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] px-2.5 py-1 rounded-full border border-ink/12 text-ink/50 bg-ink/[0.04]">
                        Standard ship
                      </span>
                    )}
                  </p>
                </div>

                {/* Quantity controls + remove — one unit so they wrap together */}
                <div className="ml-auto flex items-center">
                <div className="flex items-center gap-[var(--space-2)]">
                  <button
                    type="button"
                    onClick={() => handleDecrement(item.product.id, item.quantity)}
                    aria-label="Decrease quantity"
                    className="w-7 h-7 rounded-full border border-ink/15 text-ink/70 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/35"
                  >
                    −
                  </button>
                  <span
                    className="w-6 text-center text-sm text-ink tabular-nums"
                    aria-live="polite"
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleIncrement(item.product.id, item.quantity)}
                    disabled={atMax}
                    aria-label="Increase quantity"
                    className="w-7 h-7 rounded-full border border-ink/15 text-ink/70 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-ink/70 disabled:hover:border-ink/15"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => remove(item.product.id)}
                  aria-label={`Remove ${item.product.name}`}
                  className="ml-[var(--space-4)] text-ink/40 hover:text-ink text-xs uppercase tracking-widest focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                >
                  Remove
                </button>
                </div>
              </div>

              {/* Per-item note */}
              <div className="mt-[var(--space-3)] pl-[calc(64px+var(--space-4))]">
                {!isNoteOpen ? (
                  <button
                    type="button"
                    onClick={() => toggleNote(item.product.id)}
                    className="text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                  >
                    + Add note
                  </button>
                ) : (
                  <div>
                    <label
                      htmlFor={`note-${item.product.id}`}
                      className="block text-[11px] uppercase tracking-[0.2em] text-ink/40 mb-[var(--space-2)]"
                    >
                      Note
                    </label>
                    <textarea
                      id={`note-${item.product.id}`}
                      value={noteValue}
                      onChange={(e) =>
                        setItemNote(item.product.id, e.target.value)
                      }
                      rows={2}
                      placeholder="Quantity, concentration, lot preferences, etc."
                      className={[FIELD_SURFACE, FIELD_DEFAULT, 'resize-y'].join(' ')}
                    />
                    {noteValue.length === 0 && (
                      <button
                        type="button"
                        onClick={() => toggleNote(item.product.id)}
                        className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-ink transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
            </ul>
            <div className="px-[var(--space-5)] py-[var(--space-4)] border-t border-ink/[0.1]">
              <div className="flex items-baseline justify-between gap-[var(--space-4)]">
                <span className="text-[11px] uppercase tracking-[0.25em] text-ink/45">Subtotal</span>
                <span className="text-sm font-mono tabular-nums text-ink">
                  {formatUsd(items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0))}
                </span>
              </div>
              <div className="mt-[var(--space-3)]">
                <PromoCode
                  variant="page"
                  subtotalCents={items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0)}
                />
              </div>
              {/* Account discount (signed-in perk) — same pass-2a math the
                  server bills, so this preview matches the invoice. */}
              {accountDiscount && (() => {
                const subtotalCents = items.reduce((sum, i) => sum + lineUnitCents(i) * i.quantity, 0);
                const breakdown = couponBreakdown(coupons, subtotalCents, items, accountDiscount);
                if (breakdown.accountCents <= 0) return null;
                return (
                  <div className="mt-[var(--space-3)]">
                    <div className="flex items-baseline justify-between gap-[var(--space-4)]">
                      <span className="text-[11px] uppercase tracking-[0.25em] text-ink/45">
                        {accountDiscount.label}
                      </span>
                      <span className="text-sm font-mono tabular-nums text-ink">
                        −{formatUsd(breakdown.accountCents)}
                      </span>
                    </div>
                    <div className="mt-[var(--space-2)] flex items-baseline justify-between gap-[var(--space-4)]">
                      <span className="text-[11px] uppercase tracking-[0.25em] text-ink/45">
                        Total after discounts
                      </span>
                      <span className="text-sm font-mono tabular-nums text-ink">
                        {formatUsd(Math.max(subtotalCents - breakdown.total, 0))}
                      </span>
                    </div>
                  </div>
                );
              })()}
              {/* Shipping — members ship free, guests pay the flat fee with a
                  one-tap path to waive it. Display only: place-order recomputes
                  the charge from the verified session, so this always matches
                  what's billed. */}
              <div className="mt-[var(--space-3)] border-t border-ink/[0.08] pt-[var(--space-3)]">
                <div className="flex items-baseline justify-between gap-[var(--space-4)]">
                  <span className="text-[11px] uppercase tracking-[0.25em] text-ink/45">Shipping</span>
                  <span className="text-sm font-mono tabular-nums text-ink">
                    {isMember ? 'Free — member' : formatUsd(GUEST_SHIPPING_CENTS)}
                  </span>
                </div>
                {!isMember && (
                  <p className="mt-[var(--space-2)] text-[11px] leading-relaxed text-ink/45">
                    <Link
                      to="/account?mode=signup"
                      className="font-medium text-ink underline decoration-ink/30 underline-offset-2 transition-colors hover:decoration-ink"
                    >
                      Create a free profile
                    </Link>{' '}
                    and we'll waive this — members always ship free and unlock wholesale case pricing.
                    Your cart stays as it is.
                  </p>
                )}
              </div>
            </div>
          </div>
          {cartHasMixedShipping(items, isMember) && (
            <div
              className="mt-[var(--space-3)] flex items-start gap-2 rounded-[var(--radius-field)] px-[var(--space-4)] py-[var(--space-3)]"
              style={{ backgroundColor: 'var(--color-status-warningMuted)', border: '1px solid color-mix(in srgb, var(--color-status-warning) 40%, transparent)' }}
              role="note"
            >
              <span aria-hidden="true" className="text-[13px] leading-none mt-0.5">⚡</span>
              <p className="text-[11.5px] leading-relaxed text-ink/75">
                <span className="font-light text-ink">Your order mixes 24-hour-shipping and standard items.</span>{' '}
                These ship from different locations and may arrive in{' '}
                <span className="font-medium">separate shipments</span> — you'll get tracking for each,{' '}
                <span className="font-medium">at no extra cost to you</span>.
              </p>
            </div>
          )}
          <p className="mt-[var(--space-3)] text-[11px] text-ink/40 leading-relaxed">
            Final pricing is confirmed on the invoice we email you — you can
            adjust the order before paying.
          </p>
        </div>

        {/* Inquiry form column — Level 1 solid surface module.
            Pass D: was Level 3 glass; flattened to solid because
            chrome and editorial surfaces no longer carry glass and
            the form's glass register read as decorative softness
            rather than as institutional intake. */}
        <div className="lg:col-span-4 pb-24 lg:pb-0">
          <div className="research-surface-solid lg:sticky lg:top-[calc(56px+var(--space-4))] p-[var(--space-6)]">
            <form onSubmit={handleSubmit} noValidate>
        {/* Section 1 — Buyer Identification (required) */}
        <h2 className="text-[11px] uppercase tracking-[0.3em] text-ink/55 mb-[var(--space-6)]">
          Buyer Identification
        </h2>

        <div className="space-y-[var(--space-5)]">
          <div>
            <label
              htmlFor="inquiry-name"
              className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
            >
              Name <span className="text-ink/55">*</span>
            </label>
            <input
              id="inquiry-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              aria-invalid={showNameError || undefined}
              aria-describedby={showNameError ? 'inquiry-name-error' : undefined}
              required
              autoComplete="name"
              className={[FIELD_SURFACE, showNameError ? FIELD_ERROR : FIELD_DEFAULT].join(' ')}
              placeholder="Full name"
            />
            {showNameError && (
              <p
                id="inquiry-name-error"
                className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400"
              >
                Name is required.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="inquiry-contact"
              className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
            >
              Email or Phone <span className="text-ink/55">*</span>
            </label>
            <input
              id="inquiry-contact"
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, contact: true }))}
              aria-invalid={showContactError || undefined}
              aria-describedby={
                showContactError ? 'inquiry-contact-error' : undefined
              }
              required
              autoComplete="email"
              className={[FIELD_SURFACE, showContactError ? FIELD_ERROR : FIELD_DEFAULT].join(' ')}
              placeholder="you@example.com or +1 555 000 0000"
            />
            {showContactError && (
              <p
                id="inquiry-contact-error"
                className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-red-400"
              >
                Email or phone is required.
              </p>
            )}
          </div>
        </div>

        {/* Section 2 — Organization or Lab (optional).
            Merges into `notes` on submit; supabase payload shape
            is unchanged. */}
        <h2 className="mt-[var(--space-8)] text-[11px] uppercase tracking-[0.3em] text-ink/55 mb-[var(--space-6)]">
          Organization or Lab
        </h2>

        <div className="space-y-[var(--space-5)]">
          <div>
            <label
              htmlFor="inquiry-organization"
              className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
            >
              Institution (optional)
            </label>
            <input
              id="inquiry-organization"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              autoComplete="organization"
              className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
              placeholder="Lab, university, or operational entity"
            />
          </div>
        </div>

        {/* Section 3 — Shipping Address */}
        <h2 className="mt-[var(--space-8)] text-[11px] uppercase tracking-[0.3em] text-ink/55 mb-[var(--space-3)]">
          Shipping Address
        </h2>
        <p className="text-[12px] text-ink/55 mb-[var(--space-5)] leading-relaxed">
          Where you'd like the order shipped. Required for fulfilment — used
          on the invoice and on the packing slip.
        </p>

        <div className="space-y-[var(--space-4)]">
          <div>
            <label
              htmlFor="ship-street"
              className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
            >
              Street address
            </label>
            <input
              id="ship-street"
              type="text"
              value={shipStreet}
              onChange={(e) => setShipStreet(e.target.value)}
              autoComplete="street-address"
              className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
              placeholder="123 Main Street, Apt 4B"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-[var(--space-3)]">
            <div>
              <label
                htmlFor="ship-city"
                className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
              >
                City
              </label>
              <input
                id="ship-city"
                type="text"
                value={shipCity}
                onChange={(e) => setShipCity(e.target.value)}
                autoComplete="address-level2"
                className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
                placeholder="Sacramento"
              />
            </div>
            <div className="sm:w-[100px]">
              <label
                htmlFor="ship-state"
                className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
              >
                State
              </label>
              <input
                id="ship-state"
                type="text"
                value={shipState}
                onChange={(e) => setShipState(e.target.value.toUpperCase())}
                maxLength={2}
                autoComplete="address-level1"
                className={[FIELD_SURFACE, FIELD_DEFAULT, 'uppercase'].join(' ')}
                placeholder="CA"
              />
            </div>
            <div className="sm:w-[140px]">
              <label
                htmlFor="ship-zip"
                className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
              >
                ZIP
              </label>
              <input
                id="ship-zip"
                type="text"
                value={shipZip}
                onChange={(e) => setShipZip(e.target.value)}
                autoComplete="postal-code"
                inputMode="numeric"
                className={[FIELD_SURFACE, FIELD_DEFAULT].join(' ')}
                placeholder="95814"
              />
            </div>
          </div>
        </div>

        {/* Section 4 — Procurement Notes (optional) */}
        <h2 className="mt-[var(--space-8)] text-[11px] uppercase tracking-[0.3em] text-ink/55 mb-[var(--space-6)]">
          Procurement Notes
        </h2>

        <div className="space-y-[var(--space-5)]">
          <div>
            <label
              htmlFor="inquiry-notes"
              className="block text-xs uppercase tracking-widest text-ink/50 mb-[var(--space-2)]"
            >
              Notes (optional)
            </label>
            <textarea
              id="inquiry-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className={[FIELD_SURFACE, FIELD_DEFAULT, 'resize-y'].join(' ')}
              placeholder="Lot preferences, batch requirements, delivery constraints, etc."
            />
          </div>
        </div>

        {submit.kind === 'error' && (
          <p
            role="alert"
            className="mt-[var(--space-4)] text-xs text-red-400"
          >
            {submit.message}
          </p>
        )}

        {/* overflow-hidden absorbs Turnstile's 300px minimum width when the
            form column is narrower than that on small phones. */}
        <div className="mt-[var(--space-4)] overflow-hidden">
          <Turnstile onToken={setTsToken} className="w-full" />
        </div>

        <button
          type="submit"
          onClick={() => setTouched({ name: true, contact: true })}
          disabled={formInvalid || submit.kind === 'submitting'}
          className="cta-mint group relative inline-flex items-center justify-center overflow-hidden rounded-full mt-[var(--space-8)] w-full sm:w-auto sm:ml-auto sm:block px-[var(--space-10)] py-[var(--space-4)] text-xs uppercase tracking-[0.25em] font-medium text-ink disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 focus-visible:ring-offset-1 focus-visible:ring-offset-base-900"
        >
          <span className="relative">{submit.kind === 'submitting' ? 'Placing order…' : 'Place Order'}</span>
        </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
