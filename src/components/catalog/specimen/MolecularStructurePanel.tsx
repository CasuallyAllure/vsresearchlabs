/**
 * MolecularStructurePanel
 *
 * Canonical molecular-structure surface. Resolves the real 2D structure
 * for the active compound from PubChem PUG REST and renders it on the
 * dark theme via a controlled inversion filter. Falls through to
 * MolecularLatticeFallback when PubChem cannot resolve the name.
 *
 * Used by: CompoundVisualZone (Overlay today; ProductPage and Landing
 * Hero on adoption). Anywhere the compound-identity slot is rendered.
 *
 * PubChem returns a white-background PNG with black structure lines and
 * coloured heteroatoms. `filter: invert(1) brightness(0.78)
 * contrast(0.9) saturate(0.22)` converts the white surface to near-black
 * (#050505 register) and softens the heteroatom hues to readable hints.
 *
 * Visuals are frozen. Adjust the filter chain only as a system-wide
 * change.
 */

import { useState } from 'react';
import { MolecularLatticeFallback } from './MolecularLatticeFallback';

interface MolecularStructurePanelProps {
  substance: string;
  abbreviation: string;
}

export function MolecularStructurePanel({ substance, abbreviation }: MolecularStructurePanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const pubchemUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(substance)}/PNG?record_type=2d&image_size=large`;

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: '#F4EFE6' }}>
      {/* Fallback / loading state — always in DOM, fades out when real structure loads */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-700"
        style={{ opacity: loaded && !failed ? 0 : 1 }}
        aria-hidden="true"
      >
        <MolecularLatticeFallback abbreviation={abbreviation} />
      </div>

      {/* Real PubChem structure — fades in when loaded */}
      {!failed && (
        <img
          src={pubchemUrl}
          alt={`${substance} molecular structure`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
          style={{
            padding: '20px',
            // PubChem PNG is black structure on white. multiply drops the
            // white into the cream bay and leaves the dark structure +
            // softened heteroatom hues readable on light.
            filter: 'contrast(0.96) saturate(0.6)',
            mixBlendMode: 'multiply',
            opacity: loaded ? 1 : 0,
          }}
        />
      )}

      {/* Compound label overlay at bottom-left */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-end justify-between pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(244,239,230,0.92) 0%, rgba(244,239,230,0.4) 60%, transparent 100%)' }}>
        <div>
          <p className="font-mono text-ink/22 uppercase" style={{ fontSize: '8px', letterSpacing: '0.22em' }}>
            Molecular Structure
          </p>
          <p className="font-mono text-ink/35 mt-0.5" style={{ fontSize: '9px' }}>
            {substance}
          </p>
        </div>
        {!failed && loaded && (
          <p className="font-mono text-ink/16 uppercase" style={{ fontSize: '7.5px', letterSpacing: '0.16em' }}>
            PubChem
          </p>
        )}
      </div>
    </div>
  );
}
