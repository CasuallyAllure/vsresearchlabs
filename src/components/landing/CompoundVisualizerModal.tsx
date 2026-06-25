/**
 * CompoundVisualizerModal
 *
 * The "blown up" view of the FIG-01 compound visualizer. Clicking the
 * expand glyph on the inline hero panel opens this — the same framed
 * module (CompoundVisualizerFrame) rendered large in a centered overlay
 * so the 3D structure is comfortable to rotate, zoom, and inspect.
 *
 * Portaled to <body> so it escapes the sticky header's stacking context,
 * scroll-locked while open, dismissible via X / backdrop / ESC. Honors
 * prefers-reduced-motion (the enter/exit transition collapses to a fade).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CompoundVisualizerFrame } from './CompoundVisualizerFrame';
import { useScrollLock } from '../../lib/useScrollLock';

interface CompoundVisualizerModalProps {
  open: boolean;
  onClose: () => void;
}

export function CompoundVisualizerModal({ open, onClose }: CompoundVisualizerModalProps) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);

  // Mount on open; trigger the enter transition on the next frame.
  useEffect(() => {
    if (open) {
      setRender(true);
      const t = setTimeout(() => setShown(true), 30);
      return () => clearTimeout(t);
    }
    // Closing — play the exit transition, then unmount.
    setShown(false);
    const t = setTimeout(() => setRender(false), 250);
    return () => clearTimeout(t);
  }, [open]);

  // Body scroll lock while visible (ref-counted).
  useScrollLock(render);

  // ESC closes.
  useEffect(() => {
    if (!render) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [render, onClose]);

  if (!render) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compound visualizer — expanded"
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6"
    >
      {/* Backdrop — luminous cream veil, not a dark scrim. Frosted blur +
          a soft white bloom toward the top keeps the expanded module
          feeling ethereal and on-brand rather than a smoky lightbox. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: 'var(--visualizer-backdrop)',
          backdropFilter: 'blur(10px) saturate(118%)',
          WebkitBackdropFilter: 'blur(10px) saturate(118%)',
        }}
      />

      {/* Panel — large, but capped so it never overflows the viewport. */}
      <div
        className={`relative w-[min(96vw,1100px)] h-[min(88dvh,820px)] transition-all duration-300 ease-out ${
          shown ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[0.97]'
        }`}
      >
        <CompoundVisualizerFrame expanded onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
