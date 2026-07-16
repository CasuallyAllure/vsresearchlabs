import React from 'react';
import { Composition } from 'remotion';
import { WhatAre } from './WhatAre';
import { DURATION_IN_FRAMES, FPS } from './timeline';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="WhatAre"
      component={WhatAre}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
