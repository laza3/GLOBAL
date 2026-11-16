import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { rmSync, readFileSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];
if (!only) rmSync(resolve(root, 'dist'), { recursive: true, force: true });
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

if (!only || only === 'server') {
  await esbuild({
    entryPoints: ['src/main.ts'], outfile: 'dist/server.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { __GP_VERSION__: JSON.stringify(version), 'import.meta.dirname': '__dirname' }, logLevel: 'info', absWorkingDir: root,
    banner: { js: '' },
  });
}
if (!only || only === 'web') await vite({ configFile: resolve(root, 'vite.web.config.mts'), logLevel: 'warn' });
console.log('✔ build serveur terminé');
