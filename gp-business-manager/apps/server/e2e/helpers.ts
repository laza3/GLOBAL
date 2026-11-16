import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const SETUP_CODE = 'E2ECODE1';
export async function startServer(port: number) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-web-e2e-'));
  const proc: ChildProcess = spawn('node', ['dist/server.cjs'], { cwd: resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GP_DATA_DIR: dir, GP_SETUP_CODE: SETUP_CODE }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url + '/api/health')).ok) break; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { url, dir, stop: () => { try { proc.kill('SIGKILL'); } catch { /* arrêté */ } } };
}

export async function shot(page: Page, name: string) {
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/${name}.png` });
}

export async function setupCompany(page: Page, name = 'Boutique Web') {
  await page.waitForSelector('text=Bienvenue');
  await page.getByLabel('Nom de l’entreprise').fill(name);
  await page.getByLabel('Nom affiché').fill('Gérant');
  await page.getByLabel('Mot de passe').fill('Admin#2026');
  await page.getByLabel('Confirmation').fill('Admin#2026');
  await page.getByLabel('Code d’installation').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
}
