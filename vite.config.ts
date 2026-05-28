import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// UI lives in web/, builds into server/public so the collector serves it
// same-origin in production (no CORS / mixed-content issues).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
