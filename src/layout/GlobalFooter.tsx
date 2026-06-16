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
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-4)]">
        <div className="flex flex-col items-center gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between">
          <Logo variant="lockup" markSize={18} wordSize={11} showTagline={false} />
          <div className="flex flex-col items-center gap-0.5 sm:items-end">
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink/45 tabular-nums">
              © {new Date().getFullYear()} Velari Systems Research Labs · All rights reserved
            </p>
            <p className="text-[8.5px] uppercase tracking-[0.26em] text-ink/30">
              For Research Use Only — Not for human or veterinary consumption
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
