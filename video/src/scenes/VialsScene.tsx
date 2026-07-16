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
 * Scene 4 — the product still (rendered vial group) inside a display-case
 * frame, with a slow Ken-Burns push and the "research tools" line. Reuses the
 * existing what-are-vials.webp asset already shipped in public/media/intro.
 */
export const VialsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const push = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 120 });
  const scale = interpolate(push, [0, 1], [1.08, 1.16]);

  return (
    <SceneFade background={COLORS.plate}>
      <AbsoluteFill>
        {/* Vial still with slow push */}
        <AbsoluteFill style={{ overflow: 'hidden' }}>
          <Img
            src={staticFile('what-are-vials.webp')}
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }}
          />
          {/* Plate scrim so text reads */}
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${COLORS.plate}CC 0%, ${COLORS.plate}22 40%, ${COLORS.plate}EE 100%)`,
            }}
          />
        </AbsoluteFill>

        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 96 }}>
          <FadeUp delay={20} style={{ textAlign: 'center' }}>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 18,
                letterSpacing: '0.34em',
                textTransform: 'uppercase',
                color: COLORS.silverLight,
              }}
            >
              Research tools
            </span>
            <p
              style={{
                fontFamily: SERIF,
                fontSize: 56,
                fontWeight: 500,
                color: COLORS.cream,
                margin: '14px 0 0',
                maxWidth: 900,
                lineHeight: 1.2,
              }}
            >
              Precise instruments to study these pathways.
            </p>
          </FadeUp>
        </AbsoluteFill>
      </AbsoluteFill>
    </SceneFade>
  );
};
