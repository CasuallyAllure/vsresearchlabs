/**
 * IntelModule — canonical collapsible intelligence module
 *
 * The system's single module shell. Every intelligence section the user
 * sees — Mechanism, Receptor, Tiers, Analytical, Procurement, Studies,
 * Media — renders inside this shell. Same chrome, same chevron, same
 * stagger cadence, same border/background contract.
 *
 * Module rhythm contract:
 *   - `index` drives the `01`, `02` numeric prefix AND the `--mi` CSS
 *     custom property that powers the stagger reveal (220ms initial +
 *     38ms per index). Indexes must be 1-based.
 *   - `defaultOpen` opens the first module without user interaction;
 *     others remain closed by default.
 *   - `reserved` swaps the body for a "documentation pending" panel.
 *
 * The module CSS (`cio-module`, `cio-panel-el`, keyframes) lives in the
 * Overlay today and ships globally to any host that mounts the Overlay.
 * When ProductPage / Hero adopt this primitive they MUST mount the same
 * keyframes once at the host level. (Future PR: lift to theme.css.)
 *
 * Co-located atoms (ModuleBody, ModuleText, DataGrid, StatChip) are
 * exported from this file so consumers import the entire module-content
 * vocabulary from one place.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

// ─── Internal icon (co-located — driven by IntelModule open state) ───────

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── ModuleHeader ────────────────────────────────────────────────────────
//
// The header bar of an IntelModule (or any module-style row). Numbered
// index + uppercase title + optional "Planned" badge + chevron. Exported
// separately so non-collapsible module-style headers (future ProductPage
// always-open modules, future admin section labels) can render the same
// visual line.

interface ModuleHeaderProps {
  index: number;
  title: string;
  /** When true, renders the "Planned" badge to the right of the title. */
  reserved?: boolean;
  /** When provided, header renders as a button with this aria-expanded value. */
  open?: boolean;
  /** When provided, header renders as a button with this click handler. */
  onToggle?: () => void;
}

export function ModuleHeader({ index, title, reserved = false, open, onToggle }: ModuleHeaderProps) {
  const isInteractive = typeof onToggle === 'function' && typeof open === 'boolean';

  const inner = (
    <>
      <span className="font-mono tabular-nums text-ink/30 shrink-0 leading-none" style={{ fontSize: '9.5px', minWidth: '14px' }}>
        {String(index).padStart(2, '0')}
      </span>
      <span className="flex-1 min-w-0 text-ink/58" style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {title}
      </span>
      {reserved && (
        <span className="text-ink/22 shrink-0" style={{ fontSize: '8.5px', letterSpacing: '0.18em', textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', padding: '1px 4px' }}>
          Planned
        </span>
      )}
      {isInteractive && <ChevronDownIcon open={open} />}
    </>
  );

  if (!isInteractive) {
    return (
      <div className="w-full flex items-center gap-3 py-2.5 px-4 text-left">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center gap-3 py-2.5 px-4 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/20 active:scale-[0.99]"
      style={{ backgroundColor: open ? 'rgba(255,255,255,0.022)' : 'transparent', transition: 'background-color 120ms ease-out' }}
      onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.028)'; }}
      onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
    >
      {inner}
    </button>
  );
}

// ─── IntelModule — collapsible numbered module shell ─────────────────────

interface IntelModuleProps {
  index: number;
  title: string;
  defaultOpen?: boolean;
  reserved?: boolean;
  children?: ReactNode;
}

export function IntelModule({ index, title, defaultOpen = false, reserved = false, children }: IntelModuleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="cio-module"
      style={{ '--mi': index, borderBottom: '1px solid rgba(255,255,255,0.05)' } as React.CSSProperties}
    >
      <ModuleHeader index={index} title={title} reserved={reserved} open={open} onToggle={() => setOpen((o) => !o)} />
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 200ms cubic-bezier(0.23, 1, 0.32, 1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ backgroundColor: open ? '#181818' : 'transparent', transition: 'background-color 200ms cubic-bezier(0.23, 1, 0.32, 1)', borderTop: open ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent' }}>
            {reserved ? (
              <div className="px-4 py-4">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-[2px]" style={{ border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink/22 shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span className="text-ink/28" style={{ fontSize: '10.5px', letterSpacing: '0.04em' }}>{title} documentation pending</span>
                </div>
              </div>
            ) : children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Module content atoms ────────────────────────────────────────────────

export function ModuleBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}

export function ModuleText({ children }: { children: string }) {
  return <p className="text-ink/60 leading-[1.65]" style={{ fontSize: '12.5px', maxWidth: '65ch' }}>{children}</p>;
}

interface DataGridRow {
  label: string;
  value: string;
}

export function DataGrid({ rows }: { rows: DataGridRow[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 min-w-0">
          <dt className="text-ink/32 shrink-0" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>{r.label}</dt>
          <dd className="text-ink/62 text-right font-mono truncate tabular-nums" style={{ fontSize: '10.5px' }}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatChip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-[2px] px-2 py-1.5 min-w-0"
      style={{
        backgroundColor: highlight ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)',
        border: highlight ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.06)',
        transition: 'background-color 150ms ease-out, border-color 150ms ease-out',
      }}>
      <p className="text-ink/28 uppercase truncate" style={{ fontSize: '8.5px', letterSpacing: '0.24em' }}>{label}</p>
      <p className="text-ink/60 font-mono truncate mt-0.5" style={{ fontSize: '10.5px' }}>{value}</p>
    </div>
  );
}

// ─── Module animation CSS — mount once at host level ─────────────────────
//
// IntelModuleStyles renders the keyframes + .cio-module + .cio-panel-el
// rules used by IntelModule and the Overlay panel. Hosts that mount
// IntelModules at the page level should render <IntelModuleStyles /> once
// so the stagger and panel border-radius rules are present. The Overlay
// today inlines this; ProductPage / Hero will mount this primitive
// instead of re-declaring the rules.

export function IntelModuleStyles() {
  return (
    <style>{`
      @keyframes cio-bd     { from { opacity: 0 } to { opacity: 1 } }
      @keyframes cio-panel  { from { opacity: 0; transform: scale(0.97) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      @keyframes cio-bd-out    { from { opacity: 1 } to { opacity: 0 } }
      @keyframes cio-panel-out { from { opacity: 1; transform: scale(1) translateY(0); } to { opacity: 0; transform: scale(0.97) translateY(8px); } }
      @keyframes cio-module-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      .cio-module {
        animation: cio-module-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
        animation-delay: calc(var(--mi, 1) * 38ms + 220ms);
      }
      .cio-panel-el { border-radius: 4px 4px 0 0; }
      @media (min-width: 640px) { .cio-panel-el { border-radius: 4px; } }
      @media (prefers-reduced-motion: reduce) {
        .cio-module { animation: none; opacity: 1; transform: none; }
        .cio-panel-el { animation: none !important; opacity: 1; transform: none; }
        [style*="cio-bd"] { animation: none !important; opacity: 1; }
      }
    `}</style>
  );
}
