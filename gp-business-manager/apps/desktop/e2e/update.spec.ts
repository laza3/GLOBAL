import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { quit, setupCompany } from './helpers';

/** Faux serveur de publication : latest-linux.yml annonçant `version`. */
function feed(version: string) {
  const yml = `version: ${version}\nfiles:\n  - url: GP-${version}.AppImage\n    sha512: ${'A'.repeat(86)}==\n    size: 1000\npath: GP-${version}.AppImage\nsha512: ${'A'.repeat(86)}==\nreleaseDate: '2026-11-16T00:00:00.000Z'\n`;
  const srv = createServer((req, res) => { if ((req.url ?? '').includes('latest')) { res.writeHead(200, { 'content-type': 'text/yaml' }); res.end(yml); } else { res.writeHead(404); res.end(); } });
  return new Promise<{ url: string; close: () => void }>((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as any).port}`, close: () => srv.close() })));
}

async function openApp(url: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-upd-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${dir}`], env: { ...process.env, GP_DB_PATH: join(dir, 'u.db'), GP_FORCE_PROD: '1', GP_UPDATE_URL: url } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.show(); });
  return { app, page };
}

test('mise à jour : une version plus récente est détectée et annoncée (pastille + carte)', async () => {
  const f = await feed('9.9.9');
  const { app, page } = await openApp(f.url);
  try {
    await setupCompany(page);
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('tab', { name: 'Sauvegardes' }).click();
    await expect(page.getByText('Version installée')).toBeVisible();
    await page.getByRole('button', { name: 'Rechercher les mises à jour' }).click();
    await expect(page.getByText('Version 9.9.9 disponible.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Version 9\.9\.9 disponible/ })).toBeVisible(); // pastille de l'en-tête
    await expect(page.getByRole('button', { name: 'Télécharger' })).toBeVisible();
  } finally { await quit(app); f.close(); }
});

test('mise à jour : aucune pastille quand la version installée est déjà la plus récente', async () => {
  const f = await feed('0.0.1');
  const { app, page } = await openApp(f.url);
  try {
    await setupCompany(page);
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('tab', { name: 'Sauvegardes' }).click();
    await page.getByRole('button', { name: 'Rechercher les mises à jour' }).click();
    await expect(page.getByText('Vous utilisez la dernière version.')).toBeVisible();
    await expect(page.getByRole('button', { name: /disponible/ })).toHaveCount(0);
  } finally { await quit(app); f.close(); }
});
