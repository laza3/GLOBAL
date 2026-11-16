import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Le site web réutilise exactement l'interface de l'application Windows (apps/desktop/src/renderer)
const renderer = resolve(__dirname, '../desktop/src/renderer');
export default defineConfig({
  root: renderer,
  base: '/',
  plugins: [react(), tailwind()],
  build: { outDir: resolve(__dirname, 'dist/public'), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  resolve: { alias: { '@': renderer } },
});
