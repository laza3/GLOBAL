// Génère build/icon.png (512×512) depuis le logo SVG via Chromium (Playwright).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecd48f"/><stop offset="1" stop-color="#c08f26"/></linearGradient></defs>
<rect width="48" height="48" rx="11" fill="#0f1630"/><rect x="1.2" y="1.2" width="45.6" height="45.6" rx="10" fill="none" stroke="url(#g)" stroke-opacity=".55"/>
<path d="M31 17.2A10.5 10.5 0 1 0 31 30.8M24.5 24H32v7" fill="none" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
mkdirSync('build', { recursive: true });
await p.screenshot({ path: 'build/icon.png', omitBackground: true });
await b.close();
console.log('✔ build/icon.png');
