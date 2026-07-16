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
import { COLORS, SERIF, MONO } from '../theme';
import { SceneFade, FadeUp } from '../shared';

/**
 * Scene 5 — endcard. Mark + wordmark lock-up over the plate, with the
 * mandatory research-use-only compliance line. This is the frame that holds
 * as the poster/last still.
 */
export const EndScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const markScale = interpolate(markIn, [0, 1], [0.86, 1]);

  return (
    <SceneFade
      background={`radial-gradient(120% 90% at 50% 40%, ${COLORS.plateElevated} 0%, ${COLORS.plate} 62%)`}
    >
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}>
        <Img
          src={staticFile('vs-dna-s-full-colour.svg')}
          style={{ width: 96, height: 96, opacity: markIn, transform: `scale(${markScale})` }}
        />
        <FadeUp delay={16}>
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 500,
              fontSize: 46,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: COLORS.cream,
              paddingLeft: '0.3em',
            }}
          >
            VS Research Labs
          </div>
        </FadeUp>
        <FadeUp delay={30}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 17,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: COLORS.complianceRed,
              opacity: 0.92,
            }}
          >
            For research use only · Not for human consumption
          </span>
        </FadeUp>
      </AbsoluteFill>
    </SceneFade>
  );
};
