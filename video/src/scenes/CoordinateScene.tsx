import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { COLORS, SERIF, MONO } from '../theme';
import { SceneFade, FadeUp } from '../shared';

/**
 * Scene 3 — the four pathways biopeptides coordinate, revealed as a stagger
 * of quiet labelled rows. Editorial, not iconographic.
 */
const PATHWAYS = ['Repair', 'Growth', 'Metabolism', 'Immune balance'];

export const CoordinateScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneFade background={COLORS.creamElevated}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 44 }}>
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
            Pathways they help regulate
          </span>
        </FadeUp>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 640 }}>
          {PATHWAYS.map((label, i) => {
            const rowDelay = 14 + i * 12;
            const pop = spring({ frame, fps, delay: rowDelay, config: { damping: 200 }, durationInFrames: 30 });
            const y = interpolate(pop, [0, 1], [30, 0]);
            const line = interpolate(pop, [0, 1], [0, 1]);
            const num = String(i + 1).padStart(2, '0');
            return (
              <div
                key={label}
                style={{
                  opacity: pop,
                  transform: `translateY(${y}px)`,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 28,
                  padding: '18px 0',
                  borderBottom: `1px solid ${COLORS.silver}33`,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 18, color: COLORS.silver, letterSpacing: '0.1em' }}>
                  {num}
                </span>
                <span style={{ fontFamily: SERIF, fontSize: 62, fontWeight: 500, color: COLORS.ink, lineHeight: 1 }}>
                  {label}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    height: 1,
                    width: interpolate(line, [0, 1], [0, 120]),
                    background: `linear-gradient(90deg, transparent, ${COLORS.silver})`,
                    alignSelf: 'center',
                  }}
                />
              </div>
            );
          })}
        </div>

        <FadeUp delay={72}>
          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 30, color: COLORS.inkSecondary, margin: 0 }}>
            Production naturally decreases with age.
          </p>
        </FadeUp>
      </AbsoluteFill>
    </SceneFade>
  );
};
