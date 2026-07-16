/**
 * VideoIntroModule
 *
 * Three-slide intro carousel (shown in the IntroModal on first entry). No tab
 * pills — the slide's title sits up top in the Cormorant wordmark face (same as
 * the header), changing as you swipe: "What are biopeptides" → "Our research" →
 * "For research only". Arrows + dots make the carousel obvious; swipe still works.
 *
 * Self-hosted, drop-in videos. Each slide auto-looks for two files by its id:
 *
 *   public/media/intro/<id>.jpg   ← poster (small, crisp on phone)
 *   public/media/intro/<id>.mp4   ← the video
 *
 * The poster gates everything: if the .jpg loads, the slide shows the poster
 * with a play button and the .mp4 only downloads when tapped (light). If the
 * poster isn't there yet, the slide falls back to the DNA "coming soon" plate —
 * so the page never looks broken before the files exist. No code change needed
 * to go live: just drop the two files in. See public/media/intro/README.md for
 * the recommended encoding (keep it small — 720p H.264, a few MB).
 *
 * Third-party clips take the other path: set `youtubeId` + `credit` on the slide
 * and it embeds the official (nocookie) player, click-to-load, with the creator
 * named underneath. We do not download and re-host video we don't own. Note that
 * frame-src in public/_headers must allow the player's origin.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const mediaSrc = (id: string, ext: 'mp4' | 'jpg') => `/media/intro/${id}.${ext}`;

interface VideoTab {
  id: string;
  title: string;        // top title (Cormorant), changes per slide
  subtitle: string;     // editorial line under the title
  body: string;         // supporting copy under the video
  /** Third-party YouTube clip. When set, the slide embeds the official player
   *  instead of a self-hosted mp4 — the creator keeps the view and the credit.
   *  We do not re-host other people's video. Requires a `credit`. */
  youtubeId?: string;
  credit?: { name: string; url: string };
  /** Optional still shown as the pre-play cover (e.g. a rendered vial group).
   *  When set, it replaces the branded DNA plate behind the play button. */
  cover?: string;
}

const TABS: VideoTab[] = [
  {
    id: 'what-are',
    title: 'What are biopeptides',
    subtitle: 'Naturally occurring in your body.',
    body:
      'Biopeptides are short chains of amino acids — the same signaling molecules ' +
      'your body already produces to coordinate repair, growth, metabolism, and ' +
      'immune balance. Production naturally decreases with age. Research peptides ' +
      'are tools used to study these pathways.',
    cover: '/media/intro/what-are-vials.webp',
    youtubeId: 'Ha7Chvv5pD8',
    credit: {
      name: 'What the Health',
      url: 'https://www.youtube.com/watch?v=Ha7Chvv5pD8',
    },
  },
  {
    id: 'why-vsrl',
    title: 'Our research',
    subtitle: 'Why we built VS Research Labs.',
    body:
      'A short note from the lab. Replace this copy with the voiceover script ' +
      'or talking points for the second video — what we focus on, what we ' +
      'measure, and what we will not compromise on.',
  },
  {
    id: 'b2b-only',
    title: 'For research only',
    subtitle: 'Research and B2B partners only.',
    body:
      'Every compound in our catalog is sold strictly for research and laboratory ' +
      'use. We work primarily with research labs, biotechs, and academic partners. ' +
      'Nothing on this site is for human or veterinary consumption.',
  },
];

export function VideoIntroModule() {
  const [active, setActive] = useState(0);
  const [posterOk, setPosterOk] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const tab = TABS[active];
  const count = TABS.length;

  const go = useCallback((i: number) => {
    setPlaying(null); // stop any playing video when navigating
    setActive(((i % count) + count) % count); // wrap around
  }, [count]);

  // Touch swipe — directional lock so vertical scroll still works.
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dx = useRef(0);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dx.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null || startY.current === null) return;
    const x = e.touches[0].clientX - startX.current;
    const y = e.touches[0].clientY - startY.current;
    if (Math.abs(x) > Math.abs(y) * 1.4) dx.current = x;
  }
  function onTouchEnd() {
    const threshold = 60;
    if (dx.current > threshold) go(active - 1);
    else if (dx.current < -threshold) go(active + 1);
    dx.current = 0;
    startX.current = null;
    startY.current = null;
  }

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(active - 1);
      if (e.key === 'ArrowRight') go(active + 1);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [active, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Introduction"
      className="research-surface-solid p-[var(--space-5)] sm:p-[var(--space-7)] mb-[var(--space-8)] mx-auto max-w-[920px]"
    >
      {/* Masthead — magazine-cover caps in the Cormorant face, compact, with the
          "Peptides Explained" series mark in a brushed-metal gradient beneath. */}
      <header className="text-center mb-[var(--space-4)]">
        <p className="font-mono text-[10px] tracking-[0.34em] text-ink/30 mb-[var(--space-2)]">
          {String(active + 1).padStart(2, '0')} <span className="mx-1 text-ink/[0.15]">·</span> {String(count).padStart(2, '0')}
        </p>
        <h2
          key={tab.id}
          className="font-serif font-medium uppercase tracking-[0.12em] leading-[1.05] text-ink text-[clamp(1.5rem,4.6vw,2.6rem)] [text-wrap:balance]"
        >
          {tab.title}
        </h2>
        <div className="mt-[var(--space-2)] flex items-center justify-center gap-3">
          <span
            aria-hidden="true"
            className="h-px w-8 sm:w-14 bg-gradient-to-r from-transparent to-[color:var(--color-accent-gold)]"
          />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.38em] bg-clip-text text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--color-accent-gold-dark), var(--color-accent-gold-light) 50%, var(--color-accent-gold-dark))',
            }}
          >
            Peptides Explained
          </span>
          <span
            aria-hidden="true"
            className="h-px w-8 sm:w-14 bg-gradient-to-l from-transparent to-[color:var(--color-accent-gold)]"
          />
        </div>
      </header>

      {/* Carousel: arrows flank the video well */}
      <div className="relative">
        <CarouselArrow side="left" onClick={() => go(active - 1)} />
        <div
          ref={trackRef}
          tabIndex={0}
          role="group"
          aria-label={`${tab.title} (${active + 1} of ${count})`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="relative w-full overflow-hidden rounded-[12px] bg-display border border-ink/[0.08] shadow-[inset_0_1px_2px_rgba(26,23,20,0.05)] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
          style={{ aspectRatio: '16 / 9' }}
        >
          {tab.youtubeId ? (
            playing === tab.id ? (
              // Tapped: load the official player. Nothing from YouTube is fetched
              // (and no YouTube cookie is set) until this point.
              <iframe
                key={tab.id}
                src={`https://www.youtube-nocookie.com/embed/${tab.youtubeId}?autoplay=1&rel=0`}
                title={tab.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0 bg-display"
              />
            ) : (
              // Branded cover plate — no third-party thumbnail. The clip itself
              // still loads (and is credited) only when tapped.
              <button
                type="button"
                onClick={() => setPlaying(tab.id)}
                aria-label={`Play: ${tab.title}`}
                className="group absolute inset-0 h-full w-full bg-display"
              >
                {tab.cover ? (
                  // Vial-group still: the image is the cover; title/eyebrow
                  // already sit above the well, so we show only the play button.
                  <>
                    <img
                      src={tab.cover}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-ink/0 transition-colors group-hover:bg-ink/[0.06]"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-ink/10 bg-base-800/90 backdrop-blur transition-transform group-hover:scale-105">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                          <path d="M5 3.5 14 9 5 14.5V3.5Z" fill="currentColor" className="text-ink/80" />
                        </svg>
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-b from-ink/[0.03] via-transparent to-ink/[0.07]"
                    />
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-2)] px-[var(--space-6)]">
                      <img
                        src="/brand/vs-dna-s-full-colour.png"
                        alt=""
                        aria-hidden="true"
                        width="44"
                        height="44"
                        style={{ width: 44, height: 44 }}
                      />
                      <span className="font-serif font-medium uppercase tracking-[0.16em] leading-tight text-ink text-center text-[clamp(1rem,3vw,1.55rem)] [text-wrap:balance]">
                        {tab.title}
                      </span>
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.34em] bg-clip-text text-transparent"
                        style={{
                          backgroundImage:
                            'linear-gradient(90deg, var(--color-accent-gold-dark), var(--color-accent-gold-light) 50%, var(--color-accent-gold-dark))',
                        }}
                      >
                        Peptides Explained · {String(active + 1).padStart(2, '0')}
                      </span>
                      <span className="mt-[var(--space-2)] flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-base-800/90 backdrop-blur transition-transform group-hover:scale-105">
                        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                          <path d="M5 3.5 14 9 5 14.5V3.5Z" fill="currentColor" className="text-ink/80" />
                        </svg>
                      </span>
                    </span>
                  </>
                )}
              </button>
            )
          ) : playing === tab.id && posterOk[tab.id] ? (
            // Tapped: load + play the mp4 (only fetched now — keeps the page light).
            <video
              key={tab.id}
              src={mediaSrc(tab.id, 'mp4')}
              poster={mediaSrc(tab.id, 'jpg')}
              controls
              autoPlay
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-cover bg-display"
            />
          ) : posterOk[tab.id] ? (
            // Poster present: crisp still + play button; mp4 not fetched yet.
            <button
              type="button"
              onClick={() => setPlaying(tab.id)}
              aria-label={`Play: ${tab.title}`}
              className="group absolute inset-0 h-full w-full"
            >
              <img src={mediaSrc(tab.id, 'jpg')} alt={`Video poster for ${tab.title}`} className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-ink/10 transition-colors group-hover:bg-ink/20">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-base-800/90 backdrop-blur transition-transform group-hover:scale-105">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M5 3.5 14 9 5 14.5V3.5Z" fill="currentColor" className="text-ink/80" />
                  </svg>
                </span>
              </span>
            </button>
          ) : (
            // No poster yet → clean "coming soon" plate (never looks broken).
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] text-ink/55">
              <img src="/brand/vs-dna-s-full-colour.png" alt="" aria-hidden="true" width="64" height="64" style={{ width: 64, height: 64 }} />
              <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-ink/40">Coming soon</p>
            </div>
          )}
        </div>

        {/* Hidden probes: a poster that loads flips its slide from "coming soon"
            to the real player. Drop <id>.jpg + <id>.mp4 into public/media/intro/. */}
        <div className="hidden" aria-hidden="true">
          {TABS.filter((t) => !t.youtubeId).map((t) => (
            <img
              key={t.id}
              src={mediaSrc(t.id, 'jpg')}
              alt=""
              aria-hidden="true"
              onLoad={() => setPosterOk((p) => (p[t.id] ? p : { ...p, [t.id]: true }))}
              onError={() => setPosterOk((p) => (p[t.id] === false ? p : { ...p, [t.id]: false }))}
            />
          ))}
        </div>
        <CarouselArrow side="right" onClick={() => go(active + 1)} />
      </div>

      {/* Body */}
      <p className="mt-[var(--space-4)] text-center text-[12.5px] sm:text-[13px] text-ink/60 leading-[1.65] max-w-[52ch] mx-auto [text-wrap:pretty]">
        {tab.body}
      </p>

      {/* Credit — third-party clip, embedded and attributed, never re-hosted. */}
      {tab.credit && (
        <p className="mt-[var(--space-3)] text-center font-mono text-[10px] uppercase tracking-[0.24em] text-ink/35">
          Video ·{' '}
          <a
            href={tab.credit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 transition-colors hover:text-ink/65 hover:underline"
          >
            {tab.credit.name}
          </a>
        </p>
      )}

      {/* Dots */}
      <div className="mt-[var(--space-5)] flex items-center justify-center gap-2">
        {TABS.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={`Go to ${t.title}`}
              aria-current={on ? 'true' : undefined}
              onClick={() => go(i)}
              className="rounded-full transition-[width,background-color] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
              style={{
                width: on ? 22 : 7,
                height: 7,
                backgroundColor: on ? 'rgba(26,23,20,0.7)' : 'rgba(26,23,20,0.18)',
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function CarouselArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const isLeft = side === 'left';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isLeft ? 'Previous' : 'Next'}
      className={`absolute top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-base-800/85 text-ink/70 backdrop-blur hover:text-ink hover:border-ink/35 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 ${
        isLeft ? 'left-1.5 sm:-left-3' : 'right-1.5 sm:-right-3'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        {isLeft ? (
          <path d="M9 1.5 3.5 7 9 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M5 1.5 10.5 7 5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
