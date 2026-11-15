import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];
if (!only) rmSync(resolve(root, 'dist'), { recursive: true, force: true });

const common = { platform: 'node', bundle: true, format: 'cjs', target: 'node24', sourcemap: process.env.GP_SOURCEMAP === '1', external: ['electron'], logLevel: 'info', absWorkingDir: root };
if (!only || only === 'main') {
  await esbuild({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
  await esbuild({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' });
}
if (!only || only === 'renderer') await vite({ configFile: resolve(root, 'vite.config.mts'), logLevel: 'warn' });
console.log('✔ build terminé');
