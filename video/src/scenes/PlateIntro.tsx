import React from 'react';
import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { SceneFade, SeriesMark } from '../shared';
import { COLORS, SERIF } from '../theme';

const PLATE_BG = `radial-gradient(120% 90% at 50% 32%, ${COLORS.plateElevated} 0%, ${COLORS.plate} 68%)`;

/** Scene 0 — near-black display plate: DNA mark, wordmark, series mark. */
export const PlateIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 40,
  });
  const wordIn = spring({
    frame,
    fps,
    delay: 16,
    config: { damping: 200 },
    durationInFrames: 36,
  });
  const markScale = interpolate(markIn, [0, 1], [0.82, 1]);
  const wordY = interpolate(wordIn, [0, 1], [24, 0]);

  return (
    <SceneFade background={PLATE_BG}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 34,
        }}
      >
        <Img
          src={staticFile('vs-dna-s-full-colour.svg')}
          style={{
            width: 170,
            height: 170,
            opacity: markIn,
            transform: `scale(${markScale})`,
          }}
        />
        <h1
          style={{
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: 84,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: COLORS.cream,
            margin: 0,
            opacity: wordIn,
            transform: `translateY(${wordY}px)`,
            // re-center optically against the letterspacing tail
            paddingLeft: '0.28em',
          }}
        >
          VS Research Labs
        </h1>
        <SeriesMark delay={34} />
      </div>
    </SceneFade>
  );
};
