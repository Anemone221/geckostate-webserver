import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All /api requests are forwarded to the backend in development.
      // This avoids CORS issues — the browser sees everything on port 5173.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Production build lands in backend/public/ so the Express server can serve it.
    // Run: cd frontend && npm run build
    // Then the backend at port 3000 serves both the API and the React app.
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
