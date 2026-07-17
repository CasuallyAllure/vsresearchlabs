import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useProductOverrides } from './lib/productOverrides'
import { usePromoSettings } from './lib/promoSettings'
import { installGlobalErrorHandlers } from './lib/telemetry'

// Error tracking. Two listener registrations, no network, no SDK — cheap
// enough to sit on the critical shell path, and it must, because errors
// thrown before this point are errors we never hear about.
installGlobalErrorHandlers();

// Stale-deploy self-heal. Every deploy renames the hashed route chunks, so a
// browser holding yesterday's HTML asks for chunk files that no longer exist
// and the lazy route dies mid-navigation ("the page won't load"). Vite fires
// this event on exactly that failure — one reload fetches the fresh HTML and
// the right chunks. Guarded to a single attempt per pageview so a genuinely
// broken deploy can't reload-loop the visitor (flag lives for the session).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'vsrl_chunk_reload';
  if (sessionStorage.getItem(KEY) === '1') return; // already tried — let it surface
  sessionStorage.setItem(KEY, '1');
  event.preventDefault();
  window.location.reload();
});

// Boot-time data: fetch per-SKU runtime overrides from Supabase so the
// public catalog renders hidden / deleted / price changes immediately
// without a redeploy. No-op when Supabase isn't configured. Deferred to
// first idle so these two fetches don't contend with the critical render
// path; the 2s timeout bounds the delay so admin price overrides still land
// before a buyer can meaningfully interact with the catalog.
const scheduleBootLoads = () => {
  useProductOverrides.getState().load();
  // Promo governance (055) — drives the limited-time B2G1 messaging on
  // catalog shipping chips. Server stays authoritative for the discount.
  usePromoSettings.getState().load();
};
if ('requestIdleCallback' in window) {
  requestIdleCallback(scheduleBootLoads, { timeout: 2000 });
} else {
  setTimeout(scheduleBootLoads, 1);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
