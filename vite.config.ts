import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      // Proxy /api/v1 requests to backend (no rewrite — backend prefix is /api/v1)
      '/api/v1': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
      // Proxy /api/health to backend /health (strip /api prefix)
      '/api/health': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
