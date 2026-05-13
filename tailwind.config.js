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
        olive: { light: '#7A8B4A', DEFAULT: '#5D6B35', dark: '#3D4A2E', muted: '#2E3A22' },
        purple: { accent: '#A78BFA' },
        text: { primary: '#fff', secondary: '#b3b3b3', tertiary: '#666' },
      },
      borderRadius: {
        card: '24px',
        'card-inner': '16px',
        'card-sm': '12px',
      },
      backgroundImage: {
        'gradient-gold': 'linear-gradient(135deg, #D4B896 0%, #C4A35A 50%, #8B7355 100%)',
      },
      backdropBlur: {
        glass: '16px',
        'glass-heavy': '24px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
