/**
 * CompoundVisualZone
 *
 * Canonical compound-identity visual band. Pairs the MolecularStructurePanel
 * with the VialRender. Two layout variants:
 *
 *   - `band` (default): horizontal, 200px tall. Molecular left (flex-1),
 *     vial right (300px). Used by the Overlay's top header band.
 *
 *   - `stacked`: vertical. Square molecular on top, vial in a 240px
 *     band below. Used by ProductPage's sticky left column where
 *     vertical space is plentiful but horizontal space is constrained.
 *
 * This is the single "this is the compound" visual anchor for every
 * intelligence surface: Overlay, ProductPage (E3), Landing Hero (E4),
 * and future admin intelligence editor.
 *
 * Desktop-only (`hidden lg:flex`) — mobile surfaces render identity
 * differently (no left/right or stacked visual split; identifier band
 * only).
 *
 * Visuals are frozen. Geometry is part of the system grammar.
 */

import { MolecularStructurePanel } from './MolecularStructurePanel';
import { VialRender } from './VialRender';

interface CompoundVisualZoneProps {
  substance: string;
  abbreviation: string;
  sku: string;
  activeDoseLabel: string;
  variant?: 'band' | 'stacked';
}

export function CompoundVisualZone({
  substance,
  abbreviation,
  sku,
  activeDoseLabel,
  variant = 'band',
}: CompoundVisualZoneProps) {
  if (variant === 'stacked') {
    return (
      <div
        className="hidden lg:flex flex-col shrink-0 overflow-hidden"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Top: molecular structure — square */}
        <div
          className="aspect-square w-full overflow-hidden"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <MolecularStructurePanel substance={substance} abbreviation={abbreviation} />
        </div>

        {/* Bottom: vial — 240px band, centered */}
        <div
          className="shrink-0 flex items-center justify-center overflow-hidden"
          style={{ height: '240px', backgroundColor: '#040404' }}
        >
          <div style={{ width: '110px', height: '232px' }}>
            <VialRender
              substance={substance}
              dose={activeDoseLabel}
              abbreviation={abbreviation}
              sku={sku}
            />
          </div>
        </div>
      </div>
    );
  }

  // band variant (default)
  return (
    <div
      className="hidden lg:flex flex-row shrink-0 overflow-hidden"
      style={{ height: '200px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex-1 min-w-0 overflow-hidden" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <MolecularStructurePanel substance={substance} abbreviation={abbreviation} />
      </div>

      <div
        className="shrink-0 flex items-center justify-center overflow-hidden"
        style={{ width: '300px', backgroundColor: '#040404' }}
      >
        <div style={{ width: '90px', height: '188px' }}>
          <VialRender
            substance={substance}
            dose={activeDoseLabel}
            abbreviation={abbreviation}
            sku={sku}
          />
        </div>
      </div>
    </div>
  );
}
