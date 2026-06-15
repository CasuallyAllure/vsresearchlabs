/**
 * VialRender
 *
 * Canonical specimen-vial visual. SVG illustration of a lyophilized
 * peptide research vial — borosilicate glass body, rubber stopper,
 * aluminum crimp cap, labeled with the compound identity band.
 *
 * Used by: CompoundVisualZone (Overlay today; ProductPage and Landing
 * Hero on adoption). The canonical "this is the product" anchor.
 *
 * Label layout is responsive to substance-name length: names longer
 * than 11 chars wrap to a second line and the subsequent label rows
 * shift down accordingly.
 *
 * Visuals are frozen. Adjustments require a system-wide design pass.
 */

interface VialRenderProps {
  substance: string;
  dose: string;
  abbreviation: string;
  sku: string;
}

export function VialRender({ substance, dose, abbreviation, sku }: VialRenderProps) {
  const nameLine1 = substance.length > 11 ? substance.slice(0, 11) : substance;
  const nameLine2 = substance.length > 11 ? substance.slice(11) : '';

  return (
    <svg viewBox="0 0 100 220" aria-label={`${substance} research vial`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="vr-cap" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(110,110,110)" />
          <stop offset="25%" stopColor="rgb(185,185,185)" />
          <stop offset="55%" stopColor="rgb(200,200,200)" />
          <stop offset="85%" stopColor="rgb(170,170,170)" />
          <stop offset="100%" stopColor="rgb(100,100,100)" />
        </linearGradient>
        <linearGradient id="vr-glass" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="rgba(26,23,20,0.20)" />
          <stop offset="7%"   stopColor="rgba(26,23,20,0.07)" />
          <stop offset="50%"  stopColor="rgba(26,23,20,0.01)" />
          <stop offset="90%"  stopColor="rgba(26,23,20,0.05)" />
          <stop offset="100%" stopColor="rgba(26,23,20,0.16)" />
        </linearGradient>
        <linearGradient id="vr-powder" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="rgba(26,23,20,0.20)" />
          <stop offset="100%" stopColor="rgba(26,23,20,0.07)" />
        </linearGradient>
        <radialGradient id="vr-bg" cx="50%" cy="25%" r="70%">
          <stop offset="0%"   stopColor="rgba(26,23,20,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <clipPath id="vr-body-clip">
          <rect x="22" y="46" width="56" height="142" rx="4" />
        </clipPath>
      </defs>

      {/* Laboratory ambient environment light */}
      <ellipse cx="50" cy="105" rx="44" ry="88" fill="url(#vr-bg)" />

      {/* ── CRIMP CAP ── */}
      <rect x="31" y="5" width="38" height="16" rx="3" fill="url(#vr-cap)" />
      <ellipse cx="50" cy="13" rx="10" ry="5.5" fill="rgba(210,210,210,0.20)" stroke="rgba(200,200,200,0.35)" strokeWidth="0.4" />
      <ellipse cx="50" cy="13" rx="5.5" ry="3" fill="rgba(190,190,190,0.12)" />
      <rect x="31" y="18" width="38" height="3" rx="0" fill="rgba(130,130,130,0.5)" />

      {/* ── RUBBER STOPPER ── */}
      <rect x="33" y="18" width="34" height="16" rx="2" fill="rgb(26,26,26)" />
      <rect x="35" y="20" width="30" height="2" rx="0.5" fill="rgba(55,55,55,0.6)" />
      <rect x="36" y="23" width="28" height="1" rx="0.5" fill="rgba(48,48,48,0.4)" />

      {/* ── GLASS NECK ── */}
      <rect x="33" y="32" width="34" height="16" fill="rgba(26,23,20,0.012)" />
      <line x1="33" y1="32" x2="33" y2="48" stroke="rgba(26,23,20,0.22)" strokeWidth="0.7" />
      <line x1="67" y1="32" x2="67" y2="48" stroke="rgba(26,23,20,0.16)" strokeWidth="0.7" />
      <path d="M33 46 L22 50 M67 46 L78 50" stroke="rgba(26,23,20,0.14)" strokeWidth="0.6" fill="none" />

      {/* ── GLASS BODY ── */}
      <rect x="22" y="46" width="56" height="142" rx="4" fill="rgba(26,23,20,0.012)" stroke="rgba(26,23,20,0.22)" strokeWidth="0.8" />
      <rect x="22" y="46" width="56" height="142" rx="4" fill="url(#vr-glass)" />
      <rect x="23.5" y="48" width="5" height="138" rx="2.5" fill="rgba(26,23,20,0.11)" />
      <rect x="74" y="48" width="3" height="138" rx="1.5" fill="rgba(26,23,20,0.07)" />

      {/* ── LYOPHILIZED POWDER CAKE ── */}
      <rect x="24" y="140" width="52" height="46" clipPath="url(#vr-body-clip)" fill="url(#vr-powder)" />
      <path d="M24 140 Q50 136 76 140" stroke="rgba(26,23,20,0.28)" strokeWidth="0.6" fill="none" clipPath="url(#vr-body-clip)" />
      <rect x="25" y="145" width="50" height="0.8" fill="rgba(26,23,20,0.04)" clipPath="url(#vr-body-clip)" />
      <rect x="26" y="152" width="48" height="0.8" fill="rgba(26,23,20,0.03)" clipPath="url(#vr-body-clip)" />
      <rect x="25" y="160" width="50" height="0.8" fill="rgba(26,23,20,0.02)" clipPath="url(#vr-body-clip)" />

      {/* ── GRADUATION MARKS ── */}
      <line x1="22" y1="88"  x2="27" y2="88"  stroke="rgba(26,23,20,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="104" x2="27" y2="104" stroke="rgba(26,23,20,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="120" x2="27" y2="120" stroke="rgba(26,23,20,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="136" x2="27" y2="136" stroke="rgba(26,23,20,0.24)" strokeWidth="0.4" />

      {/* ── COMPOUND LABEL ── */}
      <rect x="25" y="54" width="50" height="80" rx="1.5" fill="rgba(255,255,255,0.94)" stroke="rgba(26,23,20,0.06)" strokeWidth="0.3" />

      <text x="50" y="64" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4" fill="rgba(26,23,20,0.45)" letterSpacing="0.06em">VS RESEARCH LABS</text>
      <line x1="28" y1="67" x2="72" y2="67" stroke="rgba(26,23,20,0.09)" strokeWidth="0.3" />

      <text x="50" y="80" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="13" fontWeight="bold" fill="rgba(26,23,20,0.88)" letterSpacing="0.08em">{abbreviation}</text>

      <line x1="28" y1="85" x2="72" y2="85" stroke="rgba(26,23,20,0.09)" strokeWidth="0.3" />

      <text x="50" y="93" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4.5" fill="rgba(26,23,20,0.58)">
        {nameLine1}
      </text>
      {nameLine2 && (
        <text x="50" y="99" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4.5" fill="rgba(26,23,20,0.50)">
          {nameLine2}
        </text>
      )}

      <text x="50" y={nameLine2 ? 108 : 102} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="5.5" fontWeight="bold" fill="rgba(26,23,20,0.65)">{dose}</text>

      <line x1="28" y1={nameLine2 ? 111 : 105} x2="72" y2={nameLine2 ? 111 : 105} stroke="rgba(26,23,20,0.08)" strokeWidth="0.3" />

      <text x="50" y={nameLine2 ? 118 : 112} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="3" fill="rgba(26,23,20,0.22)" letterSpacing="0.04em">
        {sku.slice(0, 16)}
      </text>

      <text x="50" y={nameLine2 ? 126 : 120} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="3" fill="rgba(26,23,20,0.20)" letterSpacing="0.06em">FOR RESEARCH USE ONLY</text>
      <text x="50" y={nameLine2 ? 131 : 125} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="2.8" fill="rgba(26,23,20,0.14)" letterSpacing="0.04em">NOT FOR HUMAN USE</text>

      {/* ── SURFACE SHADOW + REFLECTION ── */}
      <ellipse cx="50" cy="191" rx="32" ry="4" fill="rgba(26,23,20,0.20)" />
      <ellipse cx="50" cy="193" rx="20" ry="1.5" fill="rgba(26,23,20,0.025)" />
    </svg>
  );
}
