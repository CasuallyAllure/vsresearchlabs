import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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
