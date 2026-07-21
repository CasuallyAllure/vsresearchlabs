/**
 * entranceSequence — scroll→frame math + session persistence for the
 * scroll-controlled entrance animation (Landing GIF frame sequence).
 */

import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  ENTRANCE_FRAME_COUNT,
  ENTRANCE_FRAME_WIDTH,
  ENTRANCE_FRAME_HEIGHT,
  ENTRANCE_PX_PER_FRAME,
  entranceFrameSrc,
  entranceScrollDistance,
  entranceProgress,
  entranceFrameForProgress,
  readEntranceDone,
  writeEntranceDone,
} from '../../src/lib/entranceSequence';

type StorageStub = Pick<Storage, 'getItem' | 'setItem'>;

function stubSessionStorage(stub: StorageStub | undefined) {
  vi.stubGlobal('sessionStorage', stub);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('manifest constants', () => {
  test('frame count and dimensions come from the generated manifest', () => {
    // The generator halves 241 source frames → 121 (first + last kept).
    expect(ENTRANCE_FRAME_COUNT).toBe(121);
    expect(ENTRANCE_FRAME_WIDTH).toBe(1080);
    expect(ENTRANCE_FRAME_HEIGHT).toBe(1916);
  });
});

describe('entranceFrameSrc', () => {
  test('builds the zero-padded public URL', () => {
    expect(entranceFrameSrc(0)).toBe('/landing-sequence/frame-000.webp');
    expect(entranceFrameSrc(7)).toBe('/landing-sequence/frame-007.webp');
    expect(entranceFrameSrc(120)).toBe('/landing-sequence/frame-120.webp');
  });

  test('clamps out-of-range and fractional indices', () => {
    expect(entranceFrameSrc(-5)).toBe('/landing-sequence/frame-000.webp');
    expect(entranceFrameSrc(999)).toBe('/landing-sequence/frame-120.webp');
    expect(entranceFrameSrc(3.9)).toBe('/landing-sequence/frame-003.webp');
  });

  test('respects an explicit frame count, including a degenerate one', () => {
    expect(entranceFrameSrc(10, 5)).toBe('/landing-sequence/frame-004.webp');
    expect(entranceFrameSrc(2, 0)).toBe('/landing-sequence/frame-000.webp');
  });
});

describe('entranceScrollDistance', () => {
  test('scales with frame count at the fixed px-per-frame pacing', () => {
    expect(entranceScrollDistance(100)).toBe(100 * ENTRANCE_PX_PER_FRAME);
    expect(entranceScrollDistance()).toBe(ENTRANCE_FRAME_COUNT * ENTRANCE_PX_PER_FRAME);
  });

  test('never returns less than 1px even for an empty sequence', () => {
    expect(entranceScrollDistance(0)).toBe(1);
  });
});

describe('entranceProgress', () => {
  test('maps scroll offset linearly into [0, 1]', () => {
    expect(entranceProgress(0, 4000)).toBe(0);
    expect(entranceProgress(1000, 4000)).toBe(0.25);
    expect(entranceProgress(4000, 4000)).toBe(1);
  });

  test('clamps overscroll and negative (rubber-band) offsets', () => {
    expect(entranceProgress(9999, 4000)).toBe(1);
    expect(entranceProgress(-50, 4000)).toBe(0);
  });

  test('treats a non-positive distance as already complete', () => {
    expect(entranceProgress(0, 0)).toBe(1);
    expect(entranceProgress(100, -1)).toBe(1);
  });

  test('treats a non-finite ratio as the start', () => {
    expect(entranceProgress(Number.NaN, 4000)).toBe(0);
  });
});

describe('entranceFrameForProgress', () => {
  test('maps progress endpoints to first and last frames', () => {
    expect(entranceFrameForProgress(0)).toBe(0);
    expect(entranceFrameForProgress(1)).toBe(ENTRANCE_FRAME_COUNT - 1);
  });

  test('rounds to the nearest frame mid-scrub', () => {
    expect(entranceFrameForProgress(0.5, 121)).toBe(60);
    expect(entranceFrameForProgress(0.25, 5)).toBe(1);
  });

  test('clamps out-of-range progress', () => {
    expect(entranceFrameForProgress(-1)).toBe(0);
    expect(entranceFrameForProgress(2)).toBe(ENTRANCE_FRAME_COUNT - 1);
    expect(entranceFrameForProgress(Number.NaN)).toBe(0);
  });

  test('degenerate sequences always resolve to frame 0', () => {
    expect(entranceFrameForProgress(0.9, 1)).toBe(0);
    expect(entranceFrameForProgress(0.9, 0)).toBe(0);
  });
});

describe('session persistence', () => {
  test('round-trips the completion flag through sessionStorage', () => {
    const store = new Map<string, string>();
    stubSessionStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(readEntranceDone()).toBe(false);
    writeEntranceDone();
    expect(store.get('vsr.entranceDone')).toBe('1');
    expect(readEntranceDone()).toBe(true);
  });

  test('reports not-done when sessionStorage is unavailable (node/SSR)', () => {
    stubSessionStorage(undefined);
    expect(readEntranceDone()).toBe(false);
    // write is a no-op rather than a throw
    expect(() => writeEntranceDone()).not.toThrow();
  });

  test('swallows storage access errors (private mode)', () => {
    stubSessionStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readEntranceDone()).toBe(false);
    expect(() => writeEntranceDone()).not.toThrow();
  });

  test('ignores foreign values under the key', () => {
    stubSessionStorage({
      getItem: () => 'true',
      setItem: () => undefined,
    });
    expect(readEntranceDone()).toBe(false);
  });
});
