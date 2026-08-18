import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Version metadata injected at build time — every deploy refreshes it
// automatically (no manual bumps). Version = 1.5.<commit count> (continuing
// the old hardcoded v1.5.x line), date = HEAD commit date. Requires .git in
// the build context (the Dockerfile copies it into the frontend-build stage).
function gitInfo() {
  try {
    const count = execSync('git rev-list --count HEAD').toString().trim();
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const date = execSync('git log -1 --format=%cI').toString().trim();
    return { version: `1.5.${count}`, sha, date };
  } catch {
    return { version: 'dev', sha: '', date: new Date().toISOString() };
  }
}
const GIT = gitInfo();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(GIT.version),
    __APP_COMMIT__: JSON.stringify(GIT.sha),
    __APP_UPDATED_AT__: JSON.stringify(GIT.date),
  },
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
