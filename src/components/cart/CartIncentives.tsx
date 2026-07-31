/**
 * CartIncentives — the "what you're getting, what's within reach" panel.
 *
 * Two blocks, deliberately separated so a buyer can tell them apart at a
 * glance: what is ALREADY applied to this order, and what is one step away.
 * Conflating the two is how a cart ends up implying a discount nobody
 * receives — see lib/cartIncentives for the precedence rules that decide
 * which single discount actually bills.
 *
 * Presentation only. Every figure is handed in already resolved; this file
 * does no pricing arithmetic of its own.
 */

import { useState } from 'react';
import type { CartIncentives as CartIncentivesModel, IncentiveRow } from '../../lib/cartIncentives';

const fmt = (cents: number): string =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

interface CartIncentivesProps {
  model: CartIncentivesModel;
  /** Rendered under the invitation row — lets the cart supply its own
   *  "create account" navigation without this panel knowing about routing. */
  onCreateAccount?: () => void;
}

export function CartIncentives({ model, onCreateAccount }: CartIncentivesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { applied, reachable, savingCents } = model;

  if (applied.length === 0 && reachable.length === 0) return null;

  return (
    <section
      aria-label="Offers on this order"
      className="floating-module rounded-[var(--radius-module)] border border-ink/[0.09] p-[var(--space-4)]"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink/45">
          Your order
        </p>
        {savingCents > 0 && (
          <p className="font-mono text-[11px] tabular-nums text-holo">
            saving {fmt(savingCents)}
          </p>
        )}
      </header>

      {applied.length > 0 && (
        <ul className="mt-[var(--space-3)] space-y-1.5">
          {applied.map((row) => (
            <IncentiveLine
              key={row.id}
              row={row}
              open={openId === row.id}
              onToggle={() => setOpenId(openId === row.id ? null : row.id)}
            />
          ))}
        </ul>
      )}

      {reachable.length > 0 && (
        <ul
          className={`space-y-2 ${
            applied.length > 0
              ? 'mt-[var(--space-3)] border-t border-ink/[0.07] pt-[var(--space-3)]'
              : 'mt-[var(--space-3)]'
          }`}
        >
          {reachable.map((row) => (
            <li key={row.id}>
              <IncentiveLine
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                bare
              />
              {row.progress != null && !row.met && (
                <div
                  className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-ink/[0.08]"
                  role="progressbar"
                  aria-valuenow={Math.round(row.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress toward same-day delivery"
                >
                  <div
                    className="h-full rounded-full bg-holo/70 transition-transform duration-500 ease-out"
                    style={{
                      width: '100%',
                      transform: `translateX(-${(1 - row.progress) * 100}%)`,
                    }}
                  />
                </div>
              )}
              {row.kind === 'invitation' && onCreateAccount && (
                <button
                  type="button"
                  onClick={onCreateAccount}
                  className="mt-2 inline-flex min-h-[40px] items-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-holo transition-colors hover:text-holo-light focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/50"
                >
                  Create an account →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface IncentiveLineProps {
  row: IncentiveRow;
  open: boolean;
  onToggle: () => void;
  /** Skip the <li> wrapper — the reachable list supplies its own. */
  bare?: boolean;
}

function IncentiveLine({ row, open, onToggle, bare = false }: IncentiveLineProps) {
  const isApplied = row.kind === 'applied';
  const body = (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded-[6px] py-1 text-left transition-colors hover:bg-ink/[0.03] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
      >
        <span aria-hidden="true" className="mt-[3px] shrink-0">
          {isApplied ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-holo">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink/30">
              <circle cx="12" cy="12" r="9" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink/80">{row.label}</span>
        {row.valueCents != null && row.valueCents > 0 && isApplied && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-holo">
            −{fmt(row.valueCents)}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`mt-[3px] shrink-0 text-ink/30 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <p className="pl-[19px] pr-1 pb-1 text-[11px] leading-relaxed text-ink/55">{row.detail}</p>
      )}
    </>
  );

  return bare ? <div>{body}</div> : <li>{body}</li>;
}
