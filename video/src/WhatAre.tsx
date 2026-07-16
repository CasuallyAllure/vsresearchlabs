import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { SCENES, XFADE } from './timeline';
import { PlateScene } from './scenes/PlateScene';
import { TitleScene } from './scenes/TitleScene';
import { ChainScene } from './scenes/ChainScene';
import { CoordinateScene } from './scenes/CoordinateScene';
import { VialsScene } from './scenes/VialsScene';
import { EndScene } from './scenes/EndScene';

/**
 * "What are biopeptides" — slide 1 of the intro carousel, rebuilt as a branded
 * motion piece. Scenes crossfade by starting each XFADE frames before the
 * previous one ends (each SceneFade fades itself in over that window).
 */
const ORDER = [
  { Comp: PlateScene, dur: SCENES.plate },
  { Comp: TitleScene, dur: SCENES.title },
  { Comp: ChainScene, dur: SCENES.chain },
  { Comp: CoordinateScene, dur: SCENES.coordinate },
  { Comp: VialsScene, dur: SCENES.vials },
  { Comp: EndScene, dur: SCENES.end },
] as const;

export const WhatAre: React.FC = () => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: '#16130F' }}>
      {ORDER.map(({ Comp, dur }, i) => {
        const from = cursor;
        cursor += dur - XFADE;
        return (
          <Sequence key={i} from={from} durationInFrames={dur} premountFor={XFADE}>
            <Comp />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
