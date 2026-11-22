import { bundle } from '@remotion/bundler'; import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path'; import fs from 'node:fs';
const frames = process.argv.slice(2).map(Number);
const chrome = '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const comp = await selectComposition({ serveUrl, id: 'Presentation', browserExecutable: chrome });
console.log('durée', comp.durationInFrames, 'images =', (comp.durationInFrames / comp.fps).toFixed(1), 's');
fs.mkdirSync('out/stills', { recursive: true });
for (const f of frames) { await renderStill({ composition: comp, serveUrl, frame: f, output: `out/stills/f${String(f).padStart(5, '0')}.jpg`, imageFormat: 'jpeg', jpegQuality: 85, browserExecutable: chrome }); console.log('ok', f); }
