import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@giveaway': path.resolve(__dirname, './src/features/giveaway'),
      '@status': path.resolve(__dirname, './src/features/status'),
    },
  },
  server: {
    port: 5173,
    // El backend corre en 3000; así en desarrollo no hace falta CORS ni
    // configurar la URL a mano.
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
})
