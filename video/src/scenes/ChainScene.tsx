import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COLORS, MONO, SERIF } from '../theme';
import { SceneFade, FadeUp } from '../shared';

/**
 * Scene 2 — the definition. A short chain of amino-acid "beads" draws itself
 * left-to-right (the signature motion beat), with the definition line beneath.
 * Beads are brushed-silver nodes joined by a hairline bond — the peptide.
 */
const BEADS = 6;

export const ChainScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The bond hairline draws across first; beads pop in along it.
  const draw = spring({ frame, fps, delay: 10, config: { damping: 200 }, durationInFrames: 50 });
  const bondScaleX = interpolate(draw, [0, 1], [0, 1]);

  return (
    <SceneFade background={COLORS.cream}>
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 56 }}
      >
        <FadeUp delay={4}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: COLORS.inkTertiary,
            }}
          >
            Short chains of amino acids
          </span>
        </FadeUp>

        {/* The chain */}
        <div style={{ position: 'relative', width: 720, height: 96, display: 'flex', alignItems: 'center' }}>
          {/* Bond line */}
          <div
            style={{
              position: 'absolute',
              left: 48,
              right: 48,
              height: 2,
              background: `linear-gradient(90deg, ${COLORS.silverDark}, ${COLORS.silverLight}, ${COLORS.silverDark})`,
              transform: `scaleX(${bondScaleX})`,
              transformOrigin: 'left center',
            }}
          />
          {/* Beads */}
          {Array.from({ length: BEADS }).map((_, i) => {
            const beadDelay = 16 + i * 6;
            const pop = spring({
              frame,
              fps,
              delay: beadDelay,
              config: { damping: 12, stiffness: 180 },
              durationInFrames: 30,
            });
            const scale = interpolate(pop, [0, 1], [0, 1]);
            const x = 48 + (i * (720 - 96)) / (BEADS - 1);
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: x - 24,
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 35% 30%, ${COLORS.silverLight}, ${COLORS.silverDark})`,
                  boxShadow: `0 6px 16px -6px ${COLORS.silverDark}`,
                  border: `1px solid ${COLORS.creamElevated}`,
                  transform: `scale(${scale})`,
                }}
              />
            );
          })}
        </div>

        <FadeUp delay={44} style={{ maxWidth: 780, textAlign: 'center' }}>
          <p
            style={{
              fontFamily: SERIF,
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.32,
              color: COLORS.ink,
              margin: 0,
            }}
          >
            The same signaling molecules your body already produces to coordinate
            repair, growth, and balance.
          </p>
        </FadeUp>
      </AbsoluteFill>
    </SceneFade>
  );
};
