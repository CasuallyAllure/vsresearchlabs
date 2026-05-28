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

export function GlobalFooter() {
  return (
    <footer
      className="border-t border-white/[0.06] pb-14 lg:pb-0"
      role="contentinfo"
    >
      <div className="mx-auto w-full max-w-[1100px] px-[var(--space-6)] py-[var(--space-8)]">
        <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-[var(--space-1)]">
            <p className="text-[11px] uppercase tracking-[0.3em] text-white/45">
              VS Research Labs
            </p>
            <p className="text-[11px] uppercase tracking-[0.25em] text-white/35">
              Research procurement · For Research Purposes Only
            </p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/25 tabular-nums sm:text-right">
            © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
