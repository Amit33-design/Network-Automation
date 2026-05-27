import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': '/src',
    },
  },

  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },

  // Optional: Increase chunk size warning limit
  build: {
    chunkSizeWarningLimit: 1000,
  },
})
