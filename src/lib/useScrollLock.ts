/**
 * useScrollLock — ref-counted body scroll lock.
 *
 * Every modal/drawer that wants to lock page scroll calls this with its own
 * "active" flag. A module-level counter ensures the body's original overflow is
 * captured exactly once (on the first lock) and restored exactly once (when the
 * last lock releases).
 *
 * This fixes the stacking bug from per-component capture/restore: when two
 * lockers overlapped (e.g. the consent gate + the intro modal on first visit),
 * the second captured the first's `overflow:hidden` as its "previous" and
 * restored it on close — freezing the page until a full reload. Ref-counting
 * makes the order of opens/closes irrelevant.
 */

import { useEffect } from 'react';

let lockCount = 0;
let savedOverflow = '';

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, [active]);
}
