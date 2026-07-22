/**
 * cfAnalytics — Cloudflare Web Analytics (RUM beacon) loader.
 *
 * Cloudflare's Web Analytics is cookieless and privacy-first: no
 * fingerprinting, no cross-site tracking, GDPR/CCPA-friendly by design. The
 * beacon token is public-by-design — it appears in the page source of every
 * site that runs CF Web Analytics, the same way a GA measurement ID does.
 * Gating on the env var is purely so builds without a token configured stay
 * clean (no dead script tag, no unconfigured beacon calling out).
 *
 * Ships inert: with no VITE_CF_BEACON_TOKEN set at build time, this is a
 * no-op. Set the env var and redeploy to switch analytics on.
 */

export function initCfAnalytics(): void {
  const token = import.meta.env.VITE_CF_BEACON_TOKEN;
  if (!token) return;

  try {
    const src = 'https://static.cloudflareinsights.com/beacon.min.js';
    if (document.querySelector(`script[src="${src}"]`)) return;

    const script = document.createElement('script');
    script.defer = true;
    script.src = src;
    script.setAttribute('data-cf-beacon', JSON.stringify({ token }));
    document.head.appendChild(script);
  } catch {
    // Analytics must never break boot.
  }
}
