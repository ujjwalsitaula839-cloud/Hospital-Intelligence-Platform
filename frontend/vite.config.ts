import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
const Backend_URL = 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: Backend_URL,
        changeOrigin: true,
      },
      '/auth': {
        target: Backend_URL,
        changeOrigin: true,
      },
      '/patients': {
        target: Backend_URL,
        changeOrigin: true,
      },
      '/beds': {
        target: Backend_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: Backend_URL,
        changeOrigin: true,
        ws: true,
      }
    }  
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  }
})
