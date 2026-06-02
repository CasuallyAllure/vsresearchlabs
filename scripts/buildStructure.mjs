/**
 * buildStructure — turn a real PDB chain into the hologram's structure JSON.
 *
 * Run:  node scripts/buildStructure.mjs
 *
 * Reads the committed Retatrutide coordinates (chain P of RCSB PDB 8YW3 —
 * the cryo-EM retatrutide·GLP-1R·Gs complex, Sun et al. 2024) and emits
 * src/data/structures/retatrutide.json: real atom positions + elements +
 * residue identity, with covalent bonds inferred from actual interatomic
 * distances. NOTHING is invented — every atom is an experimentally
 * resolved heavy atom from the deposited structure.
 *
 * The peptide is centered, stood upright (helix axis → +Y), and scaled to
 * fit the hero viewport. Bond inference uses the TRUE Ångström distances
 * (before scaling), so bond lengths reported by the scouter are real.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src/data/structures/retatrutide-8yw3.pdb');
const OUT = resolve(ROOT, 'src/data/structures/retatrutide.json');

const BACKBONE = new Set(['N', 'CA', 'C', 'O', 'OXT']);
const BOND_CUTOFF = 1.95; // Å — covalent heavy-heavy max; well below non-bonded contacts
const TARGET_RADIUS = 2.4; // viewport fit (max atom distance from centre)

// ── Parse PDB chain ───────────────────────────────────────────────────────
const lines = readFileSync(SRC, 'utf8').split('\n');
const atoms = [];
for (const line of lines) {
  if (!/^(ATOM|HETATM)/.test(line)) continue;
  atoms.push({
    name: line.slice(12, 16).trim(),
    res: line.slice(17, 20).trim(),
    resSeq: parseInt(line.slice(22, 26), 10),
    x: parseFloat(line.slice(30, 38)),
    y: parseFloat(line.slice(38, 46)),
    z: parseFloat(line.slice(46, 54)),
    el: (line.slice(76, 78).trim() || line.slice(12, 14).trim().replace(/[0-9]/g, '')).toUpperCase(),
  });
}
if (!atoms.length) throw new Error('No atoms parsed — check source PDB.');

// ── Center on centroid ────────────────────────────────────────────────────
const c = atoms.reduce((a, p) => [a[0] + p.x, a[1] + p.y, a[2] + p.z], [0, 0, 0]).map((v) => v / atoms.length);
for (const p of atoms) { p.x -= c[0]; p.y -= c[1]; p.z -= c[2]; }

// ── Stand upright: align (firstCA → lastCA) with +Y ───────────────────────
const cas = atoms.filter((p) => p.name === 'CA').sort((a, b) => a.resSeq - b.resSeq);
function rodrigues(points, vhat, t) {
  const cross = [vhat[1] * t[2] - vhat[2] * t[1], vhat[2] * t[0] - vhat[0] * t[2], vhat[0] * t[1] - vhat[1] * t[0]];
  const dot = vhat[0] * t[0] + vhat[1] * t[1] + vhat[2] * t[2];
  const s = Math.hypot(...cross);
  if (s < 1e-8) return; // already aligned
  const k = cross.map((v) => v / s);
  const ang = Math.atan2(s, dot);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  for (const p of points) {
    const v = [p.x, p.y, p.z];
    const kp = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    p.x = v[0] * cos + kp[0] * sin + k[0] * kd * (1 - cos);
    p.y = v[1] * cos + kp[1] * sin + k[1] * kd * (1 - cos);
    p.z = v[2] * cos + kp[2] * sin + k[2] * kd * (1 - cos);
  }
}
if (cas.length >= 2) {
  const a0 = cas[0], a1 = cas[cas.length - 1];
  const axis = [a1.x - a0.x, a1.y - a0.y, a1.z - a0.z];
  const len = Math.hypot(...axis);
  if (len > 1e-6) rodrigues(atoms, axis.map((v) => v / len), [0, 1, 0]);
}

// ── Bonds from REAL distances (pre-scale Å) ───────────────────────────────
const bonds = [];
for (let i = 0; i < atoms.length; i++) {
  for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j];
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (d > 0.4 && d <= BOND_CUTOFF) {
      let type = 'sidechain';
      if (BACKBONE.has(a.name) && BACKBONE.has(b.name) && a.resSeq === b.resSeq) type = 'backbone';
      else if (Math.abs(a.resSeq - b.resSeq) === 1 && ((a.name === 'C' && b.name === 'N') || (a.name === 'N' && b.name === 'C'))) type = 'peptide';
      bonds.push([i, j, type, Math.round(d * 100) / 100]);
    }
  }
}

// ── Scale to viewport ─────────────────────────────────────────────────────
const maxR = Math.max(...atoms.map((p) => Math.hypot(p.x, p.y, p.z)));
const k = TARGET_RADIUS / maxR;
const round = (v) => Math.round(v * k * 1000) / 1000;

const outAtoms = atoms.map((p) => ({
  pos: [round(p.x), round(p.y), round(p.z)],
  el: p.el,
  res: p.res,
  resSeq: p.resSeq,
  name: p.name,
  bb: BACKBONE.has(p.name),
}));

const elementCounts = atoms.reduce((m, p) => ((m[p.el] = (m[p.el] || 0) + 1), m), {});
const resolved = [...new Set(atoms.map((p) => p.resSeq))].length;

const out = {
  meta: {
    name: 'Retatrutide',
    pdb: '8YW3',
    chain: 'P',
    method: 'cryo-EM',
    complex: 'retatrutide · GLP-1R · Gs',
    source: 'RCSB PDB 8YW3 (Zhao et al., 2024) — public domain',
    resolvedResidues: resolved,
    atomCount: outAtoms.length,
    elementCounts,
    note: 'Experimentally resolved heavy atoms. Hydrogens, the disordered C-terminal tail, and the K17 C20-diacid lipid are not modeled in the cryo-EM map.',
  },
  atoms: outAtoms,
  bonds,
};

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`✓ ${outAtoms.length} real atoms · ${bonds.length} bonds · ${resolved} residues → ${OUT.replace(ROOT + '/', '')}`);
console.log(`  elements: ${Object.entries(elementCounts).map(([e, n]) => `${e}:${n}`).join('  ')}`);
const types = bonds.reduce((m, b) => ((m[b[2]] = (m[b[2]] || 0) + 1), m), {});
console.log(`  bonds: ${Object.entries(types).map(([t, n]) => `${t}:${n}`).join('  ')}`);
