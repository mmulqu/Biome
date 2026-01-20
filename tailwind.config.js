/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        biome: {
          primary: '#73AC13',
          dark: '#0a0a0f',
          card: '#111118',
        }
      },
      fontFamily: {
        display: ['system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
