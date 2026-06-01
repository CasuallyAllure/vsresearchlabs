/**
 * MolecularLatticeFallback
 *
 * Canonical fallback visual for the compound molecular-structure slot.
 * Renders an anthracene-topology fused-ring SVG (three 6-membered rings
 * + substituents) with the product abbreviation as a ghost watermark.
 *
 * Used by:
 *   - MolecularStructurePanel — shown while the PubChem image loads or
 *     when PubChem cannot resolve the compound name.
 *
 * Pure presentational SVG. No I/O. No state. Safe to render anywhere.
 * Visuals are frozen — do not modify without a system-wide design pass.
 */

interface MolecularLatticeFallbackProps {
  abbreviation: string;
}

export function MolecularLatticeFallback({ abbreviation }: MolecularLatticeFallbackProps) {
  // Anthracene-topology fused ring system (3 fused 6-membered rings).
  const nodes: [number, number][] = [
    [56, 36], [78, 48], [78, 72], [56, 84], [34, 72], [34, 48],  // Ring 1
    [100, 36], [122, 48], [122, 72], [100, 84],                   // Ring 2
    [144, 36], [166, 48], [166, 72], [144, 84],                   // Ring 3
    [56, 14], [166, 110], [34, 110],                              // Substituents
  ];
  const bonds: [number, number][] = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,0],
    [1,6],[6,7],[7,8],[8,9],[9,2],
    [7,10],[10,11],[11,12],[12,13],[13,8],
    [0,14],[12,15],[4,16],
  ];
  return (
    <svg viewBox="0 0 200 150" width="100%" height="100%" aria-hidden="true">
      <text x="100" y="78" textAnchor="middle" dominantBaseline="middle"
        fontFamily="monospace" fontSize="56" fontWeight="800"
        fill="white" fillOpacity="0.025" letterSpacing="0.05em">{abbreviation}</text>
      {bonds.map(([a, b], i) => (
        <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="white" strokeOpacity="0.14" strokeWidth="0.6" />
      ))}
      {nodes.slice(0, 14).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill="white" fillOpacity="0.22" />
      ))}
      {nodes.slice(14).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1" fill="white" fillOpacity="0.12" />
      ))}
    </svg>
  );
}
