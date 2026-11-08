import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      // Voice dictation WebSocket -> the speech container (docker compose).
      '/speech': {
        target: 'http://localhost:9100',
        ws: true,
        rewrite: (path) => path.replace(/^\/speech/, ''),
      },
    },
  },
})
