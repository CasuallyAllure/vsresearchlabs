import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COLORS, MONO, SILVER_GRADIENT } from './theme';
import { XFADE } from './timeline';

/** Crossfade wrapper: fades the scene in over the first XFADE frames. */
export const SceneFade: React.FC<{
  children: React.ReactNode;
  background: string;
}> = ({ children, background }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, XFADE], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{ background, opacity }}>{children}</AbsoluteFill>;
};

/** The gold-hairline + brushed-silver series mark, as on the site masthead. */
export const SeriesMark: React.FC<{
  text?: string;
  delay?: number;
  color?: 'silver';
}> = ({ text = 'PEPTIDES EXPLAINED · 01', delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
    durationInFrames: 30,
  });
  const lineWidth = interpolate(progress, [0, 1], [0, 88]);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        opacity: progress,
      }}
    >
      <span
        style={{
          height: 1,
          width: lineWidth,
          background: `linear-gradient(90deg, transparent, ${COLORS.silver})`,
        }}
      />
      <span
        style={{
          fontFamily: MONO,
          fontSize: 21,
          fontWeight: 500,
          letterSpacing: '0.38em',
          backgroundImage: SILVER_GRADIENT,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
      <span
        style={{
          height: 1,
          width: lineWidth,
          background: `linear-gradient(270deg, transparent, ${COLORS.silver})`,
        }}
      />
    </div>
  );
};

/** Masked line reveal: text slides up from behind an overflow-hidden clip. */
export const LineReveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
    durationInFrames: 34,
  });
  const translateY = interpolate(progress, [0, 1], [110, 0]);
  return (
    <div style={{ overflow: 'hidden' }}>
      <div style={{ transform: `translateY(${translateY}%)`, ...style }}>
        {children}
      </div>
    </div>
  );
};

/** Simple fade + drift up, for secondary copy. */
export const FadeUp: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
    durationInFrames: 36,
  });
  const translateY = interpolate(progress, [0, 1], [26, 0]);
  return (
    <div style={{ opacity: progress, transform: `translateY(${translateY}px)`, ...style }}>
      {children}
    </div>
  );
};
