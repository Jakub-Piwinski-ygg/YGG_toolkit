import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  server: { port: 5173, open: false },
  // ffmpeg.wasm spawns an internal module Worker via new URL('./worker.js',
  // import.meta.url). Pre-bundling rewrites that URL and the worker fails to
  // start (load() hangs). Excluding them keeps the worker URL intact in dev.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] }
});
