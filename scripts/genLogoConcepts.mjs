/**
 * genLogoConcepts — public/logo-concepts.html
 *
 * "VS" monogram. The V's right-arm top portion is a finessed glossy DNA
 * helix (twisting ribbons, fuller at the base); a few glossy spheres ORBIT
 * the helix with a gravitational pull (tethers), one clear outlier. The
 * letters carry a keyline + offset shadow for depth (no box frame). A small
 * symmetric laurel sits at the bottom as a base. Color is placeholder —
 * tuned later. Cormorant Garamond = S + wordmark.
 *
 * View: http://localhost:5173/logo-concepts.html · v8 draft.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CREAM = '#F4EFE6', PAPER = '#FBF8F2', INK = '#1A1714';
const KEYLINE = '#9C7C3E';        // letter outline (placeholder)
const VIOLET = ['#9E80E2', '#5B45A8', '#33256E'];
const BLUE = ['#7FB4EC', '#2E6DB0', '#1C4A82'];
const CYAN = ['#9FE3F2', '#46AAD0', '#2A7FA6'];
const LEAFG = '#7C8A6F', LEAFD = '#566048';   // laurel (placeholder green)

const edges = (P) => P.map((p, i) => {
  const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
  let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1;
  return { p, nx: -ty / tl, ny: tx / tl };
});
function ribbonPath(P, wAt) {
  const E = edges(P), n = E.length, L = [], R = [];
  E.forEach((e, i) => { const w = wAt(i / (n - 1)) / 2; L.push([e.p[0] + e.nx * w, e.p[1] + e.ny * w]); R.push([e.p[0] - e.nx * w, e.p[1] - e.ny * w]); });
  const f = (pt) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
  return `M ${f(L[0])} L ${L.slice(1).map(f).join(' L ')} L ${R.reverse().map(f).join(' L ')} Z`;
}
function classicLeaf(cx, cy, len, wid, ang, fill, vein = true) {
  const r = ang * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r), px = -dy, py = dx;
  const f = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const bx = cx - dx * len / 2, by = cy - dy * len / 2, tx = cx + dx * len / 2, ty = cy + dy * len / 2, w = wid / 2;
  const aX = bx + dx * len * 0.34 + px * w, aY = by + dy * len * 0.34 + py * w;
  const bX = tx - dx * len * 0.16 + px * w * 0.32, bY = ty - dy * len * 0.16 + py * w * 0.32;
  const cX = tx - dx * len * 0.16 - px * w * 0.32, cY = ty - dy * len * 0.16 - py * w * 0.32;
  const dX = bx + dx * len * 0.34 - px * w, dY = by + dy * len * 0.34 - py * w;
  let s = `<path d="M ${f(bx, by)} C ${f(aX, aY)} ${f(bX, bY)} ${f(tx, ty)} C ${f(cX, cY)} ${f(dX, dY)} ${f(bx, by)} Z" fill="${fill}" opacity="0.95"/>`;
  if (vein) s += `<path d="M ${f(bx, by)} L ${f(tx, ty)}" stroke="${LEAFD}" stroke-opacity="0.5" stroke-width="0.6"/>`;
  return s;
}

function monoInner(gid, { ribW = 9, amp = 13, turns = 2.3, helixFrac = 0.56 } = {}) {
  const A = [142, 44], B = [90, 162];
  const dx = B[0] - A[0], dy = B[1] - A[1], Ln = Math.hypot(dx, dy);
  const nx = -dy / Ln, ny = dx / Ln, steps = 90;
  const s1 = [], s2 = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * helixFrac, u = t / helixFrac;
    const px = A[0] + dx * t, py = A[1] + dy * t, ph = 2 * Math.PI * turns * u, taper = 1 - u;
    s1.push([px + nx * amp * taper * Math.sin(ph), py + ny * amp * taper * Math.sin(ph)]);
    s2.push([px + nx * amp * taper * Math.sin(ph + Math.PI), py + ny * amp * taper * Math.sin(ph + Math.PI)]);
  }
  const wAt = (k) => ribW * (0.62 + 0.38 * Math.sin(Math.PI * k)); // fuller, not thin at ends
  const r1 = ribbonPath(s1, wAt), r2 = ribbonPath(s2, wAt);

  // spheres orbiting the helix with a gravitational pull (tethers); one outlier
  const orbit = [
    { t: 0.16, d: 9, r: 5, g: 'sa', side: 1 },
    { t: 0.34, d: 22, r: 4, g: 'sb', side: -1, tether: 1 },
    { t: 0.52, d: 6, r: 6.2, g: 'sa', side: 1 },
    { t: 0.66, d: 36, r: 5.4, g: 'sb', side: -1, tether: 1 }, // the one that sticks out
    { t: 0.84, d: 13, r: 4, g: 'sa', side: 1 },
  ];
  const glossy = orbit.map((o) => {
    const tt = o.t * helixFrac, cxp = A[0] + dx * tt, cyp = A[1] + dy * tt;
    const sx = cxp + nx * o.side * o.d, sy = cyp + ny * o.side * o.d;
    const tether = o.tether
      ? `<line x1="${cxp.toFixed(1)}" y1="${cyp.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${BLUE[1]}" stroke-width="0.9" stroke-dasharray="2 3" opacity="0.45"/>`
      : '';
    const hl = `<ellipse cx="${(sx - o.r * 0.32).toFixed(1)}" cy="${(sy - o.r * 0.36).toFixed(1)}" rx="${(o.r * 0.34).toFixed(1)}" ry="${(o.r * 0.22).toFixed(1)}" fill="#fff" opacity="0.6"/>`;
    return `${tether}<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${o.r}" fill="url(#${gid}${o.g})"/>${hl}`;
  }).join('');

  const M = [A[0] + dx * helixFrac, A[1] + dy * helixFrac], wM = 5, wB = 1.6;
  const solid = `M ${(M[0] + nx * wM).toFixed(1)} ${(M[1] + ny * wM).toFixed(1)} L ${(B[0] + nx * wB).toFixed(1)} ${(B[1] + ny * wB).toFixed(1)} L ${(B[0] - nx * wB).toFixed(1)} ${(B[1] - ny * wB).toFixed(1)} L ${(M[0] - nx * wM).toFixed(1)} ${(M[1] - ny * wM).toFixed(1)} Z`;

  // letter shapes — fill + offset for depth & keyline
  const letters = (fill, kl, ox = 0, oy = 0) => `<g transform="translate(${ox} ${oy})">
      <path d="M33 44 L55 44 L98 152 L88 162 Z" fill="${fill}" ${kl}/>
      <rect x="29" y="41" width="30" height="4.5" rx="1" fill="${fill}" ${kl}/>
      <path d="${solid}" fill="${fill}" ${kl}/>
      <text x="196" y="168" font-family="'Cormorant Garamond', serif" font-weight="600" font-size="190" fill="${fill}" ${kl} paint-order="stroke" stroke-linejoin="round" text-anchor="middle">S</text>
    </g>`;
  const klAttr = `stroke="${KEYLINE}" stroke-width="1.7" stroke-linejoin="round"`;

  return `
    <defs>
      <linearGradient id="${gid}r1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${VIOLET[0]}"/><stop offset="1" stop-color="${BLUE[1]}"/></linearGradient>
      <linearGradient id="${gid}r2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BLUE[0]}"/><stop offset="1" stop-color="${CYAN[1]}"/></linearGradient>
      <radialGradient id="${gid}sa" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#dfe9ff"/><stop offset="0.45" stop-color="${BLUE[1]}"/><stop offset="1" stop-color="${BLUE[2]}"/></radialGradient>
      <radialGradient id="${gid}sb" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#e8fbff"/><stop offset="0.45" stop-color="${CYAN[1]}"/><stop offset="1" stop-color="${CYAN[2]}"/></radialGradient>
    </defs>
    ${letters('rgba(26,23,20,0.22)', '', 2.5, 3.2)}
    ${letters(INK, klAttr)}
    <path d="${r2}" fill="url(#${gid}r2)"/>
    <path d="${r1}" fill="url(#${gid}r1)"/>
    <path d="${r1}" fill="none" stroke="#ffffff" stroke-width="0.7" opacity="0.3"/>
    ${glossy}
    <circle cx="89" cy="162" r="2.4" fill="${INK}"/>`;
}
const wrap = (inner) => `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${inner}</svg>`;

// ── laurel base: two mirrored sprigs forming a foot under the mark ────────
function laurelBase(bx, by) {
  const sprig = (dir) => {
    const P0 = [bx, by], P1 = [bx + dir * 40, by - 4], P2 = [bx + dir * 80, by - 40];
    const Q = (t) => [(1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
    const dQ = (t) => [2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])];
    let out = `<path d="M ${P0[0]} ${P0[1]} Q ${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}" fill="none" stroke="${LEAFD}" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>`;
    [0.28, 0.5, 0.72, 0.92].forEach((t, i) => {
      const b = Q(t), d = dQ(t), ta = Math.atan2(d[1], d[0]) * 180 / Math.PI;
      out += classicLeaf(b[0], b[1], 16 - i * 1.4, 8, ta + dir * 32, LEAFG, true);
    });
    return out;
  };
  return `<g>${sprig(1)}${sprig(-1)}<circle cx="${bx}" cy="${by}" r="2.6" fill="${LEAFD}"/></g>`;
}

function framed(gid) {
  return `<svg viewBox="0 0 460 430" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <g transform="translate(86,70)">${monoInner(gid)}</g>
    ${laurelBase(232, 300)}
  </svg>`;
}

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VS Research Labs — Logo Concept</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box} body{margin:0;background:${CREAM};color:${INK};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1040px;margin:0 auto;padding:64px 32px 120px}
  .eyebrow{font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:#9a8f7e;margin:0 0 10px}
  h1{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:42px;margin:0 0 6px}
  .sub{color:#7d7466;font-size:13px;margin:0 0 48px;max-width:64ch;line-height:1.6}
  .hero{background:${PAPER};border:1px solid rgba(26,23,20,0.10);border-radius:16px;padding:18px;box-shadow:0 18px 50px rgba(26,23,20,0.07)}
  .hero .mono{height:440px;display:flex;align-items:center;justify-content:center}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}
  .card{background:${PAPER};border:1px solid rgba(26,23,20,0.10);border-radius:14px;padding:24px;box-shadow:0 14px 40px rgba(26,23,20,0.06)}
  .label{font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:#9a8f7e;text-align:center;margin-top:14px}
  .lockup{margin-top:28px;background:${PAPER};border:1px solid rgba(26,23,20,0.10);border-radius:14px;padding:40px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;box-shadow:0 14px 40px rgba(26,23,20,0.06)}
  .word{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:44px;letter-spacing:0.06em}
  .word small{display:block;font-family:Inter,sans-serif;font-weight:400;font-size:10px;letter-spacing:0.34em;text-transform:uppercase;color:#9a8f7e;margin-top:8px}
  .note{margin-top:56px;font-size:12px;color:#9a8f7e;line-height:1.7;border-top:1px solid rgba(26,23,20,0.1);padding-top:20px}
</style></head>
<body><div class="wrap">
  <p class="eyebrow">VS Research Labs · Identity Concept · v8 draft</p>
  <h1>The DNA-V</h1>
  <p class="sub">Box border gone. The <strong>letters now carry a keyline + offset shadow</strong> for depth. The helix is <strong>fuller at the base</strong> and more finessed; the random dots are replaced by a few <strong>glossy spheres orbiting</strong> the helix with a gravitational pull (one clear outlier). A small <strong>laurel base</strong> sits underneath. Color is placeholder.</p>

  <div class="hero"><div class="mono">${framed('h')}</div></div>
  <div class="row">
    <div class="card"><div class="mono" style="height:320px">${framed('a')}</div><div class="label">With laurel base</div></div>
    <div class="card"><div class="mono" style="height:320px">${wrap(monoInner('b'))}</div><div class="label">Mark only</div></div>
  </div>
  <div class="lockup">
    <div style="width:140px;height:130px;flex:none">${framed('L')}</div>
    <div class="word">VS Research Labs<small>BioPeptide Sciences · Nootropics · Skin-Care</small></div>
  </div>
  <p class="note">v8 vector draft — keyline weight, helix turns/thickness, orbit count/spread, laurel size all tunable. Color is a placeholder set; we apply the real palette once the form is locked.</p>
</div></body></html>`;

writeFileSync(resolve(ROOT, 'public/logo-concepts.html'), html);
console.log('✓ wrote public/logo-concepts.html');
