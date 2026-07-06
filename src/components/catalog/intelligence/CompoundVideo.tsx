/**
 * CompoundVideo — compact "Research Media" poster.
 *
 * A small movie-poster-style card: a tappable 9:16 poster on the left with
 * a play badge + creator handle, and the title + author + a short blurb on
 * the right. Clicking the poster (or "Watch") opens the live TikTok player
 * in a centered lightbox (watermark + handle intact → reads as a citation).
 * Staying compact keeps the overlay's pricing + dose controls in frame.
 */

import { useEffect, useState } from 'react';
import { parseEmbed, type CompoundVideoMeta } from '../../../lib/compoundVideo';

type CompoundVideoProps = CompoundVideoMeta;

export function CompoundVideo({ url, title, description, thumbnail, author: authorProp }: CompoundVideoProps) {
  const embed = parseEmbed(url);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!embed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-holo hover:text-holo-light">
        Watch the cited clip ↗
      </a>
    );
  }

  const author = authorProp || embed.author || '';

  return (
    <div className="flex items-stretch gap-3">
      {/* Poster — small 9:16, click to play */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        onDoubleClick={() => window.open(embed.watchUrl, '_blank', 'noopener,noreferrer')}
        aria-label="Play cited clip"
        className="group relative shrink-0 w-[88px] aspect-[9/16] overflow-hidden rounded-[6px] focus:outline-none focus-visible:ring-1 focus-visible:ring-holo/45"
        style={{
          background: 'linear-gradient(150deg, #2b2622 0%, #1a1714 55%, #0f0d0b 100%)',
          border: '1px solid rgba(26,23,20,0.18)',
        }}
      >
        {/* Thumbnail (locally hosted). WebP source with the original
            format (jpg/png) as fallback for browsers without WebP support. */}
        {thumbnail && (
          <picture>
            <source srcSet={thumbnail.replace(/\.(jpe?g|png)$/i, '.webp')} type="image/webp" />
            <img
              src={thumbnail}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </picture>
        )}
        {/* Darken for play-badge legibility */}
        <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.45) 100%)' }} aria-hidden="true" />
        {/* Play badge */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full transition-transform group-hover:scale-110"
            style={{ backgroundColor: 'var(--color-surface-elevated)', boxShadow: '0 2px 10px rgba(0,0,0,0.4)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-content-primary)" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
        {/* TikTok tag */}
        <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 text-left">
          <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/70">TikTok</span>
        </span>
      </button>

      {/* Meta — title, author, blurb, watch */}
      <div className="min-w-0 flex-1 flex flex-col">
        <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-ink/40">Research Media · Cited Clip</p>
        {title && <p className="mt-1 text-[12.5px] font-medium leading-tight text-ink">{title}</p>}
        {author && <p className="mt-0.5 text-[10px] font-mono text-ink/50">{author}</p>}
        {description && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink/55 line-clamp-3">{description}</p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-auto self-start inline-flex items-center gap-1 pt-2 text-[10.5px] text-holo hover:text-holo-light transition-colors"
        >
          ▶ Watch clip
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      {/* Lightbox player */}
      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[80]"
            style={{ backgroundColor: 'rgba(26,23,20,0.55)', backdropFilter: 'blur(3px)' }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title ? `${title} — video` : 'Cited clip'}
            className="fixed left-1/2 top-1/2 z-[81] -translate-x-1/2 -translate-y-1/2"
          >
            <div className="relative w-[325px] max-w-[92vw] rounded-[10px] overflow-hidden border border-ink/[0.14] bg-display" style={{ boxShadow: '0 24px 60px -18px rgba(26,23,20,0.5)' }}>
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-ink/[0.08]">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink/45 truncate">
                  {author || 'Cited clip'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={embed.watchUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-holo hover:text-holo-light">
                    Open ↗
                  </a>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-ink/45 hover:text-ink rounded-sm">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <iframe
                src={embed.embedSrc}
                title="Cited research clip"
                allow="encrypted-media; fullscreen; picture-in-picture"
                style={{ width: '100%', height: '580px', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
