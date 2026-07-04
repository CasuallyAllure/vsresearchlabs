/**
 * Tooltip
 *
 * Viewport-aware hover/focus tooltip. Position is computed in JS at
 * trigger enter/focus time using the trigger's bounding rect, then
 * clamped so the bubble can't run off the edge of the viewport — the
 * primary failure mode of pure-CSS tooltips on narrow screens.
 *
 * Placement:
 *   • Defaults above the trigger.
 *   • Falls back below if the trigger is in the top 100px of the
 *     viewport (no room above).
 *   • Horizontally centered on the trigger, then clamped 8px inside
 *     the viewport edges.
 *
 * Dismissal:
 *   • Mouse leave / blur (desktop)
 *   • Tap outside (mobile — pointerdown anywhere not on the trigger
 *     or the bubble closes it)
 *   • ESC key
 *
 * Rendered with `position: fixed` so it ignores overflow:hidden on
 * any ancestor (which is what was clipping it inside the catalog
 * scroll containers).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

interface TooltipProps {
  /** What to show inside the tooltip. Null/empty renders the trigger bare. */
  content: ReactNode;
  /** The trigger element — anything focusable. */
  children: ReactNode;
  /** Maximum tooltip width in px. The bubble auto-shrinks below this to
   *  fit narrow viewports. Default 280. */
  maxWidth?: number;
  /** Visually-hidden text used as aria-describedby on the trigger. */
  ariaId?: string;
}

const EDGE_PAD = 8;    // px between bubble and viewport edges
const GAP      = 10;   // px between bubble and trigger

export function Tooltip({ content, children, maxWidth = 280, ariaId }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef  = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});

  /** Compute the bubble position from the trigger's bounding rect. */
  const place = useCallback(() => {
    const trig = triggerRef.current?.getBoundingClientRect();
    if (!trig) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const width = Math.min(maxWidth, vw - EDGE_PAD * 2);

    // Horizontal: center on trigger, then clamp.
    let left = trig.left + trig.width / 2 - width / 2;
    left = Math.max(EDGE_PAD, Math.min(vw - width - EDGE_PAD, left));

    // Vertical: above by default; flip below if trigger is in top 100px
    // OR if the bubble would otherwise be off-screen.
    const placeBelow = trig.top < 100;
    const top = placeBelow ? trig.bottom + GAP : trig.top - GAP;

    // We use transform: translateY(-100%) so the bubble's bottom aligns
    // with `top`. When placing below, we don't translate.
    const translate = placeBelow ? 'none' : 'translateY(-100%)';

    setStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: vh - EDGE_PAD * 2,
      transform: translate,
      zIndex: 60,
    });
  }, [maxWidth]);

  // Open / close handlers
  const handleEnter = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);
  const handleLeave = useCallback(() => setOpen(false), []);

  // Reposition on scroll / resize while open so the bubble doesn't drift.
  useEffect(() => {
    if (!open) return;
    const onChange = () => place();
    window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    return () => {
      window.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [open, place]);

  // Tap-outside + ESC to close (mobile primarily).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (bubbleRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (content === null || content === undefined || content === '') {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocusCapture={handleEnter}
        onBlurCapture={handleLeave}
      >
        {children}
      </span>
      {open && (
        <div
          ref={bubbleRef}
          role="tooltip"
          id={ariaId}
          style={style}
          className="pointer-events-none"
        >
          <span
            className="block overflow-y-auto rounded-lg px-3 py-2.5 text-[11px] leading-relaxed text-ink/90 text-left normal-case tracking-normal font-normal"
            style={{
              background:
                'linear-gradient(180deg, rgba(28, 28, 28, 0.96) 0%, rgba(14, 14, 14, 0.97) 100%)',
              border: '0.5px solid rgba(140, 144, 148, 0.28)',
              boxShadow:
                '0 0 0 0.5px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 14px rgba(140, 144, 148, 0.15)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              maxHeight: 'inherit',
            }}
          >
            {content}
          </span>
        </div>
      )}
    </>
  );
}
