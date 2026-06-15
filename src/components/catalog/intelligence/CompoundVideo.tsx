/**
 * CompoundVideo
 *
 * Inline "Research Media" player for a compound's cited clip. Embeds the
 * social video (TikTok today) via its official embed — the creator's
 * watermark + handle stay on the player, so it reads as a citation.
 * Double-clicking the frame (or the "Watch" affordance) opens the full
 * video on the source. Plays on tap (browsers block autoplay-with-sound).
 */

import { parseEmbed } from '../../../lib/compoundVideo';

export function CompoundVideo({ url }: { url: string }) {
  const embed = parseEmbed(url);

  if (!embed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-holo hover:text-holo-light"
      >
        Watch the cited clip
        <span aria-hidden="true">↗</span>
      </a>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink/40">
          Cited clip · {embed.provider}
        </span>
        <a
          href={embed.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-holo hover:text-holo-light transition-colors"
        >
          Watch on TikTok
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div
        className="mx-auto w-full max-w-[325px] overflow-hidden rounded-[8px] border border-ink/[0.12] bg-display"
        onDoubleClick={() => window.open(embed.watchUrl, '_blank', 'noopener,noreferrer')}
        title="Double-click to open on TikTok"
      >
        <iframe
          src={embed.embedSrc}
          title="Cited research clip"
          loading="lazy"
          allow="encrypted-media; fullscreen; picture-in-picture"
          style={{ width: '100%', height: '575px', border: 'none', display: 'block' }}
        />
      </div>

      <p className="mt-1.5 text-center text-[9px] text-ink/35">
        Third-party clip — double-click to watch on TikTok.
      </p>
    </div>
  );
}
