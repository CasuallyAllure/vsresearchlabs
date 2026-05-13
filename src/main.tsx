import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ThemeProvider, ThemeTuningProvider } from './theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider initialTheme="classy-dark">
      <ThemeTuningProvider>
        <App />
      </ThemeTuningProvider>
    </ThemeProvider>
  </StrictMode>,
)
