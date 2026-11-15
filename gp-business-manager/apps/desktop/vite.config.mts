import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwind()],
  build: { outDir: resolve(__dirname, 'dist/renderer'), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
  server: { port: 5173, strictPort: true },
});
