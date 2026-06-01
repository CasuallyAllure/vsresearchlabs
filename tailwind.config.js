/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: { 900: '#000', 800: '#0a0a0a', 700: '#121212', 600: '#1a1a1a' },
        gold: { light: '#D4B896', DEFAULT: '#C4A35A', dark: '#8B7355', muted: '#6B5B4F' },
        // Secondary holographic accent — sourced from the FIG-01 hologram
        // visualization. Used on secondary CTAs, intelligence-context
        // accents, and glow. Gold stays the primary system signal.
        holo: { light: '#A8E5FF', DEFAULT: '#64C8FF', dim: '#3A8CB8', muted: '#1E5A7A' },
        text: { primary: '#fff', secondary: '#b3b3b3', tertiary: '#666' },
      },
      borderRadius: {
        card: '24px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
