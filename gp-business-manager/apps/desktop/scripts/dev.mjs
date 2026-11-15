// Développement : serveur Vite (HMR du renderer) + build esbuild du processus principal + Electron.
import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs'), 'main'], { cwd: root, stdio: 'inherit' });
const server = await createServer({ configFile: resolve(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, ['.', '--no-sandbox'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', () => { server.close(); process.exit(0); });
