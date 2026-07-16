/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette is bound to CSS channel variables (space-separated RGB)
        // so the whole utility surface (incl. `/xx` opacity modifiers)
        // recolors when `html[data-theme="dark"]` flips the channels.
        // Light values live in :root; dark values in the [data-theme] block
        // — both in src/theme/theme.css. Never hardcode hex here again.
        //
        // Cream surface ramp (light) → near-black ramp (dark). base.900 = page.
        base: {
          900: 'rgb(var(--c-base-900) / <alpha-value>)',
          800: 'rgb(var(--c-base-800) / <alpha-value>)',
          700: 'rgb(var(--c-base-700) / <alpha-value>)',
          600: 'rgb(var(--c-base-600) / <alpha-value>)',
        },
        // Ink — primary content. Near-black (light) → silver (dark).
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          light: 'rgb(var(--c-ink-light) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
        },
        // Gold — primary brand signal. Stays warm in both themes.
        gold: {
          light: 'rgb(var(--c-gold-light) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-gold) / <alpha-value>)',
          dark: 'rgb(var(--c-gold-dark) / <alpha-value>)',
          muted: 'rgb(var(--c-gold-muted) / <alpha-value>)',
        },
        // Teal — secondary accent. Aliased as `holo` so existing `holo-*`
        // utilities recolor without a sweep. Stays warm in both themes.
        holo: {
          light: 'rgb(var(--c-teal-light) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-teal) / <alpha-value>)',
          dim: 'rgb(var(--c-teal-dark) / <alpha-value>)',
          muted: 'rgb(var(--c-teal-dark) / <alpha-value>)',
        },
        teal: {
          light: 'rgb(var(--c-teal-light) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-teal) / <alpha-value>)',
          dark: 'rgb(var(--c-teal-dark) / <alpha-value>)',
        },
        // Image-bay surface (specimen/product bays).
        display: {
          DEFAULT: 'rgb(var(--c-display) / <alpha-value>)',
          elevated: 'rgb(var(--c-display-elevated) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--c-text-tertiary) / <alpha-value>)',
        },
      },
      borderRadius: {
        card: '24px',
        module: 'var(--radius-module)',
        field: 'var(--radius-field)',
        procurement: 'var(--radius-procurement)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
      },
      fontFamily: {
        // serif/display/mono resolve through CSS vars so the font-stack flag
        // (html[data-fontstack]) flips them without touching markup. The vars
        // carry their own fallbacks; default (:root) = Cormorant / Plex.
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-display)', 'Georgia', 'serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
