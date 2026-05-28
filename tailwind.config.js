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
