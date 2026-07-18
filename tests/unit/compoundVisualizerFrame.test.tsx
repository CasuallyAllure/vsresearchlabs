// @vitest-environment happy-dom
/**
 * Unit tests for the CompoundVisualizerFrame idle gate.
 *
 * The property under test: the frame must NOT mount <HeroHoloCarousel> (whose
 * lazy chunk is ~255KB gz of three.js) on first commit — that dynamic import
 * contends with the landing first paint. The carousel mounts only after a
 * requestIdleCallback slot (or a short setTimeout fallback on browsers
 * without it, e.g. Safari), except when the user explicitly requests
 * expansion, which bypasses the gate.
 *
 * HeroHoloCarousel is mocked with a lightweight stub so three.js never loads
 * in the test process.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CompoundVisualizerFrame } from '../../src/components/landing/CompoundVisualizerFrame';

vi.mock('../../src/components/landing/HeroHoloCarousel', () => ({
  HeroHoloCarousel: () => <div data-testid="holo-stub" />,
}));

type IdleCallback = () => void;

/** Captures idle callbacks without firing them, so tests control the gate. */
function stubIdleCallback() {
  const pending: IdleCallback[] = [];
  window.requestIdleCallback = vi.fn((cb: IdleRequestCallback) => {
    pending.push(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
    return pending.length;
  }) as unknown as typeof window.requestIdleCallback;
  window.cancelIdleCallback = vi.fn();
  return pending;
}

const originalRequestIdle = window.requestIdleCallback;
const originalCancelIdle = window.cancelIdleCallback;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  window.requestIdleCallback = originalRequestIdle;
  window.cancelIdleCallback = originalCancelIdle;
});

describe('CompoundVisualizerFrame idle gate', () => {
  test('does not mount the heavy carousel before the idle callback fires', () => {
    // Arrange — idle slots never arrive.
    stubIdleCallback();

    // Act
    render(<CompoundVisualizerFrame />);

    // Assert — fallback visible, stub (and therefore the chunk) not mounted.
    expect(screen.getByText('Initializing structure…')).toBeDefined();
    expect(screen.queryByTestId('holo-stub')).toBeNull();
  });

  test('mounts the carousel after the idle callback fires', async () => {
    // Arrange
    const pending = stubIdleCallback();
    render(<CompoundVisualizerFrame />);
    expect(screen.queryByTestId('holo-stub')).toBeNull();

    // Act — the browser grants an idle slot.
    act(() => {
      pending.forEach((fire) => fire());
    });

    // Assert — lazy import resolves to the stub.
    expect(await screen.findByTestId('holo-stub')).toBeDefined();
  });

  test('falls back to setTimeout when requestIdleCallback is unavailable (Safari)', async () => {
    // Arrange — simulate Safari: no requestIdleCallback at all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).requestIdleCallback = undefined;

    // Act
    render(<CompoundVisualizerFrame />);

    // Assert — gated at first commit, mounted after the ~200ms fallback.
    expect(screen.queryByTestId('holo-stub')).toBeNull();
    expect(await screen.findByTestId('holo-stub')).toBeDefined();
  });

  test('expand request bypasses the idle gate immediately', async () => {
    // Arrange — idle slots never arrive; the user clicks Expand anyway.
    stubIdleCallback();
    const onExpand = vi.fn();
    render(<CompoundVisualizerFrame onExpand={onExpand} />);
    expect(screen.queryByTestId('holo-stub')).toBeNull();

    // Act
    act(() => {
      screen.getByLabelText('Expand compound visualizer').click();
    });

    // Assert — expansion requested and the carousel mounts without idle.
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('holo-stub')).toBeDefined();
  });
});
