/**
 * BogoBanner — the LAUNCH DAY BOGO announcement on the storefront.
 *
 * Renders NOTHING unless the promo is genuinely live by the SERVER's clock.
 * That is the whole point of the gate below: promoSettings defaults to
 * disabled, and a missing server clock reads NOT LIVE, so the banner
 * under-promises during boot rather than advertising a dead promo (the rule
 * lib/promoOffers exists to enforce).
 *
 * Liveness comes from useBogoLive — the same subscription-based, server-clock
 * gate the two cart surfaces use, so the banner and the cart can never
 * disagree about whether the promo is running. Its header documents the two
 * traps it exists to avoid (never getState(); never the device clock).
 *
 * Copy is deliberately explicit about the deadline (a named day, in the
 * store's timezone) and about exclusivity — the header ticker advertises the
 * member percentage and the buy-2-get-1 term on the same page, and nothing
 * here may read as stacking with them.
 *
 * DISPLAY ONLY — place-order re-resolves every promo server-side.
 */

import { bogoDeadlineLabel, usePromoSettings } from '../../lib/promoSettings';
import { useBogoLive } from '../../lib/useBogoLive';

/** Plain-English name of STORE_TIME_ZONE ('America/Los_Angeles'). Spelled out
 *  rather than abbreviated so it reads the same in and out of DST. */
const STORE_TIME_ZONE_LABEL = 'Pacific';

export function BogoBanner() {
  const { live } = useBogoLive();
  // A subscription, not getState() — the deadline label must re-render with
  // the promo when settings load in.
  const bogoEndsAt = usePromoSettings((s) => s.bogoEndsAt);

  // Fails closed: not enabled, past the boundary, or no server clock at all.
  if (!live) return null;

  const deadline = bogoDeadlineLabel(bogoEndsAt);

  return (
    <section
      aria-label="Launch day buy one get one free offer"
      className="bogo-banner floating-module relative mb-[var(--space-4)] rounded-[var(--radius-module)] border border-ink/[0.09] p-[var(--space-4)] sm:p-[var(--space-5)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* gold-DARK, not gold: measured in-browser, plain `text-gold` is
            2.5:1 on the light theme's cream fill. gold-dark clears 4.5:1 in
            all three themes (lab 4.85 / light 4.68 / dark 4.68). */}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-gold-dark">
          Launch day BOGO
        </p>
        <p className="rounded-full border border-gold/40 bg-gold/[0.12] px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.2em] text-ink/75">
          Members only
        </p>
      </div>

      <h2 className="mt-[var(--space-2)] font-display text-[22px] leading-tight text-ink sm:text-[26px]">
        Buy one, get one free
      </h2>

      <p className="mt-[var(--space-2)] max-w-[62ch] text-[13px] leading-relaxed text-ink/75">
        Your cart pairs eligible items two at a time, and the cheaper item of each pair comes off
        the order entirely. Pairs form across different compounds, so two vials of anything
        eligible count. No code — it is applied at checkout.
      </p>

      {deadline && (
        <p className="mt-[var(--space-3)] font-mono text-[11px] leading-relaxed text-ink/85">
          Runs through the end of {deadline} — {STORE_TIME_ZONE_LABEL} time, the store&rsquo;s own
          clock.
        </p>
      )}

      {/* ink/60 is the floor that keeps this readable in the light theme
          (4.59:1); ink/50 measured 3.36:1 there. Terms a buyer is bound by do
          not get to be decorative. */}
      <p className="mt-[var(--space-3)] max-w-[74ch] text-[11px] leading-relaxed text-ink/60">
        Requires a signed-in account. 24-Hour Shipping items only; Korean Glutathione and
        laboratory equipment are excluded. Promotions do not combine — if the member percentage,
        wholesale pack pricing or the buy-2-get-1 term is worth more on your order, that one
        applies instead and this does not.
      </p>

      {/* Owner-approved conversion-glow family (DESIGN_2026_BLUEPRINT §3):
          a breathing, palette-internal gold glow cloned from Landing's
          .hero-cta-gold / heroCtaGoldGlow — same 2.6s ease-in-out cycle, same
          inset top highlight. The keyframe's `transform: scale()` is
          deliberately dropped: on a full-bleed banner a 1.5% scale would push
          past the viewport edge at 375px. Box-shadow only, reduced-motion →
          static mid-strength. No blur: this scrolls with the page. */}
      <style>{`
        .bogo-banner {
          animation: bogoBannerGlow 2.6s ease-in-out infinite;
        }
        @keyframes bogoBannerGlow {
          0%, 100% {
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.22),
              0 0 0 1px rgb(var(--c-gold) / 0.18),
              0 0 14px 0 rgb(var(--c-gold) / 0.35);
          }
          50% {
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.22),
              0 0 0 1px rgb(var(--c-gold) / 0.32),
              0 0 26px 3px rgb(var(--c-gold) / 0.6);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .bogo-banner {
            animation: none;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.22),
              0 0 16px 0 rgb(var(--c-gold) / 0.45);
          }
        }
      `}</style>
    </section>
  );
}
