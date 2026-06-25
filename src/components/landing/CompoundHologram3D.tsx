/**
 * CompoundHologram3D
 *
 * Real WebGL 3D rendering of a peptide structure for the FIG-01 hero frame.
 *
 * REAL STRUCTURE: when given a `structure` whose atoms carry element /
 * residue identity (see src/data/structures/retatrutide.json, parsed from
 * RCSB PDB 8YW3 — the cryo-EM retatrutide·GLP-1R·Gs complex), every dot is
 * an experimentally-resolved heavy atom and the scouter reads its TRUE
 * element, residue, atom name, and real bond length. Nothing fabricated.
 *
 * Fallback: with no structure (or atoms lacking element data) it renders a
 * stylized procedural alpha-helix — clearly illustrative, and the scouter
 * reports only element-level facts true of any peptide backbone.
 *
 * Interaction
 * ───────────
 *  - Auto rotation; pauses while a target is locked.
 *  - Drag to rotate; scroll/pinch to zoom (clamped); pan disabled.
 *  - HOVER SCOUTER: a CRT readout locks onto any atom or bond, anchored to
 *    the 3D point and tracking rotation. prefers-reduced-motion drops the
 *    scan/flicker animations.
 *  - Pointer events only inside the inset; frame margins stay swipeable.
 *
 * Encapsulation: everything WebGL + HUD lives in this file.
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveBlending, Color, Group, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

// ── Public types ──────────────────────────────────────────────────────────

interface Atom {
  pos: [number, number, number];
  /** Procedural styling hint (fallback helix only). */
  type?: 'core' | 'accent';
  /** Real-structure fields (present for PDB-derived data). */
  el?: string;
  res?: string;
  resSeq?: number;
  name?: string;
  bb?: boolean;
}

/** [a, b] or [a, b, type, lengthÅ] for real structures. */
type Bond = [number, number] | [number, number, string, number];

export interface CompoundStructure {
  atoms: Atom[];
  bonds: Bond[];
  accentBondIndices?: number[];
  meta?: Record<string, unknown>;
}

interface CompoundHologram3DProps {
  structure?: CompoundStructure;
}

// ── Element data (real chemistry) + holographic CPK palette ───────────────

const ELEMENTS: Record<string, { name: string; z: number; mass: number; eneg: number }> = {
  H: { name: 'Hydrogen', z: 1, mass: 1.008, eneg: 2.2 },
  C: { name: 'Carbon', z: 6, mass: 12.01, eneg: 2.55 },
  N: { name: 'Nitrogen', z: 7, mass: 14.01, eneg: 3.04 },
  O: { name: 'Oxygen', z: 8, mass: 16.0, eneg: 3.44 },
  S: { name: 'Sulfur', z: 16, mass: 32.06, eneg: 2.58 },
  P: { name: 'Phosphorus', z: 15, mass: 30.97, eneg: 2.19 },
};

const ELEMENT_STYLE: Record<string, { color: string; emissive: string }> = {
  C: { color: '#34727A', emissive: '#1F7878' }, // teal
  N: { color: '#34727A', emissive: '#274C9C' }, // blue
  O: { color: '#C7A463', emissive: '#9C3A48' }, // coral (oxygen)
  S: { color: '#E8D6A8', emissive: '#9C7C3E' }, // gold
  P: { color: '#C7A463', emissive: '#9C5A20' }, // orange
};
const ELEMENT_FALLBACK = { color: '#8FD4FF', emissive: '#2A6A9C' };

// Procedural-helix palette (fallback only)
const ATOM_PALETTE = [
  { color: '#34727A', emissive: '#1E444A' },
  { color: '#62A0A6', emissive: '#1E444A' },
  { color: '#34727A', emissive: '#1E444A' },
  { color: '#C7A463', emissive: '#8C6A2A' },
  { color: '#62A0A6', emissive: '#1E444A' },
  { color: '#34727A', emissive: '#1E444A' },
] as const;
const ACCENT_ATOM = { color: '#E8D6A8', emissive: '#9C7C3E' };
const BOND_COLOR = '#34727A';
const ACCENT_BOND_COLOR = '#C4A35A';

const RES_NAMES: Record<string, string> = {
  ALA: 'Ala', ARG: 'Arg', ASN: 'Asn', ASP: 'Asp', CYS: 'Cys', GLN: 'Gln', GLU: 'Glu',
  GLY: 'Gly', HIS: 'His', ILE: 'Ile', LEU: 'Leu', LYS: 'Lys', MET: 'Met', PHE: 'Phe',
  PRO: 'Pro', SER: 'Ser', THR: 'Thr', TRP: 'Trp', TYR: 'Tyr', VAL: 'Val',
  AIB: 'Aib', '2ML': 'α-Me-Leu',
};
function resLabel(a: Atom): string {
  return `${RES_NAMES[a.res ?? ''] ?? a.res ?? '?'} ${a.resSeq ?? ''}`.trim();
}

// Full residue names + the science behind the unusual ones — Aib and the
// α-methylated residue are what make Retatrutide protease-resistant.
const RES_FULL: Record<string, string> = {
  ALA: 'Alanine', ARG: 'Arginine', ASN: 'Asparagine', ASP: 'Aspartate', CYS: 'Cysteine',
  GLN: 'Glutamine', GLU: 'Glutamate', GLY: 'Glycine', HIS: 'Histidine', ILE: 'Isoleucine',
  LEU: 'Leucine', LYS: 'Lysine', MET: 'Methionine', PHE: 'Phenylalanine', PRO: 'Proline',
  SER: 'Serine', THR: 'Threonine', TRP: 'Tryptophan', TYR: 'Tyrosine', VAL: 'Valine',
  AIB: '2-aminoisobutyric acid', '2ML': 'α-methyl-leucine',
};
const RES_NOTE: Record<string, string> = {
  AIB: 'synthetic α,α-dialkyl residue — rigidifies the helix & resists proteases',
  '2ML': 'α-methylated — protease-resistant',
  LYS: 'K17 — the C20-diacid lipidation site (lipid not resolved in the map)',
};
/** Rich residue descriptor for the scouter readout. */
function resDescribe(a: Atom): string {
  const short = RES_NAMES[a.res ?? ''] ?? a.res ?? '?';
  const full = RES_FULL[a.res ?? ''];
  const seq = a.resSeq ?? '';
  const note = a.resSeq === 17 && a.res === 'LYS' ? RES_NOTE.LYS : RES_NOTE[a.res ?? ''];
  const head = full ? `${short} ${seq} · ${full}` : `${short} ${seq}`.trim();
  return note ? `${head} — ${note}` : head;
}
function atomRole(a: Atom): string {
  switch (a.name) {
    case 'N': return 'Backbone amide N';
    case 'CA': return 'α-Carbon · Cα';
    case 'C': return 'Carbonyl C';
    case 'O': return 'Carbonyl O';
    case 'CB': return 'β-Carbon';
    case 'OXT': return 'C-terminal O';
    default: return a.bb ? 'Backbone' : `Side chain · ${a.name ?? ''}`.trim();
  }
}

// ── Scouter readout model ─────────────────────────────────────────────────

interface AtomScan {
  kind: 'atom';
  symbol: string; elementName: string; z: number; mass: number; eneg: number;
  role: string; residue?: string; accent: boolean; source?: string;
}
interface BondScan {
  kind: 'bond';
  btype: string; detail: string; length: string; energy?: string; accent: boolean; source?: string;
}
type Scan = (AtomScan | BondScan) & { anchor: [number, number, number] };

// ── Procedural alpha-helix (fallback) ─────────────────────────────────────

function buildHelixStructure(): CompoundStructure {
  const turns = 2.4, height = 3.6, radius = 0.85, atomsPerTurn = 6;
  const total = Math.round(turns * atomsPerTurn);
  const atoms: Atom[] = [];
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const angle = t * turns * Math.PI * 2;
    const y = t * height - height / 2;
    atoms.push({ pos: [Math.cos(angle) * radius, y, Math.sin(angle) * radius], type: 'core' });
  }
  const accentTopIdx = atoms.length;
  atoms.push({ pos: [0, height / 2 + 0.7, 0], type: 'accent' });
  const accentBottomIdx = atoms.length;
  atoms.push({ pos: [0, -height / 2 - 0.7, 0], type: 'accent' });
  const bonds: Bond[] = [];
  for (let i = 0; i < total - 1; i++) bonds.push([i, i + 1]);
  const accentBondIndices: number[] = [];
  bonds.push([total - 1, accentTopIdx]); accentBondIndices.push(bonds.length - 1);
  bonds.push([0, accentBottomIdx]); accentBondIndices.push(bonds.length - 1);
  for (let i = 0; i + 4 < total; i += 4) bonds.push([i, i + 4]);
  return { atoms, bonds, accentBondIndices };
}

function proceduralAtomScan(index: number, total: number, accent: boolean): AtomScan {
  if (accent) {
    const top = index === total;
    return top
      ? { kind: 'atom', symbol: 'O', elementName: 'Oxygen', z: 8, mass: 16.0, eneg: 3.44, role: 'C-terminus · –COO⁻', accent: true }
      : { kind: 'atom', symbol: 'C', elementName: 'Carbon', z: 6, mass: 12.01, eneg: 2.55, role: 'Lipidation site · γGlu–C20', accent: true };
  }
  const slot = index % 3;
  const el = slot === 0 ? ELEMENTS.N : ELEMENTS.C;
  const symbol = slot === 0 ? 'N' : 'C';
  const role = slot === 0 ? 'Backbone amide N' : slot === 1 ? 'α-Carbon · Cα' : 'Carbonyl C · C=O';
  return { kind: 'atom', symbol, elementName: el.name, z: el.z, mass: el.mass, eneg: el.eneg, role, accent: false };
}

// ── Atom mesh ─────────────────────────────────────────────────────────────

function AtomMesh({
  atom, index, dense, paletteIndex, groupHot, onHover, onClear,
}: {
  atom: Atom; index: number; dense: boolean; paletteIndex: number; groupHot?: boolean;
  onHover: (kind: 'atom', index: number) => void; onClear: () => void;
}) {
  const accent = atom.type === 'accent';
  const style = atom.el ? (ELEMENT_STYLE[atom.el] ?? ELEMENT_FALLBACK) : accent ? ACCENT_ATOM : ATOM_PALETTE[paletteIndex % ATOM_PALETTE.length];
  const coreRadius = dense ? (atom.el === 'O' || atom.el === 'N' ? 0.07 : 0.078) : accent ? 0.14 : 0.1;
  const haloRadius = dense ? 0.135 : accent ? 0.32 : 0.26;
  const haloOpacity = dense ? 0.13 : accent ? 0.22 : 0.18;
  const [hot, setHot] = useState(false);

  function enter(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    // Touch screens have no hover: let the group glow (groupHot) carry the
    // highlight so a tapped atom isn't left permanently bright after the
    // pin moves elsewhere. Mouse keeps the extra self-glow.
    if (e.pointerType === 'mouse') { setHot(true); document.body.style.cursor = 'crosshair'; }
    onHover('atom', index);
  }
  function leave(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    // On touch, a tap fires pointerout on release — ignore it so the
    // highlight stays pinned until the user taps empty space.
    if (e.pointerType !== 'mouse') return;
    setHot(false); document.body.style.cursor = ''; onClear();
  }

  return (
    <group position={atom.pos}>
      <mesh>
        <sphereGeometry args={[coreRadius, dense ? 12 : 20, dense ? 12 : 20]} />
        <meshStandardMaterial color={style.color} emissive={style.emissive} emissiveIntensity={hot ? 2.4 : groupHot ? 2.2 : 1.1} roughness={0.3} metalness={0.15} />
      </mesh>
      {/* Halo doubles as the hover target (mouse) and tap target (touch). */}
      <mesh onPointerOver={enter} onPointerOut={leave} onPointerDown={enter}>
        <sphereGeometry args={[haloRadius, 10, 10]} />
        <meshBasicMaterial color={style.color} transparent opacity={hot ? Math.min(0.5, haloOpacity * 2.4) : groupHot ? Math.min(0.46, haloOpacity * 2.2) : haloOpacity} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ── Bond mesh ─────────────────────────────────────────────────────────────

function BondMesh({
  from, to, accent, dense, index, groupHot, onHover, onClear,
}: {
  from: [number, number, number]; to: [number, number, number]; accent: boolean; dense: boolean;
  index: number; groupHot?: boolean; onHover: (kind: 'bond', index: number) => void; onClear: () => void;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new Vector3(...from), end = new Vector3(...to);
    const direction = new Vector3().subVectors(end, start);
    const len = direction.length();
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
    return { position: mid.toArray() as [number, number, number], quaternion: q, length: len };
  }, [from, to]);

  const color = accent ? ACCENT_BOND_COLOR : BOND_COLOR;
  const coreR = dense ? 0.02 : 0.018;
  const hitR = dense ? 0.06 : 0.13;
  const [hot, setHot] = useState(false);

  function enter(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    if (e.pointerType === 'mouse') { setHot(true); document.body.style.cursor = 'crosshair'; }
    onHover('bond', index);
  }
  function leave(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    // Touch: ignore the release-fired pointerout so the pin persists.
    if (e.pointerType !== 'mouse') return;
    setHot(false); document.body.style.cursor = ''; onClear();
  }

  return (
    <group position={position} quaternion={quaternion}>
      <mesh>
        <cylinderGeometry args={[coreR, coreR, length, 7]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hot ? 2.6 : groupHot ? 2.4 : 1.4} roughness={0.4} />
      </mesh>
      {!dense && (
        <mesh>
          <cylinderGeometry args={[0.05, 0.05, length, 9]} />
          <meshBasicMaterial color={color} transparent opacity={hot ? 0.45 : groupHot ? 0.42 : 0.22} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      )}
      <mesh onPointerOver={enter} onPointerOut={leave} onPointerDown={enter}>
        <cylinderGeometry args={[hitR, hitR, length, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ── Scouter HUD card ──────────────────────────────────────────────────────

function ScouterCard({ scan, reduced, placement }: { scan: Scan; reduced: boolean; placement: { right: boolean; top: boolean } }) {
  const accent = scan.accent;
  const edge = accent ? 'rgba(196,163,90,0.9)' : 'rgba(181,144,75,0.9)';
  const tint = accent ? '#9A7B3A' : '#2D6168';

  // Open the card toward screen-centre so it never bleeds off an edge,
  // hugging the atom with a small offset.
  const pos = {
    [placement.right ? 'right' : 'left']: 12,
    [placement.top ? 'top' : 'bottom']: 12,
    transformOrigin: `${placement.right ? 'right' : 'left'} ${placement.top ? 'top' : 'bottom'}`,
  } as React.CSSProperties;

  return (
    <div className="holo-scouter-anchor">
      <svg className="holo-scouter-link" width="0" height="0" style={{ overflow: 'visible' }} aria-hidden="true">
        <circle cx="0" cy="0" r="7" fill="none" stroke={edge} strokeWidth="1" className={reduced ? '' : 'holo-reticle'} />
        <circle cx="0" cy="0" r="2" fill={tint} />
      </svg>

      <div className={`holo-scouter-card${reduced ? '' : ' holo-live'}`} style={{ borderColor: edge, boxShadow: `0 0 0 1px ${edge}, 0 5px 18px rgba(26,23,20,0.18)`, ...pos }}>
        <i className="holo-cnr tl" style={{ borderColor: edge }} />
        <i className="holo-cnr tr" style={{ borderColor: edge }} />
        <i className="holo-cnr bl" style={{ borderColor: edge }} />
        <i className="holo-cnr br" style={{ borderColor: edge }} />

        <div className="holo-status">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tint }}>
            <span className={reduced ? '' : 'holo-blink'} style={{ width: 5, height: 5, borderRadius: '50%', background: tint }} />
            LOCKED
          </span>
          <span style={{ color: 'rgba(26,23,20,0.35)' }}>{scan.kind === 'atom' ? 'ATOM' : 'BOND'}</span>
        </div>

        {scan.kind === 'atom' ? (
          <>
            <div className="holo-head">
              <span className="holo-sym" style={{ color: tint, borderColor: edge }}>{scan.symbol}</span>
              <div style={{ minWidth: 0 }}>
                <div className="holo-title">{scan.elementName}</div>
                <div className="holo-sub">Z {scan.z} · {scan.mass.toFixed(2)} u · χ {scan.eneg.toFixed(2)}</div>
              </div>
            </div>
            {scan.residue && (
              <div className="holo-seg">
                <span className="holo-seg-lbl">SEGMENT</span>
                <span className="holo-seg-val">{scan.residue}</span>
              </div>
            )}
            <div className="holo-kv"><span className="holo-lbl">ROLE</span><span className="holo-val">{scan.role}</span></div>
          </>
        ) : (
          <>
            <div className="holo-title" style={{ marginTop: 1 }}>{scan.btype}</div>
            <div className="holo-sub" style={{ marginBottom: 6 }}>{scan.detail}</div>
            <div className="holo-kv"><span className="holo-lbl">LENGTH</span><span className="holo-val">{scan.length}</span></div>
            {scan.energy && <div className="holo-kv"><span className="holo-lbl">ENERGY</span><span className="holo-val">{scan.energy}</span></div>}
          </>
        )}

        {scan.source && (
          <div className="holo-src" style={{ color: tint }}>{scan.source}</div>
        )}

        {!reduced && <span className="holo-sweep" style={{ background: `linear-gradient(180deg, transparent, ${edge}, transparent)` }} />}
        <span className="holo-crt" aria-hidden="true" />
      </div>
    </div>
  );
}

// ── Residue caliper (glitchy "measuring stick" on the hovered chain) ───────

interface Caliper {
  a: [number, number, number];
  b: [number, number, number];
  out: [number, number, number];
  lengthA: number;
}

/** Build a caliper across the longest axis of a residue, offset just outside
 *  the chain. Returns null if the residue has no measurable span. */
function computeCaliper(
  structure: CompoundStructure,
  resSeq: number,
  centroid: Vector3,
  scale: number,
): Caliper | null {
  const idx: number[] = [];
  for (let i = 0; i < structure.atoms.length; i++) {
    if (structure.atoms[i].resSeq === resSeq) idx.push(i);
  }
  if (idx.length < 2) return null;
  // longest atom-pair = the residue's main axis
  let max = 0, p = idx[0], q = idx[1];
  for (let m = 0; m < idx.length; m++) {
    for (let n = m + 1; n < idx.length; n++) {
      const A = structure.atoms[idx[m]].pos, B = structure.atoms[idx[n]].pos;
      const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
      if (d > max) { max = d; p = idx[m]; q = idx[n]; }
    }
  }
  if (max < 0.12) return null;
  const a = new Vector3(...structure.atoms[p].pos);
  const b = new Vector3(...structure.atoms[q].pos);
  const dir = new Vector3().subVectors(b, a).normalize();
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  // outward = component of (mid - centroid) perpendicular to the axis
  let out = new Vector3().subVectors(mid, centroid);
  out.addScaledVector(dir, -out.dot(dir));
  if (out.lengthSq() < 1e-4) {
    out = new Vector3(0, 0, 1);
    out.addScaledVector(dir, -out.dot(dir));
  }
  out.normalize();
  const off = 0.34, pad = 0.12;
  const a2 = a.clone().addScaledVector(dir, -pad).addScaledVector(out, off);
  const b2 = b.clone().addScaledVector(dir, pad).addScaledVector(out, off);
  return { a: a2.toArray() as [number, number, number], b: b2.toArray() as [number, number, number], out: out.toArray() as [number, number, number], lengthA: max * scale };
}

function cylTransform(a: Vector3, b: Vector3) {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
  return { position: mid.toArray() as [number, number, number], quaternion: q, length: len };
}

const CALIPER_COLOR = '#C4A35A';
const TICK_LEN = 0.2;

function ResidueCaliper({ caliper, reduced }: { caliper: Caliper; reduced: boolean }) {
  const va = useMemo(() => new Vector3(...caliper.a), [caliper.a]);
  const vb = useMemo(() => new Vector3(...caliper.b), [caliper.b]);
  const vout = useMemo(() => new Vector3(...caliper.out), [caliper.out]);

  const line = useMemo(() => cylTransform(va, vb), [va, vb]);
  const tickA = useMemo(() => cylTransform(va.clone().addScaledVector(vout, -TICK_LEN / 2), va.clone().addScaledVector(vout, TICK_LEN / 2)), [va, vout]);
  const tickB = useMemo(() => cylTransform(vb.clone().addScaledVector(vout, -TICK_LEN / 2), vb.clone().addScaledVector(vout, TICK_LEN / 2)), [vb, vout]);
  const labelPos = useMemo(() => va.clone().add(vb).multiplyScalar(0.5).addScaledVector(vout, 0.16).toArray() as [number, number, number], [va, vb, vout]);

  // Glitchy shimmer on the measuring line.
  const coreRef = useRef<MeshBasicMaterial>(null);
  useFrame((state) => {
    if (reduced || !coreRef.current) return;
    const t = state.clock.elapsedTime;
    coreRef.current.opacity = 0.7 + 0.28 * Math.abs(Math.sin(t * 20));
  });

  return (
    <group>
      <group position={line.position} quaternion={line.quaternion}>
        <mesh>
          <cylinderGeometry args={[0.012, 0.012, line.length, 6]} />
          <meshBasicMaterial ref={coreRef} color={CALIPER_COLOR} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.04, 0.04, line.length, 8]} />
          <meshBasicMaterial color={CALIPER_COLOR} transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      {[tickA, tickB].map((t, i) => (
        <group key={i} position={t.position} quaternion={t.quaternion}>
          <mesh>
            <cylinderGeometry args={[0.012, 0.012, t.length, 6]} />
            <meshBasicMaterial color={CALIPER_COLOR} transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <Html position={labelPos} center zIndexRange={[39, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`holo-caliper${reduced ? '' : ' holo-live'}`}>{caliper.lengthA.toFixed(1)} Å</div>
      </Html>
    </group>
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────

function MolecularScene({
  structure, hovered, onHover, onClear, reduced,
}: {
  structure: CompoundStructure;
  hovered: { kind: 'atom' | 'bond'; index: number } | null;
  onHover: (kind: 'atom' | 'bond', index: number) => void;
  onClear: () => void;
  reduced: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const dense = useMemo(() => structure.atoms.some((a) => !!a.el), [structure.atoms]);
  const coreCount = useMemo(() => structure.atoms.filter((a) => a.type !== 'accent').length, [structure.atoms]);
  const accentBondSet = useMemo(() => new Set(structure.accentBondIndices ?? []), [structure.accentBondIndices]);

  // Molecule centroid + display→Å scale (recovered from real bond lengths) so
  // the caliper can offset outward and report a true measurement.
  const centroid = useMemo(() => {
    const c = new Vector3();
    for (const a of structure.atoms) c.add(new Vector3(...a.pos));
    if (structure.atoms.length) c.multiplyScalar(1 / structure.atoms.length);
    return c;
  }, [structure.atoms]);
  const angstromScale = useMemo(() => {
    for (const bond of structure.bonds) {
      if (bond.length >= 4) {
        const a = structure.atoms[bond[0]].pos, b = structure.atoms[bond[1]].pos;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > 1e-4) return (bond[3] as number) / d;
      }
    }
    return 1;
  }, [structure]);
  const source = useMemo(() => {
    const m = structure.meta;
    if (!m) return undefined;
    return `${String(m.name ?? '').toUpperCase()} · PDB ${m.pdb ?? ''} · ${m.method ?? ''}`.replace(/ · $/, '').trim();
  }, [structure.meta]);

  // Build the active scan + anchor from the hovered index.
  const scan: Scan | null = useMemo(() => {
    if (!hovered) return null;
    if (hovered.kind === 'atom') {
      const a = structure.atoms[hovered.index];
      if (!a) return null;
      let base: AtomScan;
      if (a.el) {
        const e = ELEMENTS[a.el] ?? { name: a.el, z: 0, mass: 0, eneg: 0 };
        base = { kind: 'atom', symbol: a.el, elementName: e.name, z: e.z, mass: e.mass, eneg: e.eneg, role: atomRole(a), residue: resDescribe(a), accent: false, source };
      } else {
        base = { ...proceduralAtomScan(hovered.index, coreCount, a.type === 'accent') };
      }
      return { ...base, anchor: a.pos };
    }
    const bond = structure.bonds[hovered.index];
    if (!bond) return null;
    const a = structure.atoms[bond[0]], b = structure.atoms[bond[1]];
    const mid: [number, number, number] = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2];
    let base: BondScan;
    if (bond.length >= 4) {
      const t = bond[2] as string;
      const len = bond[3] as number;
      const btype = t === 'peptide' ? 'Peptide bond' : t === 'backbone' ? 'Backbone bond' : 'Side-chain bond';
      const detail = `${a.name ?? ''} (${resLabel(a)}) — ${b.name ?? ''} (${resLabel(b)})`.trim();
      base = { kind: 'bond', btype, detail, length: `${len.toFixed(2)} Å`, accent: t === 'peptide', source };
    } else {
      // procedural bond classification
      const accentB = accentBondSet.has(hovered.index);
      base = accentB
        ? { kind: 'bond', btype: 'Terminal linkage', detail: 'chain terminus / acyl chain', length: '—', accent: true }
        : Math.abs(bond[0] - bond[1]) === 4
          ? { kind: 'bond', btype: 'α-Helix H-bond', detail: 'N–H···O=C (i → i+4)', length: '≈ 2.0 Å', energy: '≈ 21 kJ/mol', accent: false }
          : { kind: 'bond', btype: 'Peptide bond', detail: 'C–N amide (partial C=N)', length: '≈ 1.33 Å', energy: '≈ 308 kJ/mol', accent: false };
    }
    return { ...base, anchor: mid };
  }, [hovered, structure, coreCount, accentBondSet, source]);

  // Which screen quadrant is the locked point in? Open the card the other
  // way so it never bleeds off the top/right edges. Done in-frame (where
  // reading the ref is legal) so it reflects the model's live orientation;
  // also drives the slow axial wobble.
  const [placement, setPlacement] = useState({ right: false, top: false });
  const projVec = useRef(new Vector3());

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    if (!reduced && !hovered) {
      g.rotation.z = Math.sin(state.clock.elapsedTime * 0.3) * 0.035;
    }
    if (scan) {
      const v = projVec.current
        .set(scan.anchor[0], scan.anchor[1], scan.anchor[2])
        .applyMatrix4(g.matrixWorld)
        .project(camera);
      const right = v.x > 0.1;
      const top = v.y > 0.1;
      if (right !== placement.right || top !== placement.top) setPlacement({ right, top });
    }
  });

  // Residue under the cursor — drives the whole-group "leg" glow so hovering
  // any atom lights up its entire amino-acid chain segment.
  const hotResidue = (() => {
    if (!hovered) return null;
    if (hovered.kind === 'atom') return structure.atoms[hovered.index]?.resSeq ?? null;
    const b = structure.bonds[hovered.index];
    return b ? structure.atoms[b[0]]?.resSeq ?? null : null;
  })();

  const caliper = hotResidue != null ? computeCaliper(structure, hotResidue, centroid, angstromScale) : null;

  return (
    <group ref={groupRef}>
      {structure.atoms.map((atom, i) => (
        <AtomMesh
          key={`a${i}`}
          atom={atom}
          index={i}
          dense={dense}
          paletteIndex={i}
          groupHot={hotResidue != null && atom.resSeq === hotResidue}
          onHover={onHover}
          onClear={onClear}
        />
      ))}
      {structure.bonds.map((bond, i) => (
        <BondMesh
          key={`b${i}`}
          from={structure.atoms[bond[0]].pos}
          to={structure.atoms[bond[1]].pos}
          accent={accentBondSet.has(i) || (bond.length >= 4 && bond[2] === 'peptide')}
          dense={dense}
          index={i}
          groupHot={
            hotResidue != null &&
            structure.atoms[bond[0]]?.resSeq === hotResidue &&
            structure.atoms[bond[1]]?.resSeq === hotResidue
          }
          onHover={onHover}
          onClear={onClear}
        />
      ))}

      {caliper && <ResidueCaliper caliper={caliper} reduced={reduced} />}

      {scan && (
        <Html position={scan.anchor} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }} wrapperClass="holo-scouter-wrap">
          <ScouterCard scan={scan} reduced={reduced} placement={placement} />
        </Html>
      )}
    </group>
  );
}

// ── Public component ─────────────────────────────────────────────────────

export function CompoundHologram3D({ structure }: CompoundHologram3DProps = {}) {
  const resolved = useMemo(() => structure ?? buildHelixStructure(), [structure]);
  const dense = useMemo(() => resolved.atoms.some((a) => !!a.el), [resolved]);
  const [hovered, setHovered] = useState<{ kind: 'atom' | 'bond'; index: number } | null>(null);

  const reduced = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div className="absolute inset-[6%] pointer-events-auto" style={{ touchAction: 'pan-x' }}>
        <Canvas
          camera={{ position: [0, 0, dense ? 8 : 7], fov: 30 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
          onPointerMissed={() => setHovered(null)}
          onCreated={({ scene }) => {
            scene.background = null;
            scene.fog = null;
            scene.environment = null;
            const tint = new Color('#04101a');
            scene.background = null;
            void tint;
          }}
        >
          <ambientLight intensity={0.45} color="#3A8CB8" />
          <pointLight position={[3, 4, 5]} intensity={1.6} color="#34727A" />
          <pointLight position={[-3, -2, 4]} intensity={0.9} color="#62A0A6" />
          <pointLight position={[0, 4, -3]} intensity={0.5} color="#C4A35A" />
          <pointLight position={[2, -3, -2]} intensity={0.4} color="#62A0A6" />

          <MolecularScene
            structure={resolved}
            hovered={hovered}
            onHover={(kind, index) => setHovered({ kind, index })}
            onClear={() => setHovered(null)}
            reduced={reduced}
          />

          <OrbitControls
            enablePan={false}
            enableZoom
            enableRotate
            autoRotate={!hovered}
            autoRotateSpeed={0.7}
            minDistance={dense ? 4 : 3.5}
            maxDistance={dense ? 16 : 11}
            zoomSpeed={0.6}
            rotateSpeed={0.7}
            target={[0, 0, 0]}
          />
        </Canvas>
      </div>

      <style>{`
        .holo-scouter-wrap { pointer-events: none; }
        .holo-scouter-anchor { position: relative; width: 0; height: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
        .holo-scouter-link { position: absolute; left: 0; top: 0; }
        .holo-scouter-card {
          position: absolute;
          width: 150px; padding: 6px 8px 7px;
          background: linear-gradient(180deg, rgba(251,249,244,0.85), rgba(244,239,230,0.9));
          border: 1px solid; border-radius: 7px; overflow: hidden;
          -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
        }
        /* Strict register: the scouter is a STILL readout — entry pop only.
           Flicker, CRT scanlines, vertical scan, blink, and reticle spin are
           retired so the 3D molecule reads as an instrument, not sci-fi UI. */
        .holo-live { animation: holoPop 170ms cubic-bezier(0.2,0.9,0.25,1) both; }
        @keyframes holoPop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        .holo-crt { display: none; }
        .holo-sweep { display: none; }
        .holo-blink { opacity: 1; }
        .holo-reticle { transform-box: fill-box; transform-origin: center; }
        .holo-cnr { position: absolute; width: 6px; height: 6px; border: 0 solid; opacity: 0.9; z-index: 2; }
        .holo-cnr.tl { left: 4px; top: 4px; border-left-width: 1px; border-top-width: 1px; }
        .holo-cnr.tr { right: 4px; top: 4px; border-right-width: 1px; border-top-width: 1px; }
        .holo-cnr.bl { left: 4px; bottom: 4px; border-left-width: 1px; border-bottom-width: 1px; }
        .holo-cnr.br { right: 4px; bottom: 4px; border-right-width: 1px; border-bottom-width: 1px; }
        .holo-status { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; font-size: 6.5px; letter-spacing: 0.18em; margin-bottom: 5px; }
        .holo-head { position: relative; z-index: 1; display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
        .holo-sym { flex-shrink: 0; width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid; border-radius: 6px; font-size: 12px; font-weight: 700; }
        .holo-title { position: relative; z-index: 1; font-size: 10.5px; font-weight: 600; color: rgba(26,23,20,0.92); line-height: 1.12; }
        .holo-seg { position: relative; z-index: 1; margin: 5px 0 3px; padding: 4px 6px; border-radius: 5px; background: rgba(52,114,122,0.12); border: 1px solid rgba(52,114,122,0.30); }
        .holo-seg-lbl { display: block; font-size: 6px; letter-spacing: 0.18em; color: rgba(26,23,20,0.45); margin-bottom: 1px; }
        .holo-seg-val { display: block; font-size: 9px; font-weight: 600; color: rgba(26,23,20,0.9); line-height: 1.22; }
        .holo-sub { position: relative; z-index: 1; font-size: 7px; letter-spacing: 0.03em; color: rgba(26,23,20,0.5); font-variant-numeric: tabular-nums; margin-top: 1px; }
        .holo-kv { position: relative; z-index: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 3px; }
        .holo-lbl { font-size: 6.5px; letter-spacing: 0.14em; color: rgba(26,23,20,0.4); flex-shrink: 0; }
        .holo-val { font-size: 8.5px; color: rgba(26,23,20,0.85); text-align: right; font-variant-numeric: tabular-nums; line-height: 1.2; }
        .holo-src { position: relative; z-index: 1; margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(26,23,20,0.1); font-size: 6.5px; letter-spacing: 0.12em; opacity: 0.85; }
        .holo-caliper {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 8px; font-weight: 600; letter-spacing: 0.08em; white-space: nowrap;
          color: #8a6d34; padding: 1px 5px; border-radius: 4px;
          background: rgba(251,249,244,0.82); border: 1px solid rgba(196,163,90,0.55);
          -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
        }
        @media (max-width: 640px) {
          /* Scale the readout down to stay proportional to the smaller model. */
          .holo-scouter-card { width: 122px; padding: 5px 6px 6px; border-radius: 6px; }
          .holo-sym { width: 18px; height: 18px; font-size: 10px; border-radius: 5px; }
          .holo-title { font-size: 9px; }
          .holo-sub { font-size: 6.5px; }
          .holo-seg { padding: 3px 5px; }
          .holo-seg-val { font-size: 8px; }
          .holo-val { font-size: 7.5px; }
          .holo-src { font-size: 6px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .holo-live, .holo-crt, .holo-sweep, .holo-blink, .holo-reticle { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
