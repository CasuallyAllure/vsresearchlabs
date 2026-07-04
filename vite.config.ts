import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor a harness-assigned port (PORT env) so the dev server can avoid a
  // busy 5173; falls back to Vite's default when PORT is unset.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
  build: {
    // The only chunks over 500 kB are the React/Supabase core and the
    // three.js 3D viz — and the viz is lazy-loaded (its own chunk, fetched
    // after paint, never on non-landing routes). So the warning is noise.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          // three.js / R3F stay bundled with their lazy importer chunk.
          if (id.includes('three') || id.includes('@react-three')) return
          if (id.includes('@supabase')) return 'supabase'
          if (
            id.includes('react-router') ||
            id.includes('react-dom') ||
            id.includes('/react/') ||
            id.includes('scheduler')
          )
            return 'react-vendor'
        },
      },
    },
  },
})
