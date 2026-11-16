import { devices, expect, test } from '@playwright/test';
import { startServer } from './helpers';

test('site installable : manifeste, icônes, service worker, aucun appel de données en cache', async ({ browser }) => {
  const srv = await startServer(4313);
  try {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await page.goto(srv.url);
    const manifest = await (await page.request.get(srv.url + '/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    for (const i of manifest.icons) expect((await page.request.get(srv.url + i.src)).status()).toBe(200);
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true));
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    expect(reg).toBe(true);
    // le SW ne met pas /api en cache
    const keys = await page.evaluate(async () => { const out: string[] = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname); return out; });
    expect(keys.some((k) => k.startsWith('/api'))).toBe(false);
    await ctx.close();
  } finally { srv.stop(); }
});
