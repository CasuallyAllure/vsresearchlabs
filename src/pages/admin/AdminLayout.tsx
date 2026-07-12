/**
 * AdminLayout
 *
 * Shell for all /admin/* pages. A single thin command bar carries everything:
 * optional back button, brand, ONE grouped section/page menu (areas as
 * section headers, their pages as items — no separate sub-tab strip), the
 * signed-in email, and sign-out. Children render directly below, so pages
 * get their content above the fold even on a phone.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '../../lib/adminAuth';
import { siteConfig } from '../../config';

interface AdminLayoutProps {
  children: ReactNode;
  /** Optional back button shown at the far LEFT of the command bar. */
  backTo?: string;
  backLabel?: string;
}

interface SubTab {
  to: string;
  label: string;
  match: (p: string) => boolean;
}

interface Area {
  key: string;
  label: string;
  subtabs: SubTab[];
}

/**
 * Four operational areas. They all live in one dropdown now: each area is a
 * section header, each page an item. Single-page areas (Dashboard) render as
 * a bare item with no header.
 */
const AREAS: Area[] = [
  {
    key: 'overview',
    label: 'Dashboard',
    subtabs: [
      { to: '/admin', label: 'Dashboard', match: (p) => p === '/admin' || p === '/admin/' },
    ],
  },
  {
    key: 'commerce',
    label: 'Commerce',
    subtabs: [
      { to: '/admin/orders',    label: 'Orders',    match: (p) => p.startsWith('/admin/orders') },
      { to: '/admin/inquiries', label: 'Inquiries', match: (p) => p.startsWith('/admin/inquiries') },
      { to: '/admin/customers', label: 'Customers', match: (p) => p.startsWith('/admin/customers') },
      { to: '/admin/coupons',   label: 'Coupons',   match: (p) => p.startsWith('/admin/coupons') },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    subtabs: [
      {
        to: '/admin/inventory',
        label: 'Inventory',
        // The old standalone Catalog (/admin/products) + product editor are
        // folded into Inventory now, so they light up this item too.
        match: (p) =>
          p.startsWith('/admin/inventory') ||
          p === '/admin/products' ||
          p === '/admin/new' ||
          /^\/admin\/[^/]+\/(edit|new)$/.test(p),
      },
      { to: '/admin/stock-history', label: 'Stock log', match: (p) => p.startsWith('/admin/stock-history') },
      { to: '/admin/import',        label: 'Import',    match: (p) => p.startsWith('/admin/import') },
    ],
  },
  {
    key: 'records',
    label: 'Records',
    subtabs: [
      { to: '/admin/reports',       label: 'Reports',   match: (p) => p.startsWith('/admin/reports') },
      { to: '/admin/system-health', label: 'Health',    match: (p) => p.startsWith('/admin/system-health') },
      { to: '/admin/audit-log',     label: 'Audit log', match: (p) => p.startsWith('/admin/audit-log') },
    ],
  },
];

/** The single grouped navigation dropdown on the command bar. */
function AdminNavMenu({ path }: { path: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const activeArea = AREAS.find((a) => a.subtabs.some((t) => t.match(path))) ?? AREAS[0];
  const activeTab = activeArea.subtabs.find((t) => t.match(path)) ?? activeArea.subtabs[0];
  const label =
    activeArea.subtabs.length > 1 ? `${activeArea.label} · ${activeTab.label}` : activeArea.label;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-[40px] min-w-0 items-center gap-1.5 rounded-full border border-ink/[0.12] bg-ink/[0.02] pl-2.5 pr-2 text-left transition-colors hover:border-ink/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
      >
        <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.14em] text-ink">{label}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-ink/45 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[200] cursor-default"
          />
          <div
            role="menu"
            className="no-scrollbar glass-panel absolute left-0 top-full z-[201] mt-1.5 max-h-[70vh] w-[220px] overflow-y-auto rounded-[16px] py-1.5"
          >
            {AREAS.map((a) => (
              <div key={a.key} className="py-0.5">
                {a.subtabs.length > 1 && (
                  <p className="px-3.5 pb-0.5 pt-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40">
                    {a.label}
                  </p>
                )}
                {a.subtabs.map((t) => {
                  const on = t.match(path);
                  return (
                    <button
                      key={t.to}
                      type="button"
                      role="menuitem"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => { setOpen(false); navigate(t.to); }}
                      className={[
                        'flex w-full items-center justify-between gap-3 px-3.5 py-1.5 text-left text-[11px] uppercase tracking-[0.12em] transition-colors',
                        on ? 'bg-ink/[0.06] text-ink' : 'text-ink/65 hover:bg-ink/[0.04] hover:text-ink',
                      ].join(' ')}
                    >
                      <span className="truncate">{t.label}</span>
                      {on && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-holo">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AdminLayout({ children, backTo, backLabel = 'Back' }: AdminLayoutProps) {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();
  const path = location.pathname;

  return (
    <div className="py-[var(--space-5)]">
      {/* Thin command bar — back · brand · nav menu · identity · sign out, one line */}
      <header className="mb-[var(--space-5)] flex items-center gap-[var(--space-2)] border-b border-ink/[0.06] pb-[var(--space-2)]">
        {backTo && (
          <Link
            to={backTo}
            aria-label={backLabel}
            title={backLabel}
            className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink/15 bg-ink/[0.03] text-ink/70 transition-colors before:absolute before:inset-[-8px] before:content-[''] hover:border-ink/30 hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        )}

        {/* Brand — short on phones, full on wider screens */}
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] sm:tracking-[0.2em]">
          <span className="text-ink/70">
            <span className="sm:hidden">{siteConfig.brand.shortCode}</span>
            <span className="hidden sm:inline">{siteConfig.brand.name}</span>
          </span>
          <span aria-hidden="true" className="text-ink/25">/</span>
          <span className="text-ink/40">Admin</span>
        </span>

        {/* Section · page — one grouped dropdown, no second nav line */}
        <nav aria-label="Admin navigation" className="min-w-0 shrink">
          <AdminNavMenu path={path} />
        </nav>

        {/* Identity + sign out, pushed to the right — same line */}
        {user && (
          <span className="ml-auto hidden min-w-0 shrink truncate whitespace-nowrap font-mono text-[10px] tabular-nums text-ink/40 lg:inline">
            {user.email}
          </span>
        )}
        <button
          type="button"
          onClick={() => signOut()}
          className="relative shrink-0 whitespace-nowrap rounded-full border border-ink/15 px-2.5 py-[3px] text-[10px] uppercase tracking-[0.16em] text-ink/60 transition-colors before:absolute before:inset-[-10px] before:content-[''] hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 sm:tracking-[0.2em] max-lg:ml-auto"
        >
          Sign out
        </button>
      </header>

      <div>{children}</div>

      <footer className="mt-[var(--space-16)] pt-[var(--space-6)] border-t border-ink/[0.06] flex items-center justify-between gap-[var(--space-3)] text-[10px] uppercase tracking-[0.22em]">
        <p className="holo-text-caption">For Research Purposes Only — Internal Operations</p>
        <Link to="/" className="text-ink/45 hover:text-ink/80 transition-colors">
          ← Back to site
        </Link>
      </footer>
    </div>
  );
}
