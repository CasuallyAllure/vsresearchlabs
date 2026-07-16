import React from 'react';
import { AbsoluteFill } from 'remotion';
import { COLORS, SERIF } from '../theme';
import { LineReveal, SceneFade, SeriesMark, FadeUp } from '../shared';

/**
 * Scene 1 — the title card. "What are biopeptides" in the Cormorant wordmark
 * face, magazine-cover caps, over the cream page. Series mark beneath.
 */
export const TitleScene: React.FC = () => {
  return (
    <SceneFade background={COLORS.cream}>
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30 }}
      >
        <FadeUp delay={6}>
          <SeriesMark text="PEPTIDES EXPLAINED · 01" />
        </FadeUp>

        <div style={{ textAlign: 'center', maxWidth: 1040 }}>
          <LineReveal delay={12}>
            <h1
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: 118,
                lineHeight: 1.02,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: COLORS.ink,
                margin: 0,
              }}
            >
              What are
            </h1>
          </LineReveal>
          <LineReveal delay={20}>
            <h1
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: 118,
                lineHeight: 1.06,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: COLORS.ink,
                margin: 0,
              }}
            >
              biopeptides
            </h1>
          </LineReveal>
        </div>

        <FadeUp delay={40}>
          <p
            style={{
              fontFamily: SERIF,
              fontSize: 34,
              fontWeight: 500,
              fontStyle: 'italic',
              color: COLORS.inkSecondary,
              margin: 0,
            }}
          >
            Naturally occurring in your body.
          </p>
        </FadeUp>
      </AbsoluteFill>
    </SceneFade>
  );
};
