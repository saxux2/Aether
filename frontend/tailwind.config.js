/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic theme tokens — resolve to CSS vars that flip with .dark
        page:     'rgb(var(--color-page) / <alpha-value>)',
        panel:    'rgb(var(--color-panel) / <alpha-value>)',
        elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
        hairline: 'rgb(var(--color-hairline) / <alpha-value>)',
        fg:       'rgb(var(--color-fg) / <alpha-value>)',
        accent:   'rgb(var(--color-accent) / <alpha-value>)',
        up:       'rgb(var(--color-up) / <alpha-value>)',
        down:     'rgb(var(--color-down) / <alpha-value>)',
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#3b5bdb',
          600: '#2f4ac3',
          700: '#2340a8',
        },
        // Bybit-style market accents
        market: {
          up:   '#20b26c',
          down: '#ef454a',
        },
        // Terminal surfaces — page → panel → elevated → hairline → input border
        ink: {
          950: '#05070b',
          900: '#0a0d14',
          850: '#0e1119',
          800: '#131722',
          700: '#1a2030',
          600: '#252c40',
          500: '#39415a',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        pixel: ['"Courier Prime"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
