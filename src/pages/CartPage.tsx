/**
 * CartPage (Inquiry List)
 * Phase 3 — Inquiry flow polish.
 *
 * Adds:
 *  • Per-item notes via toggle → textarea (persisted in useCart store)
 *  • Quantity edge cases: minus at qty=1 removes; plus capped at MAX_QTY
 *  • Inline field-level validation on Name + Contact (touched + empty)
 *  • Success state with both 'Back to Home' and 'Browse Catalog' actions
 *  • Tightened form/list visual hierarchy
 *
 * Phase 2 invariants preserved: no glass surfaces, no blur, hairlines only.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { supabase } from '../lib/supabase';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const MAX_QTY = 999;

export function CartPage() {
  const items = useCart((s) => s.items);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const setItemNote = useCart((s) => s.setItemNote);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

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

  const formInvalid = nameEmpty || contactEmpty || items.length === 0;

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
        message: 'Inquiry service is not configured. Please try again later.',
      });
      return;
    }

    const payload = {
      name: name.trim(),
      contact: contact.trim(),
      notes: notes.trim(),
      items: items.map((i) => ({
        product: {
          id: i.product.id,
          name: i.product.name,
          category: i.product.category,
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

    clear();
    setName('');
    setContact('');
    setNotes('');
    setSubmit({ kind: 'success' });
  }

  // ---------------------------------------------------------------------
  // Success state
  // ---------------------------------------------------------------------
  if (submit.kind === 'success') {
    return (
      <div className="py-[var(--space-20)] text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-4)]">
          Inquiry Sent
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight mb-[var(--space-4)]">
          Thank you.
        </h1>
        <p className="text-sm text-white/55 mb-[var(--space-8)] max-w-[44ch] mx-auto leading-relaxed">
          Inquiry sent. We will contact you shortly.
        </p>
        <div className="flex flex-col sm:flex-row gap-[var(--space-3)] justify-center">
          <Link
            to="/"
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-white/15 text-xs uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors"
          >
            Back to Home
          </Link>
          <Link
            to="/research-supplies"
            className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-white/15 text-xs uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors"
          >
            Browse Catalog
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
          <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
            Send Inquiry
          </p>
          <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
            Inquiry List
          </h1>
        </header>

        <div className="py-[var(--space-12)] border-y border-white/[0.06] text-center">
          <p className="text-white/55 text-sm mb-[var(--space-8)]">
            Your inquiry list is empty.
          </p>
          <div className="flex flex-col sm:flex-row gap-[var(--space-3)] justify-center">
            <Link
              to="/research-supplies"
              className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-white/15 text-xs uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors"
            >
              Research Supplies
            </Link>
            <Link
              to="/laboratory-equipment"
              className="px-[var(--space-6)] py-[var(--space-3)] rounded-full border border-white/15 text-xs uppercase tracking-[0.25em] text-white/80 hover:text-white hover:border-white/30 transition-colors"
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
        <p className="text-[11px] uppercase tracking-[0.3em] text-gold mb-[var(--space-3)]">
          Send Inquiry
        </p>
        <h1 className="text-3xl sm:text-4xl font-light text-white tracking-tight">
          Inquiry List
        </h1>
      </header>

      {/* Items — hairline-divided list, no enclosing card */}
      <ul className="border-t border-white/[0.06] mb-[var(--space-16)]">
        {items.map((item) => {
          const imageUrl = item.product.images?.[0] ?? null;
          const noteValue = item.note ?? '';
          const isNoteOpen = !!notesOpen[item.product.id] || noteValue.length > 0;
          const atMax = item.quantity >= MAX_QTY;
          return (
            <li
              key={item.product.id}
              className="py-[var(--space-5)] border-b border-white/[0.06]"
            >
              <div className="flex items-center gap-[var(--space-4)]">
                <div className="w-16 h-16 shrink-0 overflow-hidden bg-base-800 border border-white/[0.06]">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20 text-[10px] uppercase tracking-widest">
                      No image
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">
                    {item.product.name}
                  </p>
                  {item.product.category && (
                    <p className="text-xs text-white/40 mt-0.5">
                      {item.product.category.replace(/-/g, ' ')}
                    </p>
                  )}
                </div>

                {/* Quantity controls */}
                <div className="flex items-center gap-[var(--space-2)]">
                  <button
                    type="button"
                    onClick={() => handleDecrement(item.product.id, item.quantity)}
                    aria-label="Decrease quantity"
                    className="w-7 h-7 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
                  >
                    −
                  </button>
                  <span
                    className="w-6 text-center text-sm text-white tabular-nums"
                    aria-live="polite"
                  >
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleIncrement(item.product.id, item.quantity)}
                    disabled={atMax}
                    aria-label="Increase quantity"
                    className="w-7 h-7 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-white/70 disabled:hover:border-white/15"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => remove(item.product.id)}
                  aria-label="Remove item"
                  className="ml-[var(--space-2)] text-white/40 hover:text-white text-xs uppercase tracking-widest"
                >
                  Remove
                </button>
              </div>

              {/* Per-item note */}
              <div className="mt-[var(--space-3)] pl-[calc(64px+var(--space-4))]">
                {!isNoteOpen ? (
                  <button
                    type="button"
                    onClick={() => toggleNote(item.product.id)}
                    className="text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-gold transition-colors"
                  >
                    + Add note
                  </button>
                ) : (
                  <div>
                    <label
                      htmlFor={`note-${item.product.id}`}
                      className="block text-[11px] uppercase tracking-[0.2em] text-white/40 mb-[var(--space-2)]"
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
                      className="w-full px-[var(--space-3)] py-[var(--space-2)] bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/50 transition-colors resize-y"
                    />
                    {noteValue.length === 0 && (
                      <button
                        type="button"
                        onClick={() => toggleNote(item.product.id)}
                        className="mt-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors"
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

      {/* Inquiry form — flat, no panel */}
      <form onSubmit={handleSubmit} noValidate>
        <h2 className="text-[11px] uppercase tracking-[0.3em] text-white/55 mb-[var(--space-6)]">
          Your Information
        </h2>

        <div className="space-y-[var(--space-5)]">
          <div>
            <label
              htmlFor="inquiry-name"
              className="block text-xs uppercase tracking-widest text-white/50 mb-[var(--space-2)]"
            >
              Name <span className="text-gold">*</span>
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
              className={[
                'w-full px-[var(--space-4)] py-[var(--space-3)] bg-black/40 border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none transition-colors',
                showNameError
                  ? 'border-red-500/60 focus:border-red-400'
                  : 'border-white/10 focus:border-gold/50',
              ].join(' ')}
              placeholder="Your full name"
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
              className="block text-xs uppercase tracking-widest text-white/50 mb-[var(--space-2)]"
            >
              Email or Phone <span className="text-gold">*</span>
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
              className={[
                'w-full px-[var(--space-4)] py-[var(--space-3)] bg-black/40 border rounded-lg text-sm text-white placeholder-white/30 focus:outline-none transition-colors',
                showContactError
                  ? 'border-red-500/60 focus:border-red-400'
                  : 'border-white/10 focus:border-gold/50',
              ].join(' ')}
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

          <div>
            <label
              htmlFor="inquiry-notes"
              className="block text-xs uppercase tracking-widest text-white/50 mb-[var(--space-2)]"
            >
              Notes (optional)
            </label>
            <textarea
              id="inquiry-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full px-[var(--space-4)] py-[var(--space-3)] bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/50 transition-colors resize-y"
              placeholder="Anything else we should know?"
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

        <button
          type="submit"
          onClick={() => setTouched({ name: true, contact: true })}
          disabled={formInvalid || submit.kind === 'submitting'}
          className="mt-[var(--space-8)] w-full sm:w-auto sm:ml-auto sm:block px-[var(--space-10)] py-[var(--space-4)] rounded-full bg-gold text-black text-xs uppercase tracking-[0.25em] font-medium transition-all duration-200 hover:bg-gold-light disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submit.kind === 'submitting' ? 'Sending…' : 'Send Inquiry'}
        </button>
      </form>
    </div>
  );
}
