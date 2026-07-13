import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useProductOverrides } from './lib/productOverrides'
import { usePromoSettings } from './lib/promoSettings'

// Boot-time data: fetch per-SKU runtime overrides from Supabase so the
// public catalog renders hidden / deleted / price changes immediately
// without a redeploy. No-op when Supabase isn't configured.
useProductOverrides.getState().load();
// Promo governance (055) — drives the limited-time B2G1 messaging on catalog
// shipping chips. Server stays authoritative for the actual discount.
usePromoSettings.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
