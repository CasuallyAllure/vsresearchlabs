/**
 * VideoIntroModule
 *
 * Three-tab video intro shown near the top of the landing page. Each tab
 * has a 16:9 video well, a headline, and a short body. Buyer can switch
 * tabs by tapping the pills OR by swiping horizontally on the video.
 *
 * Today the videos are placeholders — the well shows the DNA-S logo on
 * cream until a real videoUrl is provided. Drop a hosted video URL into
 * the corresponding tab in TABS and it'll start playing inline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface VideoTab {
  id: string;
  label: string;        // pill text
  headline: string;     // bold line under the video
  body: string;         // 2–3 sentence supporting copy
  videoUrl?: string;    // optional hosted mp4/webm URL
  poster?: string;      // optional poster image URL
}

const TABS: VideoTab[] = [
  {
    id: 'what-are',
    label: 'What are biopeptides',
    headline: 'They are already inside you.',
    body:
      'Biopeptides are short chains of amino acids — the same signaling molecules ' +
      'your body already produces to coordinate repair, growth, metabolism, and ' +
      'immune balance. Production naturally decreases with age. Research peptides ' +
      'are tools used to study these pathways.',
  },
  {
    id: 'why-vsrl',
    label: 'Our research',
    headline: 'Why we built VS Research Labs.',
    body:
      'A short note from the lab. Replace this copy with the voiceover script ' +
      'or talking points for the second video — what we focus on, what we ' +
      'measure, and what we will not compromise on.',
  },
  {
    id: 'b2b-only',
    label: 'For research only',
    headline: 'Research and B2B partners only.',
    body:
      'Every compound in our catalog is sold strictly for research and laboratory ' +
      'use. We work primarily with research labs, biotechs, and academic partners. ' +
      'Nothing on this site is for human or veterinary consumption.',
  },
];

export function VideoIntroModule() {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const tab = TABS[active];

  const go = useCallback((i: number) => {
    setActive(Math.max(0, Math.min(TABS.length - 1, i)));
  }, []);

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

  // Keyboard nav when the module is focused
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
      aria-labelledby="video-intro-headline"
      className="research-surface-solid p-[var(--space-5)] sm:p-[var(--space-6)] mb-[var(--space-10)] mx-auto max-w-[920px]"
    >
      {/* Tab pills */}
      <div role="tablist" aria-label="Intro videos" className="flex flex-wrap gap-1.5 mb-[var(--space-4)]">
        {TABS.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`video-panel-${t.id}`}
              onClick={() => go(i)}
              className={[
                'rounded-full px-[var(--space-3)] sm:px-[var(--space-4)] py-[var(--space-2)] text-[10.5px] sm:text-[11px] uppercase tracking-[0.2em] transition-colors',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40',
                on
                  ? 'bg-ink/[0.10] text-ink border border-ink/25'
                  : 'border border-ink/[0.10] text-ink/55 hover:text-ink/85 hover:border-ink/25',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Video well — 16:9 with poster placeholder */}
      <div
        ref={trackRef}
        tabIndex={0}
        role="tabpanel"
        id={`video-panel-${tab.id}`}
        aria-label={tab.label}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="relative w-full overflow-hidden rounded-md bg-display border border-ink/[0.08] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
        style={{ aspectRatio: '16 / 9' }}
      >
        {tab.videoUrl ? (
          <video
            key={tab.id}
            src={tab.videoUrl}
            poster={tab.poster}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[var(--space-3)] text-ink/55">
            <img
              src="/brand/vs-dna-s-full-colour.png"
              alt=""
              width="64"
              height="64"
              style={{ width: 64, height: 64 }}
            />
            <p className="text-[10px] uppercase tracking-[0.3em] text-ink/40">Coming soon</p>
          </div>
        )}
      </div>

      {/* Headline + body */}
      <div className="mt-[var(--space-5)]">
        <h2
          id="video-intro-headline"
          className="text-[clamp(1.1rem,2.4vw,1.45rem)] leading-[1.2] tracking-[-0.01em] text-ink mb-[var(--space-2)]"
        >
          <span className="font-light text-ink/85">{tab.headline.split('.')[0]}.</span>
          {tab.headline.split('.').slice(1).join('.') && (
            <span className="font-medium text-ink"> {tab.headline.split('.').slice(1).join('.').trim()}</span>
          )}
        </h2>
        <p className="text-[13.5px] sm:text-[14px] text-ink/70 leading-relaxed max-w-[68ch]">
          {tab.body}
        </p>
      </div>

      {/* Dot indicators (mobile cue for swipe) */}
      <div className="mt-[var(--space-4)] flex items-center justify-center gap-1.5">
        {TABS.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={`Go to ${t.label}`}
              onClick={() => go(i)}
              className="h-1.5 w-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
              style={{
                backgroundColor: on ? 'rgba(26,23,20,0.7)' : 'rgba(26,23,20,0.15)',
                transform: on ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
