/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#08080c',
          800: '#0e0e14',
          700: '#15151f',
          600: '#1d1d29',
          500: '#2a2a3a',
        },
        brand: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
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
