/**
 * useFocusTrap
 *
 * Modals/drawers in this app already close on ESC and lock body scroll,
 * but nothing stops Tab from walking focus out into the page behind the
 * overlay — a WCAG 2.2 keyboard-trap failure (2.1.2 / 2.4.3 in reverse:
 * the *background* must be trapped out, not the dialog). This hook keeps
 * keyboard focus cycling inside the dialog panel while it's open, and
 * restores focus to whatever triggered it on close, which is the expected
 * behavior for any `role="dialog"` surface.
 *
 * Usage: attach the returned ref to the dialog panel element and pass the
 * panel's open/visible state as `active`. The hook does not touch ESC
 * handling — it only listens for Tab/Shift+Tab and never stops propagation
 * of Escape, so existing close-on-ESC effects keep working unmodified.
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter(isVisible);
}

/**
 * Traps Tab/Shift+Tab focus inside the container while `active` is true.
 * Returns a ref to attach to the dialog panel element.
 */
export function useFocusTrap(active: boolean): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusable = getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return;

      const elements = getFocusableElements(container);
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const current = document.activeElement;

      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last || !container.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);

      const toRestore = previouslyFocusedRef.current;
      if (toRestore && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, [active]);

  return containerRef;
}
