/**
 * entranceSequence — pure logic for the scroll-controlled entrance
 * animation built from `Landing/Landing GIF.gif`.
 *
 * The frames are generated at build/dev time by
 * `scripts/buildLandingFrames.mjs` (npm run gen:landing-frames), which also
 * writes `src/data/landingSequence.json` — frame count + dimensions — so the
 * renderer never hardcodes a count that can drift from the generated assets.
 *
 * Persistence decision (documented): entrance completion is SESSION-scoped
 * (sessionStorage), matching the site's existing once-per-session greeting
 * pattern (`vsr.gateSeen` / `vsr.introSeen`). A returning visitor in a new
 * browser session replays the entrance — without the disclaimer gate, whose
 * localStorage persistence is untouched. Swap the storage below to
 * localStorage if once-ever is preferred.
 */

import manifest from '../data/landingSequence.json';

export const ENTRANCE_FRAME_COUNT: number = manifest.frameCount;
export const ENTRANCE_FRAME_WIDTH: number = manifest.width;
export const ENTRANCE_FRAME_HEIGHT: number = manifest.height;

/**
 * Scroll pixels consumed per frame. 121 frames × 34px ≈ 4,100px — roughly
 * five mobile viewports for the 10s source animation: slow enough to read,
 * short enough not to exhaust the visitor.
 */
export const ENTRANCE_PX_PER_FRAME = 34;

const SESSION_KEY = 'vsr.entranceDone';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Public URL of one generated frame; index is clamped into range. */
export function entranceFrameSrc(
  index: number,
  frameCount: number = ENTRANCE_FRAME_COUNT,
): string {
  const maxIndex = Math.max(0, frameCount - 1);
  const safe = Math.min(maxIndex, Math.max(0, Math.trunc(index)));
  return manifest.pathPattern.replace('{index}', String(safe).padStart(3, '0'));
}

/** Total scrollable distance (px) the entrance consumes before completing. */
export function entranceScrollDistance(
  frameCount: number = ENTRANCE_FRAME_COUNT,
): number {
  return Math.max(1, Math.round(frameCount * ENTRANCE_PX_PER_FRAME));
}

/** Scroll offset → progress in [0, 1]. */
export function entranceProgress(scrollY: number, scrollDistance: number): number {
  if (scrollDistance <= 0) return 1;
  return clamp01(scrollY / scrollDistance);
}

/** Progress in [0, 1] → frame index in [0, frameCount - 1]. */
export function entranceFrameForProgress(
  progress: number,
  frameCount: number = ENTRANCE_FRAME_COUNT,
): number {
  if (frameCount <= 1) return 0;
  return Math.round(clamp01(progress) * (frameCount - 1));
}

/** Has the entrance already completed this browser session? */
export function readEntranceDone(): boolean {
  try {
    return (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(SESSION_KEY) === '1'
    );
  } catch {
    return false;
  }
}

/** Lock the entrance as completed for this browser session. */
export function writeEntranceDone(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, '1');
    }
  } catch {
    /* storage blocked — the entrance simply replays next visit */
  }
}
