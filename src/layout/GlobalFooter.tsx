/**
 * GlobalFooter
 * Phase 3 — VS Research Labs App Shell
 * Stabilization + Final Polish — Institutional terminal state.
 *
 * Quiet, restrained footer rendered globally beneath every route as a
 * peer of <AnimatedPortalShell />. Owns the bottom-nav clearance so
 * <AnimatedPortalShell /> no longer needs to over-pad its own bottom
 * edge. The BottomNav pill is a floating fixed element shown at ALL
 * viewports, so the clearance (`pb-14`) applies at every breakpoint —
 * without it, the legal/copyright row sits behind the pill on long
 * desktop pages.
 *
 * Operationally minimal: identifier, role caption with RUO compliance
 * note, and copyright. No social links, no newsletter pattern, no
 * navigation duplication — those would re-introduce consumer-app
 * surface posture that the procurement register has otherwise removed.
 *
 * One addition (T6): a compact horizontal legal/trust link row (Privacy ·
 * Terms · Shipping · About · Contact). Links only, no columns — keeps the
 * footer's minimal posture intact while giving the legal cluster a
 * discoverable entry point site-wide.
 */

import { Link } from 'react-router-dom';
import { siteConfig } from '../config';
import { Logo } from '../components/brand/Logo';

const FOOTER_LINKS: Array<{ to: string; label: string }> = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/shipping', label: 'Shipping' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export function GlobalFooter() {
  return (
    <footer
      className="border-t border-ink/[0.08] pb-14"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-4)]">
        <div className="flex flex-col items-center gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between">
          <Logo variant="lockup" markSize={18} wordSize={11} showTagline={false} />
          <nav aria-label="Legal" className="flex items-center gap-[var(--space-3)]">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink/40 hover:text-ink/70 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col items-center gap-0.5 sm:items-end">
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink/45 tabular-nums">
              © {new Date().getFullYear()} {siteConfig.brand.legalEntity} · All rights reserved
            </p>
            <p className="text-[8.5px] uppercase tracking-[0.26em] text-ink/30">
              {siteConfig.compliance.footerLine}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
