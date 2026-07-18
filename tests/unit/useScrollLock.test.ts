// @vitest-environment happy-dom
/**
 * Unit tests for src/lib/useScrollLock.ts — the ref-counted body scroll lock.
 *
 * The property under test is the fix for the stacking bug: with per-component
 * capture/restore, two overlapping lockers (consent gate + intro modal) froze
 * the page because the second captured `overflow:hidden` as its "previous".
 * Ref-counting must make open/close order irrelevant: the original overflow is
 * captured on the FIRST lock and restored only when the LAST lock releases.
 *
 * The counter is module-level state, so every test unmounts all of its hooks
 * to hand the next test a zeroed counter.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useScrollLock } from '../../src/lib/useScrollLock';

beforeEach(() => {
  document.body.style.overflow = 'auto';
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('useScrollLock', () => {
  test('an inactive locker leaves the body alone', () => {
    const { unmount } = renderHook(() => useScrollLock(false));

    expect(document.body.style.overflow).toBe('auto');
    unmount();
  });

  test('locks on mount and restores the ORIGINAL overflow on unmount', () => {
    // Act — lock.
    const { unmount } = renderHook(() => useScrollLock(true));

    // Assert — body is frozen.
    expect(document.body.style.overflow).toBe('hidden');

    // Act — release.
    unmount();

    // Assert — the pre-lock value comes back, not ''.
    expect(document.body.style.overflow).toBe('auto');
  });

  test('two stacked lockers: the body stays locked until the LAST one releases', () => {
    // Arrange — the first-visit stack: consent gate, then intro modal on top.
    const gate = renderHook(() => useScrollLock(true));
    const modal = renderHook(() => useScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');

    // Act — the first locker closes while the second is still open.
    gate.unmount();

    // Assert — still locked (the old bug restored 'hidden' captured by #2... here
    // the count keeps it locked without touching the saved value).
    expect(document.body.style.overflow).toBe('hidden');

    // Act — the last locker closes.
    modal.unmount();

    // Assert — original value restored exactly once.
    expect(document.body.style.overflow).toBe('auto');
  });

  test('close order is irrelevant: releasing in reverse order restores too', () => {
    const first = renderHook(() => useScrollLock(true));
    const second = renderHook(() => useScrollLock(true));

    second.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    first.unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  test('toggling active on and off locks and releases without unmounting', () => {
    const { rerender, unmount } = renderHook(({ active }) => useScrollLock(active), {
      initialProps: { active: false },
    });
    expect(document.body.style.overflow).toBe('auto');

    rerender({ active: true });
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ active: false });
    expect(document.body.style.overflow).toBe('auto');

    unmount();
  });
});
