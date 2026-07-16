import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COLORS, SERIF } from '../theme';
import { SceneFade } from '../shared';

/**
 * Scene 0 — the dark "display case" plate. The DNA mark settles in, the
 * VS RESEARCH LABS wordmark reveals beneath it. Sets the institutional tone
 * before any copy. Mirrors the near-black --color-display-base insets.
 */
export const PlateScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const markScale = interpolate(markIn, [0, 1], [0.82, 1]);
  const markOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  const wordmarkOpacity = interpolate(frame, [24, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const wordmarkTracking = interpolate(frame, [24, 60], [0.5, 0.34], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <SceneFade
      background={`radial-gradient(120% 90% at 50% 34%, ${COLORS.plateElevated} 0%, ${COLORS.plate} 60%)`}
    >
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34 }}
      >
        <Img
          src={staticFile('vs-dna-s-full-colour.svg')}
          style={{
            width: 132,
            height: 132,
            opacity: markOpacity,
            transform: `scale(${markScale})`,
          }}
        />
        <div style={{ overflow: 'hidden', paddingBottom: 6 }}>
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 500,
              fontSize: 40,
              letterSpacing: `${wordmarkTracking}em`,
              textTransform: 'uppercase',
              color: COLORS.cream,
              opacity: wordmarkOpacity,
              paddingLeft: `${wordmarkTracking}em`,
            }}
          >
            VS Research Labs
          </div>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
