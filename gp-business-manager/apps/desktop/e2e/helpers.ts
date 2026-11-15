import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launch(dir = mkdtempSync(join(tmpdir(), 'gp-e2e-'))) {
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${dir}`], env: { ...process.env, GP_DB_PATH: join(dir, 'e2e.db'), ELECTRON_DISABLE_SECURITY_WARNINGS: '1', GP_FORCE_PROD: '1' } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.show(); });
  return { app, page, dir };
}

/** Capture via le processus principal (fiable sous Xvfb). */
export async function shot(app: ElectronApplication, name: string) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/${name}.png`, Buffer.from(b64, 'base64'));
}
export async function quit(app: ElectronApplication) {
  const proc = app.process();
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  try { proc.kill('SIGKILL'); } catch { /* déjà arrêté */ }
}

import type { Page } from '@playwright/test';
export async function setupCompany(page: Page, name = 'Boutique Test') {
  await page.waitForSelector('text=Bienvenue');
  await page.getByLabel('Nom de l’entreprise').fill(name);
  await page.getByLabel('Nom affiché').fill('Admin');
  await page.getByLabel('Mot de passe').fill('Admin#2026');
  await page.getByLabel('Confirmation').fill('Admin#2026');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
}
