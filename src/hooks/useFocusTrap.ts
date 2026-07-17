/**
 * useFocusTrap
 *
 * Modals/drawers in this app already close on ESC and lock body scroll,
 * but nothing stops Tab from walking focus out into the page behind the
 * overlay — every `aria-modal="true"` surface was claiming a modality it
 * did not enforce (WCAG 2.4.3 / 4.1.2). This hook keeps keyboard focus
 * cycling inside the dialog panel while it's open, and restores focus to
 * whatever triggered it on close.
 *
 * Usage: attach the returned ref to the dialog panel element and pass the
 * panel's open/visible state as `active`. The hook does not touch ESC
 * handling — it only listens for Tab/Shift+Tab and never stops propagation
 * of Escape, so existing close-on-ESC effects keep working unmodified.
 *
 * The keydown listener is bound to `document` in the CAPTURE phase, not to
 * the container: a container listener only fires while focus is already
 * inside, so one click on the scrim (or any background element) would kill
 * the trap for the rest of the session. This mirrors DisclaimerGate, which
 * is the one surface in this repo that already had modality right.
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Skips elements hidden via display:none / visibility:hidden / zero-box. */
function isVisible(el: HTMLElement): boolean {
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Traps Tab/Shift+Tab focus inside the container while `active` is true and
 * returns focus to the trigger on deactivate. Attach the returned ref to the
 * dialog panel.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const el = containerRef.current;
      if (!el) return;

      const elements = getFocusableElements(el);
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const current = document.activeElement;

      // Focus outside the panel (scrim click, programmatic blur) → pull it back.
      if (!(current instanceof HTMLElement) || !el.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && document.contains(toRestore)) toRestore.focus();
    };
  }, [active]);

  return containerRef;
}
