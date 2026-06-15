import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useProductOverrides } from './lib/productOverrides'

// Boot-time data: fetch per-SKU runtime overrides from Supabase so the
// public catalog renders hidden / deleted / price changes immediately
// without a redeploy. No-op when Supabase isn't configured.
useProductOverrides.getState().load();

// One-time cleanup: the legacy 3-theme color cycler has been retired in favor
// of the single cream editorial system. Clear any persisted theme + attribute
// left over from the old build so returning visitors land on the new design.
try {
  document.documentElement.removeAttribute('data-theme')
  localStorage.removeItem('vsr.theme')
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
