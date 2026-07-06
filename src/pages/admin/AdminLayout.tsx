/**
 * AdminLayout
 *
 * Shell for all /admin/* pages. A single thin command bar carries the
 * brand, the compact section-nav dropdown, the signed-in email, and the
 * sign-out control — no oversized header. Children render below.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '../../lib/adminAuth';
import { AdminFilterBar } from './AdminFilterBar';

interface AdminLayoutProps {
  children: ReactNode;
  /** Optional back button shown to the LEFT of the sub-tab control. */
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
 * Four operational areas. The section dropdown switches areas; within an
 * area, a thin sub-tab strip switches between the views that play off each
 * other. Selecting an area lands on its first sub-tab.
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
        // folded into Inventory now, so they light up this sub-tab too.
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

export function AdminLayout({ children, backTo, backLabel = 'Back' }: AdminLayoutProps) {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const activeArea =
    AREAS.find((a) => a.subtabs.some((t) => t.match(path))) ?? AREAS[0];
  const showSubtabs = activeArea.subtabs.length > 1;

  return (
    <div className="py-[var(--space-5)]">
      {/* Thin command bar — brand · section nav · identity · sign out, fits one line (no scroll) */}
      <header className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] border-b border-ink/[0.06] pb-[var(--space-2)]">
        {/* Brand — short on phones, full on wider screens */}
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.16em] sm:text-[9px] sm:tracking-[0.2em]">
          <span className="text-ink/70">
            <span className="sm:hidden">VSR</span>
            <span className="hidden sm:inline">VS Research Labs</span>
          </span>
          <span aria-hidden="true" className="text-ink/25">/</span>
          <span className="text-ink/40">Admin</span>
        </span>

        {/* Section nav — compact area dropdown (no redundant "Section" label) */}
        <nav aria-label="Admin areas" className="min-w-0 shrink">
          <AdminFilterBar
            label=""
            options={AREAS.map((a) => ({ value: a.key, label: a.label }))}
            value={activeArea.key}
            onChange={(key) => {
              const next = AREAS.find((a) => a.key === key);
              if (next) navigate(next.subtabs[0].to);
            }}
            dense
          />
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
          className="shrink-0 whitespace-nowrap rounded-full border border-ink/15 px-2.5 py-[3px] text-[8.5px] uppercase tracking-[0.16em] text-ink/60 transition-colors hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30 sm:text-[9px] sm:tracking-[0.2em] max-lg:ml-auto"
        >
          Sign out
        </button>
      </header>

      {/* Sub-tab strip — a centered segmented control tucked under the top line,
          with an optional back button pinned to its left. */}
      {(showSubtabs || backTo) && (
        <nav aria-label={`${activeArea.label} views`} className="mb-[var(--space-6)] flex items-center justify-center gap-[var(--space-2)]">
          {backTo && (
            <Link
              to={backTo}
              aria-label={backLabel}
              title={backLabel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/15 bg-ink/[0.03] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
          )}
          {showSubtabs && (
            <div className="inline-flex items-center gap-0.5 rounded-full border border-ink/[0.12] bg-ink/[0.03] p-[3px]">
              {activeArea.subtabs.map((t) => {
                const on = t.match(path);
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    aria-current={on ? 'page' : undefined}
                    className={[
                      'rounded-full px-[var(--space-4)] py-[5px] text-[10px] uppercase tracking-[0.18em] transition-colors',
                      on
                        ? 'bg-display text-ink shadow-[0_1px_3px_-1px_rgba(26,23,20,0.25)]'
                        : 'text-ink/45 hover:text-ink',
                    ].join(' ')}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
      )}

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
