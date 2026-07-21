#!/usr/bin/env node
/**
 * buildAtmosphere — processes a single frame of the approved entrance
 * animation (`Landing/Landing GIF.gif`, 1080×1916, 241 frames) into the
 * fixed, luminous backdrop the "lab" theme renders behind all content.
 *
 * Run manually after the source GIF changes:
 *   npm run gen:atmosphere
 *
 * Output (committed to the repo — the deploy lane has no ffmpeg):
 *   public/atmosphere/lab-backdrop.webp
 *
 * A heavy gaussian blur turns the vials into soft light fields rather than
 * a recognizable frame, then a slight darken + saturation lift keeps the
 * amber/blue glow legible once the theme's darkening overlay stacks on top.
 *
 * Requires ffmpeg and cwebp on PATH (`brew install ffmpeg webp`) — the
 * homebrew ffmpeg ships without libwebp, so the frame is extracted as PNG
 * and encoded to WebP with cwebp.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'Landing', 'Landing GIF.gif');
const OUT_DIR = join(ROOT, 'public', 'atmosphere');
const OUT_FILE = join(OUT_DIR, 'lab-backdrop.webp');

/** Source frame to extract (0-indexed, of 241 total). */
const FRAME_INDEX = 180;
/** Output width — the backdrop is heavily blurred, so it never needs to be sharp. */
const OUT_WIDTH = 960;
/** Target output size, in bytes. */
const TARGET_MAX_BYTES = 100 * 1024;
/** Starting libwebp quality; lowered if the output exceeds TARGET_MAX_BYTES. */
const START_QUALITY = 60;

if (!existsSync(SOURCE)) {
  console.error(`Source GIF not found: ${SOURCE}`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const tmpPng = join(OUT_DIR, '.tmp-frame.png');

console.log(`Extracting frame ${FRAME_INDEX} from ${SOURCE} …`);
execFileSync(
  'ffmpeg',
  [
    '-v', 'error',
    '-i', SOURCE,
    '-vf',
    `select=eq(n\\,${FRAME_INDEX}),` +
      `scale=${OUT_WIDTH}:-2,` +
      'gblur=sigma=28,' +
      'eq=brightness=-0.12:saturation=1.15',
    '-vsync', 'vfr',
    '-frames:v', '1',
    tmpPng,
  ],
  { stdio: 'inherit' },
);

let quality = START_QUALITY;
console.log(`Encoding to WebP (q${quality}) …`);
execFileSync('cwebp', ['-quiet', '-q', String(quality), tmpPng, '-o', OUT_FILE]);

let outBytes = statSync(OUT_FILE).size;
while (outBytes > TARGET_MAX_BYTES && quality > 10) {
  quality -= 10;
  console.log(`Output ${(outBytes / 1024).toFixed(1)}KB exceeds target — re-encoding at q${quality} …`);
  execFileSync('cwebp', ['-quiet', '-q', String(quality), tmpPng, '-o', OUT_FILE]);
  outBytes = statSync(OUT_FILE).size;
}

rmSync(tmpPng, { force: true });

console.log(`Wrote ${OUT_FILE} — ${(outBytes / 1024).toFixed(1)}KB (q${quality})`);
