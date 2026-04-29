import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // No base override — app is served at root '/' both in dev and production.
  server: {
    port: 5173,
    proxy: {
      // Forward all /api calls and the vessel PNG to the FastAPI server.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/bioreactormodel.png': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
