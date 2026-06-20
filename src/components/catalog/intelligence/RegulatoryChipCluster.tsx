/**
 * RegulatoryChipCluster
 *
 * Canonical regulatory-status surface: Human Trials chip (tinted green
 * when confirmed) + FDA Status string. Always renders both labels when
 * either field is present — the empty-chip register is itself
 * informational ("None known", "Research use only").
 *
 * Consumed by:
 *   - CompoundIntelligenceOverlay (Studies module header)
 *   - CompoundIntelligenceHero (Studies slide) — pending re-skin
 *   - ProductPage (E3 Regulatory module) — pending
 *
 * Visuals are frozen. The green register (rgba(100,175,100,*)) is the
 * single approved positive-state color in the intelligence system; do
 * not introduce alternative success colors elsewhere.
 */

interface RegulatoryChipClusterProps {
  /** Whether at least one human clinical trial is confirmed. `undefined` hides the Human Trials chip entirely. */
  humanTrials: boolean | undefined;
  /** Regulatory status string. `undefined` hides the FDA Status row. */
  fdaStatus: string | undefined;
}

function isNegativeFdaStatus(status: string): boolean {
  const s = status.toLowerCase();
  // "Approved — …" and similar affirmative leads are NOT warnings.
  // Anything reading "not approved", "not fda approved", "investigational",
  // "preclinical", or "research use only" is a warning register.
  if (s.startsWith('approved')) return false;
  return (
    s.includes('not approved') ||
    s.includes('not fda') ||
    s.includes('investigational') ||
    s.includes('preclinical') ||
    s.includes('research use only')
  );
}

export function RegulatoryChipCluster({ humanTrials, fdaStatus }: RegulatoryChipClusterProps) {
  if (humanTrials === undefined && !fdaStatus) return null;
  const fdaIsWarning = fdaStatus ? isNegativeFdaStatus(fdaStatus) : false;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 pb-3 mb-1"
      style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      {humanTrials !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-ink/28 uppercase" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>Human Trials</span>
          <span className="uppercase"
            style={{
              fontSize: '8px', letterSpacing: '0.14em', padding: '1px 5px', borderRadius: '2px',
              backgroundColor: humanTrials ? 'rgba(100,175,100,0.10)' : 'var(--color-interactive-secondary)',
              border: humanTrials ? '1px solid rgba(100,175,100,0.22)' : '1px solid var(--color-border-subtle)',
              color: humanTrials ? 'rgba(140,200,140,0.82)' : 'var(--color-content-tertiary)',
            }}>
            {humanTrials ? 'Confirmed' : 'None known'}
          </span>
        </div>
      )}
      {fdaStatus && (
        <div className="flex items-center gap-2">
          <span className="text-ink/28 uppercase" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>FDA Status</span>
          <span
            className={fdaIsWarning ? 'holo-text-warning font-semibold' : 'text-ink/48'}
            style={{ fontSize: '9px' }}
          >
            {fdaStatus}
          </span>
        </div>
      )}
    </div>
  );
}
