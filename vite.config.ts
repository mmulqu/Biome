import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Cloudflare Pages serves from root '/', GitHub Pages from '/Biome/'
  base: process.env.CLOUDFLARE_PAGES ? '/' : '/Biome/',
})
