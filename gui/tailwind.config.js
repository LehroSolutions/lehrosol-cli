/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        hud: {
          bg: '#05070a',
          panel: 'rgba(15, 23, 32, 0.72)',
          border: 'rgba(0, 229, 255, 0.25)',
          cyan: '#22d3ee',
          green: '#34d399',
          amber: '#fbbf24',
          red: '#f87171'
        }
      },
      boxShadow: {
        glass: '0 0 24px rgba(34, 211, 238, 0.15)'
      }
    }
  },
  plugins: []
};
