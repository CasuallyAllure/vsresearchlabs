export const FPS = 30;

/** Frames each scene crossfades over the previous one. */
export const XFADE = 12;

/** Scene durations in frames (30fps). */
export const SCENES = {
  plate: 96, // 0. dark plate — mark + wordmark
  title: 132, // 1. "What are biopeptides"
  chain: 168, // 2. amino-acid chain + definition
  coordinate: 138, // 3. repair / growth / metabolism / immune balance
  vials: 126, // 4. vial still + closing line
  end: 108, // 5. research-use-only endcard
} as const;

const total = Object.values(SCENES).reduce((sum, d) => sum + d, 0);
const overlaps = (Object.keys(SCENES).length - 1) * XFADE;

export const DURATION_IN_FRAMES = total - overlaps;
