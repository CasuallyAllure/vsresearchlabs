/**
 * GlobalFooter
 * Phase 3 — VS Research Labs App Shell
 * Stabilization + Final Polish — Institutional terminal state.
 *
 * Quiet, restrained footer rendered globally beneath every route as a
 * peer of <AnimatedPortalShell />. Owns the bottom-nav clearance on
 * mobile (`pb-14 lg:pb-0`), so <AnimatedPortalShell /> no longer needs
 * to over-pad its own bottom edge.
 *
 * Operationally minimal: identifier, role caption with RUO compliance
 * note, and copyright. No social links, no newsletter pattern, no
 * navigation duplication — those would re-introduce consumer-app
 * surface posture that the procurement register has otherwise removed.
 */

import { Logo } from '../components/brand/Logo';

export function GlobalFooter() {
  return (
    <footer
      className="border-t border-ink/[0.08] pb-14 lg:pb-0"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-8)]">
        <div className="flex flex-col gap-[var(--space-4)] sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-[var(--space-3)]">
            <Logo variant="lockup" markSize={26} wordSize={14} showTagline={false} />
            <p className="text-[11px] uppercase tracking-[0.25em] text-ink/40">
              Research procurement · For Research Purposes Only
            </p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/35 tabular-nums sm:text-right">
            © {new Date().getFullYear()} Velari Systems Research Labs
          </p>
        </div>
      </div>
    </footer>
  );
}
