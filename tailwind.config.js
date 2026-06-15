/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cream surface ramp (light editorial). base.900 = page cream;
        // lighter steps = cards / overlays. (Names kept so existing
        // `bg-base-*` utilities recolor without a sweep.)
        base: { 900: '#F4EFE6', 800: '#FBF9F4', 700: '#FFFFFF', 600: '#ECE6DA' },
        // Ink — primary content + on-cream overlays (use ink/xx opacity).
        ink: { DEFAULT: '#1A1714', light: '#6B635A', muted: '#9A9186' },
        // Gold — primary brand signal.
        gold: { light: '#C7A463', DEFAULT: '#B5904B', dark: '#8C6A2A', muted: '#A99770' },
        // Teal — secondary accent (replaces the holo cyan). Aliased as `holo`
        // so existing `holo-*` utilities recolor to teal without a sweep.
        holo: { light: '#62A0A6', DEFAULT: '#34727A', dim: '#1E444A', muted: '#1E444A' },
        teal: { light: '#62A0A6', DEFAULT: '#34727A', dark: '#1E444A' },
        // Light image-bay surface (specimen/product bays sit on light now).
        display: { DEFAULT: '#FBF9F4', elevated: '#FFFFFF' },
        text: { primary: '#1A1714', secondary: '#6B635A', tertiary: '#9A9186' },
      },
      borderRadius: {
        card: '24px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Cormorant Garamond', 'Times New Roman', 'Georgia', 'serif'],
        display: ['Cormorant Garamond', 'Times New Roman', 'Georgia', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
