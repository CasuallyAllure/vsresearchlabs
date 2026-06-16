/**
 * AdminLayout
 *
 * Shell for all /admin/* pages. Horizontal pill nav across the top
 * (matches the site's pill-nav vocabulary), signed-in identity readout
 * on the right with sign-out. Children render below.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '../../lib/adminAuth';
import { AdminFilterBar } from './AdminFilterBar';

interface AdminLayoutProps {
  children: ReactNode;
}

const TABS: Array<{ to: string; label: string; match?: (p: string) => boolean }> = [
  { to: '/admin',               label: 'Dashboard',    match: (p) => p === '/admin' || p === '/admin/' },
  { to: '/admin/inquiries',     label: 'Inquiries',    match: (p) => p.startsWith('/admin/inquiries') },
  { to: '/admin/orders',        label: 'Orders',       match: (p) => p.startsWith('/admin/orders') },
  { to: '/admin/customers',     label: 'Customers',    match: (p) => p.startsWith('/admin/customers') },
  { to: '/admin/inventory',     label: 'Inventory',    match: (p) => p.startsWith('/admin/inventory') },
  { to: '/admin/import',        label: 'Import',       match: (p) => p.startsWith('/admin/import') },
  { to: '/admin/stock-history', label: 'Stock log',    match: (p) => p.startsWith('/admin/stock-history') },
  { to: '/admin/reports',       label: 'Reports',      match: (p) => p.startsWith('/admin/reports') },
  { to: '/admin/audit-log',     label: 'Audit log',    match: (p) => p.startsWith('/admin/audit-log') },
  { to: '/admin/system-health', label: 'Health',       match: (p) => p.startsWith('/admin/system-health') },
  { to: '/admin/products',      label: 'Catalog',      match: (p) => p === '/admin/products' || /^\/admin\/[^/]+\/(edit|new)$/.test(p) || p === '/admin/new' },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = TABS.find((t) =>
    t.match ? t.match(location.pathname) : location.pathname === t.to,
  );
  const currentTo = activeTab?.to ?? '/admin';

  return (
    <div className="py-[var(--space-6)]">
      {/* Top bar — title + signed-in identity on one line */}
      <header className="mb-[var(--space-5)] pb-[var(--space-4)] border-b border-ink/[0.06]">
        <p className="holo-text-caption text-[10px] uppercase tracking-[0.3em] mb-[var(--space-2)]">
          VS Research Labs · Operations
        </p>
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <div className="flex min-w-0 flex-1 items-baseline gap-[var(--space-3)]">
            <h1 className="shrink-0 text-[clamp(1.2rem,2.4vw,1.6rem)] leading-[1.1] tracking-[-0.01em] text-ink">
              <span className="font-light text-ink/85">Admin </span>
              <span className="font-medium text-ink">console.</span>
            </h1>
            {user && (
              <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-ink/45">
                {user.email}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="shrink-0 rounded-full border border-ink/15 px-[var(--space-4)] py-[var(--space-2)] uppercase tracking-[0.2em] text-[10px] text-ink/65 hover:text-ink hover:border-ink/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Section nav — a dropdown, not a pill row */}
      <nav aria-label="Admin sections" className="mb-[var(--space-6)]">
        <AdminFilterBar
          label="Section"
          options={TABS.map((t) => ({ value: t.to, label: t.label }))}
          value={currentTo}
          onChange={(to) => navigate(to)}
          widthClass="sm:w-[240px]"
        />
      </nav>

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
