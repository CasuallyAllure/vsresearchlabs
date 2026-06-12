/**
 * AdminLayout
 *
 * Shell for all /admin/* pages. Horizontal pill nav across the top
 * (matches the site's pill-nav vocabulary), signed-in identity readout
 * on the right with sign-out. Children render below.
 */

import { Link, NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '../../lib/adminAuth';

interface AdminLayoutProps {
  children: ReactNode;
}

const TABS: Array<{ to: string; label: string; match?: (p: string) => boolean }> = [
  { to: '/admin',               label: 'Dashboard',    match: (p) => p === '/admin' || p === '/admin/' },
  { to: '/admin/inquiries',     label: 'Inquiries',    match: (p) => p.startsWith('/admin/inquiries') },
  { to: '/admin/orders',        label: 'Orders',       match: (p) => p.startsWith('/admin/orders') },
  { to: '/admin/customers',     label: 'Customers',    match: (p) => p.startsWith('/admin/customers') },
  { to: '/admin/inventory',     label: 'Inventory',    match: (p) => p.startsWith('/admin/inventory') },
  { to: '/admin/stock-history', label: 'Stock log',    match: (p) => p.startsWith('/admin/stock-history') },
  { to: '/admin/audit-log',     label: 'Audit log',    match: (p) => p.startsWith('/admin/audit-log') },
  { to: '/admin/system-health', label: 'Health',       match: (p) => p.startsWith('/admin/system-health') },
  { to: '/admin/products',      label: 'Catalog',      match: (p) => p === '/admin/products' || /^\/admin\/[^/]+\/(edit|new)$/.test(p) || p === '/admin/new' },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();

  return (
    <div className="py-[var(--space-6)]">
      {/* Top bar */}
      <header className="mb-[var(--space-8)] pb-[var(--space-4)] border-b border-white/[0.06] flex items-start justify-between gap-[var(--space-4)] flex-wrap">
        <div>
          <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
            VS Research Labs · Operations
          </p>
          <h1 className="text-[clamp(1.2rem,2.4vw,1.6rem)] leading-[1.1] tracking-[-0.01em] text-white">
            <span className="font-light text-white/85">Admin </span>
            <span className="font-medium text-white">console.</span>
          </h1>
        </div>

        <div className="flex items-center gap-[var(--space-3)] text-[11px]">
          {user && (
            <span className="font-mono text-white/45 tabular-nums">
              {user.email}
            </span>
          )}
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-full border border-white/15 px-[var(--space-4)] py-[var(--space-2)] uppercase tracking-[0.2em] text-[10px] text-white/65 hover:text-white hover:border-white/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab nav */}
      <nav aria-label="Admin sections" className="mb-[var(--space-8)]">
        <ul className="flex flex-wrap items-center gap-2">
          {TABS.map((tab) => {
            const active = tab.match
              ? tab.match(location.pathname)
              : location.pathname === tab.to;
            return (
              <li key={tab.to}>
                <NavLink
                  to={tab.to}
                  end={tab.to === '/admin'}
                  className={[
                    'inline-flex items-center rounded-full px-[var(--space-4)] py-[var(--space-2)] text-[11px] uppercase tracking-[0.2em] transition-colors',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                    active
                      ? 'bg-white/[0.10] text-white border border-white/20'
                      : 'text-white/55 hover:text-white/90 border border-white/[0.08]',
                  ].join(' ')}
                  style={
                    active
                      ? { boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.10)' }
                      : undefined
                  }
                >
                  {tab.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>

      <footer className="mt-[var(--space-16)] pt-[var(--space-6)] border-t border-white/[0.06] flex items-center justify-between gap-[var(--space-3)] text-[10px] uppercase tracking-[0.22em]">
        <p className="holo-text-caption">For Research Purposes Only — Internal Operations</p>
        <Link to="/" className="text-white/45 hover:text-white/80 transition-colors">
          ← Back to site
        </Link>
      </footer>
    </div>
  );
}
