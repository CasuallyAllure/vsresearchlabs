import React from 'react';
import { LineReveal, SceneFade, FadeUp, SeriesMark } from '../shared';
import { COLORS, SERIF } from '../theme';

/** Scene 1 — cream title plate: "What are biopeptides". */
export const TitleReveal: React.FC = () => {
  return (
    <SceneFade background={COLORS.cream}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 44,
        }}
      >
        <SeriesMark delay={4} />
        <div style={{ textAlign: 'center' }}>
          <LineReveal delay={10}>
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 500,
                fontSize: 168,
                lineHeight: 1.02,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: COLORS.ink,
                paddingLeft: '0.1em',
              }}
            >
              What are
            </div>
          </LineReveal>
          <LineReveal delay={20}>
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: 168,
                lineHeight: 1.05,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: COLORS.ink,
                paddingLeft: '0.1em',
              }}
            >
              Biopeptides
            </div>
          </LineReveal>
        </div>
        <FadeUp delay={40}>
          <p
            style={{
              fontFamily: SERIF,
              fontWeight: 500,
              fontStyle: 'italic',
              fontSize: 46,
              color: COLORS.inkSecondary,
              margin: 0,
            }}
          >
            Naturally occurring in your body.
          </p>
        </FadeUp>
      </div>
    </SceneFade>
  );
};
