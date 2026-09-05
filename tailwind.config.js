/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0a0805',
          800: '#12100a',
          700: '#1a1710',
          600: '#241f15',
          500: '#332b1d',
        },
        brand: {
          400: '#f3d68b',
          500: '#e2b53f',
          600: '#c9971f',
        },
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        pulseline: { '0%,100%': { opacity: '0.4' }, '50%': { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        pulseline: 'pulseline 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
