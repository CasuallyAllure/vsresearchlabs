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
import { pubchemImageUrl } from '../../../lib/pubchem';

interface MolecularStructurePanelProps {
  substance: string;
  abbreviation: string;
  /** Drop the panel's own cream bay background and tighten the structure
   *  padding, so it sits flush on a parent that already owns the surface
   *  (e.g. the terminal's unified specimen plate). */
  bare?: boolean;
  /** Render on a fixed LIGHT viewer surface in both themes — forces light
   *  (multiply) compositing, dark labels, and no dark fade even under
   *  [data-theme=dark]. Pair with a light parent background. */
  lightbox?: boolean;
}

export function MolecularStructurePanel({ substance, abbreviation, bare = false, lightbox = false }: MolecularStructurePanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Prefer a curated CID (peptides like Retatrutide 404 by name), else by name.
  const pubchemUrl = pubchemImageUrl(substance);

  return (
    <div className={`relative w-full h-full overflow-hidden ${bare ? '' : 'mol-structure-bay'} ${lightbox ? 'mol-lightbox' : ''}`}>
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
          className="mol-structure-img absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
          style={{
            // Tighter padding so the structure fills more of the panel.
            // Compositing (multiply on light / invert+screen on dark) lives
            // in theme.css keyed off [data-theme] so the molecule reads on
            // both the cream bay (light) and bare black (dark).
            padding: bare ? '4px' : '10px',
            opacity: loaded ? 1 : 0,
          }}
        />
      )}

      {/* Compound label overlay at bottom-left */}
      <div className="mol-structure-fade absolute bottom-0 left-0 right-0 px-3 py-2 flex items-end justify-between pointer-events-none">
        <div>
          <p className="font-mono text-ink/22 uppercase" style={{ fontSize: '10px', letterSpacing: '0.22em' }}>
            Molecular Structure
          </p>
          <p className="font-mono text-ink/35 mt-0.5" style={{ fontSize: '10px' }}>
            {substance}
          </p>
        </div>
        {!failed && loaded && (
          <p className="font-mono text-ink/16 uppercase" style={{ fontSize: '10px', letterSpacing: '0.16em' }}>
            PubChem
          </p>
        )}
      </div>
    </div>
  );
}
