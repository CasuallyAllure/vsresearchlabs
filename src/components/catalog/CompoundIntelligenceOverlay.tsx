import { useEffect, useRef, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Product, ResearchClassification, ProductStudy, StudyModel } from '../../types';
import { deriveProductDose } from '../../types';
import { useCart } from '../../hooks/useCart';
import { AbbreviationChip } from './AbbreviationChip';

// ─── Classification labels ────────────────────────────────────────────────────

const CLASSIFICATION_LABEL: Partial<Record<ResearchClassification, string>> = {
  'glp-1-agonist': 'GLP-1 Agonist',
  'dual-agonist': 'Dual GIP/GLP-1 Agonist',
  'triple-agonist': 'Triple Agonist',
  'growth-hormone-secretagogue': 'GH Secretagogue',
  'growth-factor': 'Growth Factor',
  'metabolic-lipolytic': 'Metabolic / Lipolytic',
  'nootropic-neuroactive': 'Nootropic / Neuroactive',
  'regenerative-healing': 'Regenerative / Healing',
  'immunomodulatory': 'Immunomodulatory',
  'bio-regulator': 'Bio-Regulator',
  'experimental': 'Experimental',
};

const STUDY_MODEL_LABEL: Record<StudyModel, string> = {
  'human':    'Human Study',
  'rat':      'Rat Model',
  'mouse':    'Mouse Model',
  'in-vitro': 'In Vitro',
  'in-vivo':  'In Vivo',
  'ex-vivo':  'Ex Vivo',
  'review':   'Review',
};

function substanceName(name: string): string {
  for (const sep of [' — ', ' – ', ' - ']) {
    const idx = name.indexOf(sep);
    if (idx > -1) return name.slice(0, idx).trim();
  }
  return name;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── IntelModule — collapsible numbered module ────────────────────────────────

interface IntelModuleProps {
  index: number;
  title: string;
  defaultOpen?: boolean;
  reserved?: boolean;
  children?: ReactNode;
}

function IntelModule({ index, title, defaultOpen = false, reserved = false, children }: IntelModuleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="cio-module"
      style={{ '--mi': index, borderBottom: '1px solid rgba(255,255,255,0.05)' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 py-2.5 px-4 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/20 active:scale-[0.99]"
        style={{ backgroundColor: open ? 'rgba(255,255,255,0.022)' : 'transparent', transition: 'background-color 120ms ease-out' }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.028)'; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
      >
        <span className="font-mono tabular-nums text-white/30 shrink-0 leading-none" style={{ fontSize: '9.5px', minWidth: '14px' }}>
          {String(index).padStart(2, '0')}
        </span>
        <span className="flex-1 min-w-0 text-white/58" style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          {title}
        </span>
        {reserved && (
          <span className="text-white/22 shrink-0" style={{ fontSize: '8.5px', letterSpacing: '0.18em', textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', padding: '1px 4px' }}>
            Planned
          </span>
        )}
        <ChevronDownIcon open={open} />
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 200ms cubic-bezier(0.23, 1, 0.32, 1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ backgroundColor: open ? '#181818' : 'transparent', transition: 'background-color 200ms cubic-bezier(0.23, 1, 0.32, 1)', borderTop: open ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent' }}>
            {reserved ? (
              <div className="px-4 py-4">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-[2px]" style={{ border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-white/22 shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span className="text-white/28" style={{ fontSize: '10.5px', letterSpacing: '0.04em' }}>{title} documentation pending</span>
                </div>
              </div>
            ) : children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Module content atoms ────────────────────────────────────────────────────

function ModuleBody({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3">{children}</div>;
}

function ModuleText({ children }: { children: string }) {
  return <p className="text-white/60 leading-[1.65]" style={{ fontSize: '12.5px', maxWidth: '65ch' }}>{children}</p>;
}

function DataGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 min-w-0">
          <dt className="text-white/32 shrink-0" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>{r.label}</dt>
          <dd className="text-white/62 text-right font-mono truncate tabular-nums" style={{ fontSize: '10.5px' }}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-[2px] px-2 py-1.5 min-w-0"
      style={{
        backgroundColor: highlight ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)',
        border: highlight ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.06)',
        transition: 'background-color 150ms ease-out, border-color 150ms ease-out',
      }}>
      <p className="text-white/28 uppercase truncate" style={{ fontSize: '8.5px', letterSpacing: '0.24em' }}>{label}</p>
      <p className="text-white/60 font-mono truncate mt-0.5" style={{ fontSize: '10.5px' }}>{value}</p>
    </div>
  );
}

// ─── Interactive tier selector ────────────────────────────────────────────────

function TierSelector({ variants, selectedIndex, onSelect }: { variants: Product['variants']; selectedIndex: number; onSelect: (i: number) => void }) {
  if (!variants || variants.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {variants.map((v, i) => {
        const active = i === selectedIndex;
        return (
          <button key={v.dose} type="button" onClick={() => onSelect(i)}
            className="rounded-[2px] font-mono tabular-nums focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 active:scale-[0.95]"
            style={{
              padding: '4px 10px', fontSize: '11px',
              backgroundColor: active ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.025)',
              border: active ? '1px solid rgba(255,255,255,0.24)' : '1px solid rgba(255,255,255,0.07)',
              color: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)',
              transition: 'background-color 100ms ease-out, border-color 100ms ease-out, color 100ms ease-out, transform 100ms ease-out',
            }}>
            {v.dose}
          </button>
        );
      })}
    </div>
  );
}

// ─── Study row — operational intelligence format ──────────────────────────────

function StudyRow({ study, idx }: { study: ProductStudy; idx: number }) {
  const isHumanTrial = study.model === 'human';
  return (
    <div className="py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Index + title + link */}
      <div className="flex items-start gap-2.5 mb-2">
        <span className="font-mono text-white/20 tabular-nums shrink-0 pt-0.5" style={{ fontSize: '9px', minWidth: '14px' }}>
          {String(idx + 1).padStart(2, '0')}
        </span>
        <p className="text-white/68 flex-1 min-w-0 leading-snug" style={{ fontSize: '11.5px' }}>
          {study.title}
        </p>
        {study.url && (
          <a href={study.url} target="_blank" rel="noopener noreferrer"
            className="text-white/22 hover:text-white/65 transition-colors shrink-0 mt-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-sm"
            aria-label="Open study source">
            <ExternalLinkIcon />
          </a>
        )}
      </div>

      {/* Meta row: year · model · source · phase */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 mb-2">
        <span className="text-white/30 font-mono tabular-nums" style={{ fontSize: '9.5px' }}>{study.year}</span>
        <span className="text-white/14" aria-hidden="true">·</span>
        <span
          className="uppercase"
          style={{
            fontSize: '8px', letterSpacing: '0.14em', padding: '1px 4px', borderRadius: '2px',
            backgroundColor: isHumanTrial ? 'rgba(100,160,255,0.08)' : 'rgba(255,255,255,0.04)',
            border: isHumanTrial ? '1px solid rgba(100,160,255,0.18)' : '1px solid rgba(255,255,255,0.07)',
            color: isHumanTrial ? 'rgba(140,185,255,0.75)' : 'rgba(255,255,255,0.35)',
          }}>
          {STUDY_MODEL_LABEL[study.model]}
        </span>
        <span className="text-white/14" aria-hidden="true">·</span>
        <span className="text-white/28" style={{ fontSize: '9.5px' }}>{study.source}</span>
        {study.phase && (
          <>
            <span className="text-white/14" aria-hidden="true">·</span>
            <span className="text-white/30 uppercase" style={{ fontSize: '8px', letterSpacing: '0.12em', backgroundColor: 'rgba(255,255,255,0.03)', padding: '1px 4px', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.06)' }}>
              {study.phase}
            </span>
          </>
        )}
      </div>

      {/* Observed findings */}
      {study.notes && study.notes.length > 0 && (
        <div className="pl-5">
          <p className="text-white/20 uppercase mb-1.5" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>Observed</p>
          <ul className="space-y-1">
            {study.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-white/25 shrink-0 mt-[3px]" aria-hidden="true" style={{ fontSize: '8px' }}>•</span>
                <span className="text-white/45" style={{ fontSize: '10.5px', lineHeight: '1.5' }}>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Molecular structure panel — PubChem REST + lattice fallback ──────────────
// Fetches real 2D structure from PubChem by compound name. Applies dark-theme
// CSS filter (invert + desaturate) so the white-bg PNG reads on #050505.
// Falls back to abstract molecular lattice if PubChem doesn't know the name.

function MolecularLatticeFallback({ abbreviation }: { abbreviation: string }) {
  // Anthracene-topology fused ring system (3 fused 6-membered rings).
  // Used as fallback when PubChem structure is unavailable.
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

function MolecularStructurePanel({ substance, abbreviation }: { substance: string; abbreviation: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // PubChem PUG REST API — 2D structure PNG by compound name.
  // Returns white-bg PNG with black structure lines. CSS filter inverts for dark theme.
  const pubchemUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(substance)}/PNG?record_type=2d&image_size=large`;

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: '#050505' }}>
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
            // Invert white→black, desaturate heteroatom colors, reduce brightness
            filter: 'invert(1) brightness(0.78) contrast(0.9) saturate(0.22)',
            opacity: loaded ? 1 : 0,
          }}
        />
      )}

      {/* Compound label overlay at bottom-left */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-end justify-between pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(5,5,5,0.92) 0%, rgba(5,5,5,0.4) 60%, transparent 100%)' }}>
        <div>
          <p className="font-mono text-white/22 uppercase" style={{ fontSize: '8px', letterSpacing: '0.22em' }}>
            Molecular Structure
          </p>
          <p className="font-mono text-white/35 mt-0.5" style={{ fontSize: '9px' }}>
            {substance}
          </p>
        </div>
        {!failed && loaded && (
          <p className="font-mono text-white/16 uppercase" style={{ fontSize: '7.5px', letterSpacing: '0.16em' }}>
            PubChem
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Vial render — SVG scientific illustration ────────────────────────────────
// Lyophilized peptide research vial (borosilicate glass, rubber stopper,
// aluminum crimp cap, labeled with compound identity).

function VialRender({ substance, dose, abbreviation, sku }: { substance: string; dose: string; abbreviation: string; sku: string }) {
  // Split compound name for label if >11 chars
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
          <stop offset="0%"   stopColor="rgba(255,255,255,0.20)" />
          <stop offset="7%"   stopColor="rgba(255,255,255,0.07)" />
          <stop offset="50%"  stopColor="rgba(255,255,255,0.01)" />
          <stop offset="90%"  stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.16)" />
        </linearGradient>
        <linearGradient id="vr-powder" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.20)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.07)" />
        </linearGradient>
        <radialGradient id="vr-bg" cx="50%" cy="25%" r="70%">
          <stop offset="0%"   stopColor="rgba(42,42,42,0.45)" />
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
      {/* Cap center tear-disc */}
      <ellipse cx="50" cy="13" rx="10" ry="5.5" fill="rgba(210,210,210,0.20)" stroke="rgba(200,200,200,0.35)" strokeWidth="0.4" />
      <ellipse cx="50" cy="13" rx="5.5" ry="3" fill="rgba(190,190,190,0.12)" />
      {/* Cap lower crimp ring */}
      <rect x="31" y="18" width="38" height="3" rx="0" fill="rgba(130,130,130,0.5)" />

      {/* ── RUBBER STOPPER ── */}
      <rect x="33" y="18" width="34" height="16" rx="2" fill="rgb(26,26,26)" />
      <rect x="35" y="20" width="30" height="2" rx="0.5" fill="rgba(55,55,55,0.6)" />
      <rect x="36" y="23" width="28" height="1" rx="0.5" fill="rgba(48,48,48,0.4)" />

      {/* ── GLASS NECK (connects stopper to body) ── */}
      <rect x="33" y="32" width="34" height="16" fill="rgba(255,255,255,0.012)" />
      <line x1="33" y1="32" x2="33" y2="48" stroke="rgba(255,255,255,0.22)" strokeWidth="0.7" />
      <line x1="67" y1="32" x2="67" y2="48" stroke="rgba(255,255,255,0.16)" strokeWidth="0.7" />
      {/* Neck shoulder taper (wider at body) */}
      <path d="M33 46 L22 50 M67 46 L78 50" stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" fill="none" />

      {/* ── GLASS BODY ── */}
      <rect x="22" y="46" width="56" height="142" rx="4" fill="rgba(255,255,255,0.012)" stroke="rgba(255,255,255,0.22)" strokeWidth="0.8" />
      {/* Glass gradient / cylindrical highlight */}
      <rect x="22" y="46" width="56" height="142" rx="4" fill="url(#vr-glass)" />
      {/* Left edge highlight (primary specular) */}
      <rect x="23.5" y="48" width="5" height="138" rx="2.5" fill="rgba(255,255,255,0.11)" />
      {/* Right edge highlight (secondary) */}
      <rect x="74" y="48" width="3" height="138" rx="1.5" fill="rgba(255,255,255,0.07)" />

      {/* ── LYOPHILIZED POWDER CAKE ── */}
      <rect x="24" y="140" width="52" height="46" clipPath="url(#vr-body-clip)" fill="url(#vr-powder)" />
      {/* Powder surface meniscus */}
      <path d="M24 140 Q50 136 76 140" stroke="rgba(255,255,255,0.28)" strokeWidth="0.6" fill="none" clipPath="url(#vr-body-clip)" />
      {/* Cake texture bands */}
      <rect x="25" y="145" width="50" height="0.8" fill="rgba(255,255,255,0.04)" clipPath="url(#vr-body-clip)" />
      <rect x="26" y="152" width="48" height="0.8" fill="rgba(255,255,255,0.03)" clipPath="url(#vr-body-clip)" />
      <rect x="25" y="160" width="50" height="0.8" fill="rgba(255,255,255,0.02)" clipPath="url(#vr-body-clip)" />

      {/* ── GRADUATION MARKS ── */}
      <line x1="22" y1="88"  x2="27" y2="88"  stroke="rgba(255,255,255,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="104" x2="27" y2="104" stroke="rgba(255,255,255,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="120" x2="27" y2="120" stroke="rgba(255,255,255,0.24)" strokeWidth="0.4" />
      <line x1="22" y1="136" x2="27" y2="136" stroke="rgba(255,255,255,0.24)" strokeWidth="0.4" />

      {/* ── COMPOUND LABEL ── */}
      <rect x="25" y="54" width="50" height="80" rx="1.5" fill="rgba(8,8,8,0.90)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />

      {/* Label: VS Research Labs */}
      <text x="50" y="64" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4" fill="rgba(255,255,255,0.45)" letterSpacing="0.06em">VS RESEARCH LABS</text>
      <line x1="28" y1="67" x2="72" y2="67" stroke="rgba(255,255,255,0.09)" strokeWidth="0.3" />

      {/* Label: Abbreviation (primary compound identifier) */}
      <text x="50" y="80" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="13" fontWeight="bold" fill="rgba(255,255,255,0.88)" letterSpacing="0.08em">{abbreviation}</text>

      <line x1="28" y1="85" x2="72" y2="85" stroke="rgba(255,255,255,0.09)" strokeWidth="0.3" />

      {/* Label: Substance name */}
      <text x="50" y="93" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4.5" fill="rgba(255,255,255,0.58)">
        {nameLine1}
      </text>
      {nameLine2 && (
        <text x="50" y="99" textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="4.5" fill="rgba(255,255,255,0.50)">
          {nameLine2}
        </text>
      )}

      {/* Label: Dose */}
      <text x="50" y={nameLine2 ? 108 : 102} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="5.5" fontWeight="bold" fill="rgba(255,255,255,0.65)">{dose}</text>

      <line x1="28" y1={nameLine2 ? 111 : 105} x2="72" y2={nameLine2 ? 111 : 105} stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />

      {/* Label: SKU fragment */}
      <text x="50" y={nameLine2 ? 118 : 112} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="3" fill="rgba(255,255,255,0.22)" letterSpacing="0.04em">
        {sku.slice(0, 16)}
      </text>

      {/* Label: Research use only */}
      <text x="50" y={nameLine2 ? 126 : 120} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="3" fill="rgba(255,255,255,0.20)" letterSpacing="0.06em">FOR RESEARCH USE ONLY</text>
      <text x="50" y={nameLine2 ? 131 : 125} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize="2.8" fill="rgba(255,255,255,0.14)" letterSpacing="0.04em">NOT FOR HUMAN USE</text>

      {/* ── SURFACE SHADOW + REFLECTION ── */}
      <ellipse cx="50" cy="191" rx="32" ry="4" fill="rgba(0,0,0,0.55)" />
      <ellipse cx="50" cy="193" rx="20" ry="1.5" fill="rgba(255,255,255,0.025)" />
    </svg>
  );
}

// ─── Compound visual zone — full-width top anchor ─────────────────────────────
// LEFT: real molecular structure from PubChem (or lattice fallback)
// RIGHT: photorealistic SVG vial render aligned to passport column width

function CompoundVisualZone({ product, substance, activeDoseLabel }: { product: Product; substance: string; activeDoseLabel: string }) {
  return (
    <div
      className="hidden lg:flex flex-row shrink-0 overflow-hidden"
      style={{ height: '200px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Left: molecular structure */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <MolecularStructurePanel substance={substance} abbreviation={product.abbreviation} />
      </div>

      {/* Right: vial render — 300px, aligns with passport column */}
      <div
        className="shrink-0 flex items-center justify-center overflow-hidden"
        style={{ width: '300px', backgroundColor: '#040404' }}
      >
        <div style={{ width: '90px', height: '188px' }}>
          <VialRender
            substance={substance}
            dose={activeDoseLabel}
            abbreviation={product.abbreviation}
            sku={product.sku}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

interface CompoundIntelligenceOverlayProps {
  product: Product;
  onClose: () => void;
}

export function CompoundIntelligenceOverlay({ product, onClose }: CompoundIntelligenceOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const add = useCart((s) => s.add);
  const updateQuantity = useCart((s) => s.updateQuantity);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onCloseRef.current = onClose; });

  const [selectedTierIndex, setSelectedTierIndex] = useState<number>(() => {
    const defaultDose = deriveProductDose(product);
    const idx = product.variants?.findIndex((v) => v.dose === defaultDose) ?? -1;
    return idx >= 0 ? idx : 0;
  });
  const [quantity, setQuantity] = useState(1);

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onCloseRef.current(), 230);
  }

  function handleAddToInquiry() {
    const currentItems = useCart.getState().items;
    const existing = currentItems.find((i) => i.product.id === product.id);
    if (existing) {
      updateQuantity(product.id, existing.quantity + quantity);
    } else {
      add(product);
      if (quantity > 1) updateQuantity(product.id, quantity);
    }
  }

  useEffect(() => {
    const y = window.scrollY;
    document.body.style.cssText = `position:fixed;top:-${y}px;width:100%;overflow-y:scroll`;
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      document.body.style.cssText = '';
      window.scrollTo(0, y);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLElement>('button, [href]');
    el?.focus();
  }, []);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const substance = substanceName(product.name);
  const activeTier = product.variants?.[selectedTierIndex] ?? null;
  const activeDoseLabel = activeTier?.dose ?? deriveProductDose(product);
  const classLabel = product.researchClassification
    ? (CLASSIFICATION_LABEL[product.researchClassification] ?? product.family)
    : product.family;
  const hasMolecularData = !!(product.mechanismSummary || product.receptorActivity || product.pathwaySummary);
  const hasStudies = !!(product.knownStudies && product.knownStudies.length > 0);

  const passportStats = useMemo(() => {
    const s: Array<{ label: string; value: string; highlight?: boolean }> = [];
    const purity = product.specs.find((x) => x.label === 'Purity (HPLC)');
    if (purity) s.push({ label: 'Purity', value: purity.value });
    const form = product.specs.find((x) => x.label === 'Form');
    if (form) s.push({ label: 'Form', value: form.value });
    if (activeDoseLabel) s.push({ label: 'Tier', value: activeDoseLabel, highlight: true });
    if (product.molecularWeight) s.push({ label: 'MW', value: product.molecularWeight });
    return s.slice(0, 4);
  }, [product, activeDoseLabel]);

  const analyticalRows = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    product.specs.filter((s) => ['Purity (HPLC)', 'Form', 'Mass', 'Volume', 'Quantity'].includes(s.label)).forEach((s) => rows.push({ label: s.label, value: s.value }));
    if (product.casNumber) rows.push({ label: 'CAS Number', value: product.casNumber });
    if (product.molecularWeight) rows.push({ label: 'Molecular Weight', value: product.molecularWeight });
    if (product.testingStandard) rows.push({ label: 'Testing Standard', value: product.testingStandard });
    return rows;
  }, [product]);

  const procurementRows = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (product.manufacturer) rows.push({ label: 'Manufacturer', value: product.manufacturer });
    if (product.countryOfOrigin) rows.push({ label: 'Origin', value: product.countryOfOrigin });
    if (product.storageCondition) rows.push({ label: 'Storage', value: product.storageCondition });
    if (product.shippingCondition) rows.push({ label: 'Shipping', value: product.shippingCondition });
    if (product.lotNumber) rows.push({ label: 'Lot', value: product.lotNumber });
    if (product.batchReference) rows.push({ label: 'Batch', value: product.batchReference });
    if (product.leadTimeDays !== undefined) rows.push({ label: 'Lead Time', value: `${product.leadTimeDays} business days` });
    return rows;
  }, [product]);

  const allSpecs = useMemo(() => product.specs.map((s) => ({ label: s.label, value: s.value })), [product]);

  const moduleList = useMemo(() => {
    type ModuleDef =
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'text'; content: string }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'tiers' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'datagrid'; rows: Array<{ label: string; value: string }> }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'studies' }
      | { key: string; title: string; defaultOpen?: boolean; reserved?: boolean; kind: 'reserved' };

    const defs: ModuleDef[] = [];
    if (product.mechanismSummary) defs.push({ key: 'mech', title: 'Mechanism of Action', defaultOpen: true, kind: 'text', content: product.mechanismSummary });
    if (product.receptorActivity) defs.push({ key: 'receptor', title: 'Receptor / Target Activity', kind: 'text', content: product.receptorActivity });
    if (product.pathwaySummary) defs.push({ key: 'pathway', title: 'Signaling Pathway', kind: 'text', content: product.pathwaySummary });
    if ((product.variants?.length ?? 0) > 0) defs.push({ key: 'tiers', title: 'Available Tiers', kind: 'tiers' });
    if (analyticalRows.length > 0) defs.push({ key: 'analytical', title: 'Analytical Parameters', kind: 'datagrid', rows: analyticalRows });
    if (!hasMolecularData && allSpecs.length > 0) defs.push({ key: 'specs', title: 'Specifications', kind: 'datagrid', rows: allSpecs });
    if (procurementRows.length > 0) defs.push({ key: 'procurement', title: 'Procurement Data', kind: 'datagrid', rows: procurementRows });
    if (hasStudies) defs.push({ key: 'studies', title: 'Known Studies', kind: 'studies' });
    else if (hasMolecularData) defs.push({ key: 'media', title: 'Research Media', kind: 'reserved', reserved: true });
    return defs.map((m, i) => ({ ...m, index: i + 1 }));
  }, [product, analyticalRows, procurementRows, allSpecs, hasMolecularData, hasStudies]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div aria-hidden="true" onClick={handleClose} className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.82)', animation: closing ? 'cio-bd-out 200ms linear forwards' : 'cio-bd 180ms linear forwards' }} />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 lg:p-10 pointer-events-none">
        {/* Panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Compound intelligence: ${substance}`}
          className="cio-panel-el pointer-events-auto w-full overflow-hidden flex flex-col"
          style={{
            maxWidth: '1080px',
            height: 'min(calc(100dvh - 40px), 860px)',
            backgroundColor: '#0d0d0d',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 40px 120px rgba(0,0,0,0.85)',
            animation: closing ? 'cio-panel-out 230ms cubic-bezier(0.23, 1, 0.32, 1) forwards' : 'cio-panel 280ms cubic-bezier(0.23, 1, 0.32, 1) forwards',
          }}
        >
          {/* ── TOP: Full-width visual identity zone (desktop) ───────────── */}
          <CompoundVisualZone product={product} substance={substance} activeDoseLabel={activeDoseLabel} />

          {/* ── BOTTOM: Two-column layout ─────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

            {/* Left passport — no specimen bay (moved to visual zone above) */}
            <div className="hidden lg:flex flex-col overflow-hidden shrink-0"
              style={{ width: '300px', backgroundColor: '#090909', borderRight: '1px solid rgba(255,255,255,0.07)' }}>

              {/* Passport header */}
              <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <span className="text-white/38 uppercase" style={{ fontSize: '9px', letterSpacing: '0.28em' }}>
                  {classLabel || 'Compound'}
                </span>
                <button type="button" onClick={handleClose} aria-label="Close compound intelligence"
                  className="h-6 w-6 flex items-center justify-center text-white/28 hover:text-white/78 active:scale-[0.92] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-sm">
                  <CloseIcon />
                </button>
              </div>

              {/* Compound identity */}
              <div className="px-4 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 min-w-0 mb-2">
                  <AbbreviationChip value={product.abbreviation} />
                </div>
                <h2 className="text-white font-medium leading-tight" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>
                  {substance}
                </h2>
                {(product.casNumber || product.molecularWeight) && (
                  <div className="mt-2 space-y-0.5">
                    {product.casNumber && (
                      <p className="font-mono text-white/40 tabular-nums" style={{ fontSize: '10px' }}>
                        CAS <span className="text-white/55">{product.casNumber}</span>
                      </p>
                    )}
                    {product.molecularWeight && (
                      <p className="font-mono text-white/40 tabular-nums" style={{ fontSize: '10px' }}>
                        MW&nbsp;&nbsp;<span className="text-white/55">{product.molecularWeight}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Passport key stats */}
              {passportStats.length > 0 && (
                <div className="px-4 py-3.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="grid grid-cols-2 gap-1">
                    {passportStats.map((s) => (
                      <StatChip key={s.label} label={s.label} value={s.value} highlight={s.highlight} />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1" />

              {/* Desktop CTA */}
              <div className="shrink-0 px-4 pb-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-2">
                  {/* Quantity stepper */}
                  <div className="flex items-center shrink-0 rounded-[2px] overflow-hidden"
                    style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                    <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"
                      className="w-7 h-8 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
                      style={{ fontSize: '16px', lineHeight: 1 }}>−</button>
                    <span className="w-8 h-8 flex items-center justify-center font-mono tabular-nums text-white/70 select-none"
                      style={{ fontSize: '12px', borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                      {quantity}
                    </span>
                    <button type="button" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="Increase quantity"
                      className="w-7 h-8 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
                      style={{ fontSize: '16px', lineHeight: 1 }}>+</button>
                  </div>
                  {/* Add to inquiry */}
                  <button type="button" onClick={handleAddToInquiry}
                    className="flex-1 h-8 text-white font-medium rounded-[2px] active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
                    style={{ fontSize: '11px', letterSpacing: '0.04em', backgroundColor: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.16)', transition: 'background-color 120ms ease-out, border-color 120ms ease-out, transform 100ms ease-out' }}
                    onMouseEnter={(e) => { const el = e.currentTarget; el.style.backgroundColor = 'rgba(255,255,255,0.14)'; el.style.borderColor = 'rgba(255,255,255,0.24)'; }}
                    onMouseLeave={(e) => { const el = e.currentTarget; el.style.backgroundColor = 'rgba(255,255,255,0.09)'; el.style.borderColor = 'rgba(255,255,255,0.16)'; }}>
                    Add to Inquiry
                  </button>
                </div>
                {(activeTier || quantity > 1) && (
                  <p className="text-white/26 font-mono tabular-nums mb-1.5" style={{ fontSize: '9px', letterSpacing: '0.08em' }}>
                    {[activeTier?.dose, quantity > 1 ? `${quantity} units` : '1 unit'].filter(Boolean).join(' · ')}
                  </p>
                )}
                <Link to={`/product/${product.id}`} onClick={onClose}
                  className="w-full flex items-center justify-center gap-1.5 h-6 text-white/30 hover:text-white/70 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-sm"
                  style={{ fontSize: '10px', letterSpacing: '0.05em' }}>
                  View full record <ArrowUpRightIcon />
                </Link>
              </div>
            </div>

            {/* Right: Intelligence column */}
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

              {/* Sticky header */}
              <div className="flex items-center justify-between gap-4 px-4 py-3 shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="lg:hidden shrink-0"><AbbreviationChip value={product.abbreviation} /></span>
                  <div className="min-w-0">
                    <h3 className="text-white font-medium truncate" style={{ fontSize: '13px', letterSpacing: '-0.005em' }}>{substance}</h3>
                    <p className="text-white/28 font-mono tabular-nums mt-0.5 truncate" style={{ fontSize: '9px', letterSpacing: '0.18em' }}>
                      {product.sku}
                      {classLabel && <span className="ml-2 text-white/16">·</span>}
                      {classLabel && <span className="ml-2 uppercase" style={{ letterSpacing: '0.14em' }}>{classLabel}</span>}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={handleClose} aria-label="Close"
                  className="lg:hidden h-7 w-7 flex items-center justify-center text-white/28 hover:text-white/78 active:scale-[0.92] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-sm shrink-0">
                  <CloseIcon />
                </button>
              </div>

              {/* Scrollable module list */}
              <div className="flex-1 overflow-y-auto overscroll-contain">

                {/* Mobile identity block */}
                <div className="lg:hidden px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1 mb-3">
                    {product.casNumber && <span className="font-mono text-white/38 tabular-nums" style={{ fontSize: '10px' }}>CAS {product.casNumber}</span>}
                    {product.molecularWeight && <span className="font-mono text-white/38 tabular-nums" style={{ fontSize: '10px' }}>MW {product.molecularWeight}</span>}
                  </div>
                  {passportStats.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {passportStats.map((s) => <StatChip key={s.label} label={s.label} value={s.value} highlight={s.highlight} />)}
                    </div>
                  )}
                </div>

                {/* Module stack */}
                {moduleList.map((mod) => (
                  <IntelModule key={mod.key} index={mod.index} title={mod.title} defaultOpen={mod.defaultOpen} reserved={mod.reserved}>
                    {mod.kind === 'text' && (
                      <ModuleBody><ModuleText>{mod.content}</ModuleText></ModuleBody>
                    )}
                    {mod.kind === 'tiers' && (
                      <ModuleBody>
                        <TierSelector variants={product.variants} selectedIndex={selectedTierIndex} onSelect={setSelectedTierIndex} />
                        {activeTier && (
                          <p className="mt-2.5 text-white/30 font-mono tabular-nums" style={{ fontSize: '9.5px', letterSpacing: '0.06em' }}>
                            Selected: {activeTier.dose}{activeTier.sku && <span className="ml-2 text-white/18">SKU {activeTier.sku}</span>}
                          </p>
                        )}
                      </ModuleBody>
                    )}
                    {mod.kind === 'datagrid' && (
                      <ModuleBody><DataGrid rows={mod.rows} /></ModuleBody>
                    )}
                    {mod.kind === 'studies' && (
                      <ModuleBody>
                        {/* Compound-level intelligence header */}
                        {(product.humanTrialsConfirmed !== undefined || product.fdaStatus) && (
                          <div className="flex flex-wrap gap-x-5 gap-y-1.5 pb-3 mb-1"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.055)' }}>
                            {product.humanTrialsConfirmed !== undefined && (
                              <div className="flex items-center gap-2">
                                <span className="text-white/28 uppercase" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>Human Trials</span>
                                <span className="uppercase"
                                  style={{
                                    fontSize: '8px', letterSpacing: '0.14em', padding: '1px 5px', borderRadius: '2px',
                                    backgroundColor: product.humanTrialsConfirmed ? 'rgba(100,175,100,0.10)' : 'rgba(255,255,255,0.04)',
                                    border: product.humanTrialsConfirmed ? '1px solid rgba(100,175,100,0.22)' : '1px solid rgba(255,255,255,0.08)',
                                    color: product.humanTrialsConfirmed ? 'rgba(140,200,140,0.82)' : 'rgba(255,255,255,0.35)',
                                  }}>
                                  {product.humanTrialsConfirmed ? 'Confirmed' : 'None known'}
                                </span>
                              </div>
                            )}
                            {product.fdaStatus && (
                              <div className="flex items-center gap-2">
                                <span className="text-white/28 uppercase" style={{ fontSize: '8px', letterSpacing: '0.18em' }}>FDA Status</span>
                                <span className="text-white/48" style={{ fontSize: '9px' }}>{product.fdaStatus}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Study rows */}
                        {(product.knownStudies ?? []).map((study, idx) => (
                          <StudyRow key={idx} study={study} idx={idx} />
                        ))}
                      </ModuleBody>
                    )}
                  </IntelModule>
                ))}

                <div className="h-4" />
              </div>

              {/* Mobile action bar */}
              <div className="lg:hidden shrink-0 flex items-center gap-2.5 px-4 py-3.5"
                style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center shrink-0 rounded-[2px] overflow-hidden"
                  style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                  <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"
                    className="w-7 h-8 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
                    style={{ fontSize: '16px', lineHeight: 1 }}>−</button>
                  <span className="w-8 h-8 flex items-center justify-center font-mono tabular-nums text-white/70 select-none"
                    style={{ fontSize: '12px', borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                    {quantity}
                  </span>
                  <button type="button" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="Increase quantity"
                    className="w-7 h-8 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] active:scale-[0.90] transition-colors focus:outline-none"
                    style={{ fontSize: '16px', lineHeight: 1 }}>+</button>
                </div>
                <button type="button" onClick={handleAddToInquiry}
                  className="flex-1 h-8 text-white font-medium rounded-[2px] active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
                  style={{ fontSize: '11px', letterSpacing: '0.04em', backgroundColor: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.15)' }}>
                  Add to Inquiry
                </button>
                <Link to={`/product/${product.id}`} onClick={onClose}
                  className="h-8 px-3 inline-flex items-center gap-1 text-white/36 hover:text-white/76 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35 rounded-sm shrink-0"
                  style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
                  Record <ArrowUpRightIcon />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cio-bd     { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cio-panel  { from { opacity: 0; transform: scale(0.97) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes cio-bd-out    { from { opacity: 1 } to { opacity: 0 } }
        @keyframes cio-panel-out { from { opacity: 1; transform: scale(1) translateY(0); } to { opacity: 0; transform: scale(0.97) translateY(8px); } }
        @keyframes cio-module-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .cio-module {
          animation: cio-module-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
          animation-delay: calc(var(--mi, 1) * 38ms + 220ms);
        }
        .cio-panel-el { border-radius: 4px 4px 0 0; }
        @media (min-width: 640px) { .cio-panel-el { border-radius: 4px; } }
        @media (prefers-reduced-motion: reduce) {
          .cio-module { animation: none; opacity: 1; transform: none; }
          .cio-panel-el { animation: none !important; opacity: 1; transform: none; }
          [style*="cio-bd"] { animation: none !important; opacity: 1; }
        }
      `}</style>
    </>
  );
}
