#!/usr/bin/env node
/**
 * buildLandingFrames — processes the approved entrance animation
 * (`Landing/Landing GIF.gif`, 1080×1916 @ 25fps, 241 frames) into the
 * sequential WebP frames the scroll-controlled entrance renders.
 *
 * Run manually after the source GIF changes:
 *   npm run gen:landing-frames
 *
 * Output (committed to the repo — the deploy lane has no ffmpeg):
 *   public/landing-sequence/frame-XXX.webp   (XXX = 000…N-1)
 *   src/data/landingSequence.json            (frame count + dimensions)
 *
 * Every 2nd source frame is kept (first and last always included) — scroll
 * scrubbing needs positional coverage, not 25fps temporal resolution, and
 * halving keeps the preload payload reasonable.
 *
 * Requires ffmpeg and cwebp on PATH (`brew install ffmpeg webp`) — the
 * homebrew ffmpeg ships without libwebp, so frames are extracted as PNG
 * and encoded to WebP with cwebp.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'Landing', 'Landing GIF.gif');
const OUT_DIR = join(ROOT, 'public', 'landing-sequence');
const MANIFEST = join(ROOT, 'src', 'data', 'landingSequence.json');

/** Keep every Nth source frame. 241 frames / 2 → 121 kept (incl. first + last). */
const FRAME_STEP = 2;
/** Output width — native GIF width, so desktop cover-rendering stays sharp. */
const OUT_WIDTH = 1080;
/** libwebp quality — tuned so the full sequence stays around ~10 MB. */
const WEBP_QUALITY = 68;

if (!existsSync(SOURCE)) {
  console.error(`Source GIF not found: ${SOURCE}`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const tmpDir = join(OUT_DIR, '.tmp-png');
mkdirSync(tmpDir);

console.log(`Extracting every ${FRAME_STEP}nd frame from ${SOURCE} …`);
execFileSync(
  'ffmpeg',
  [
    '-v', 'error',
    '-i', SOURCE,
    '-vf', `select='not(mod(n\\,${FRAME_STEP}))',scale=${OUT_WIDTH}:-2`,
    '-vsync', 'vfr',
    join(tmpDir, 'tmp-%04d.png'),
  ],
  { stdio: 'inherit' },
);

// ffmpeg numbers from 1 with a temp prefix — encode to the zero-based,
// zero-padded WebP names the renderer requests.
const tmpNames = readdirSync(tmpDir).filter((f) => f.startsWith('tmp-')).sort();
console.log(`Encoding ${tmpNames.length} frames to WebP (q${WEBP_QUALITY}) …`);
tmpNames.forEach((name, i) => {
  execFileSync('cwebp', [
    '-quiet',
    '-q', String(WEBP_QUALITY),
    join(tmpDir, name),
    '-o', join(OUT_DIR, `frame-${String(i).padStart(3, '0')}.webp`),
  ]);
});
rmSync(tmpDir, { recursive: true, force: true });

// Probe one output frame for the true output dimensions.
const probe = execFileSync('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height',
  '-of', 'csv=p=0',
  join(OUT_DIR, 'frame-000.webp'),
]).toString().trim();
const [width, height] = probe.split(',').map(Number);

const totalBytes = readdirSync(OUT_DIR)
  .reduce((sum, f) => sum + statSync(join(OUT_DIR, f)).size, 0);

const manifest = {
  frameCount: tmpNames.length,
  width,
  height,
  pathPattern: '/landing-sequence/frame-{index}.webp',
};
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Wrote ${tmpNames.length} frames (${width}×${height}) — ` +
  `${(totalBytes / 1024 / 1024).toFixed(1)} MB total — and ${MANIFEST}`,
);
