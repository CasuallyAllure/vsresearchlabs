/**
 * Tooltip
 *
 * Lightweight hover/focus tooltip primitive. Position relative to the
 * trigger, fades in on hover or keyboard focus, fades out on leave/blur.
 *
 * Chrome matches the rest of the holo design language: dark frosted
 * panel, slim cyan border, soft glow. Uses CSS group-hover instead of
 * JS state so the tooltip has zero render cost when idle.
 *
 * Wrap the trigger directly:
 *
 *   <Tooltip content="…definition…">
 *     <button>{label}</button>
 *   </Tooltip>
 *
 * The wrapping span keeps the trigger as the layout child (no shift)
 * and provides the positioning context for the tooltip bubble.
 */

import type { ReactNode } from 'react';

interface TooltipProps {
  /** What to show inside the tooltip. Null/empty renders the trigger bare. */
  content: ReactNode;
  /** The trigger element — anything keyboard-focusable. */
  children: ReactNode;
  /** Where the tooltip appears relative to the trigger. Default: top. */
  position?: 'top' | 'bottom';
  /** Maximum tooltip width in px. Default 280. */
  maxWidth?: number;
  /** Visually-hidden text used as aria-describedby on the trigger. */
  ariaId?: string;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  maxWidth = 280,
  ariaId,
}: TooltipProps) {
  if (content === null || content === undefined || content === '') {
    return <>{children}</>;
  }

  const above = position === 'top';

  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        id={ariaId}
        className={[
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2',
          'opacity-0 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          'transition-opacity duration-150 delay-100',
          above ? 'bottom-full mb-2.5' : 'top-full mt-2.5',
        ].join(' ')}
        style={{ width: maxWidth, maxWidth }}
      >
        <span
          className="block rounded-lg px-3 py-2.5 text-[11px] leading-relaxed text-white/90 text-left normal-case tracking-normal font-normal"
          style={{
            background:
              'linear-gradient(180deg, rgba(28, 28, 28, 0.96) 0%, rgba(14, 14, 14, 0.97) 100%)',
            border: '0.5px solid rgba(120, 200, 245, 0.28)',
            boxShadow:
              '0 0 0 0.5px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 14px rgba(100, 200, 255, 0.15)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          {content}
        </span>
        {/* Small pointer arrow — keeps the tooltip visually attached
            to its trigger. */}
        <span
          aria-hidden="true"
          className={[
            'absolute left-1/2 -translate-x-1/2 h-2 w-2 rotate-45',
            above ? '-bottom-1' : '-top-1',
          ].join(' ')}
          style={{
            background: 'rgba(20, 20, 20, 0.97)',
            border: '0.5px solid rgba(120, 200, 245, 0.28)',
            borderTop: above ? 'none' : '0.5px solid rgba(120, 200, 245, 0.28)',
            borderLeft: above ? 'none' : '0.5px solid rgba(120, 200, 245, 0.28)',
            borderRight: above ? '0.5px solid rgba(120, 200, 245, 0.28)' : 'none',
            borderBottom: above ? '0.5px solid rgba(120, 200, 245, 0.28)' : 'none',
          }}
        />
      </span>
    </span>
  );
}
