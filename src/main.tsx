import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useProductOverrides } from './lib/productOverrides'

// Boot-time data: fetch per-SKU runtime overrides from Supabase so the
// public catalog renders hidden / deleted / price changes immediately
// without a redeploy. No-op when Supabase isn't configured.
useProductOverrides.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
