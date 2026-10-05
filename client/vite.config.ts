import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    // During development the API runs separately on 8080.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
});
