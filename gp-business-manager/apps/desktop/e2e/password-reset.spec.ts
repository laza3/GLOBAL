import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, quit, setupCompany } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

test('mot de passe oublié : récupération en ligne de commande puis connexion avec le nouveau mot de passe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-reset-'));
  // 1. création de l'entreprise (mot de passe Admin#2026), puis fermeture
  let { app, page } = await launch(dir);
  await setupCompany(page, 'Boutique Oubli');
  await quit(app);

  // 2. récupération par la ligne de commande (application fermée)
  const env = { ...process.env, GP_DB_PATH: join(dir, 'e2e.db'), GP_NO_DIALOG: '1', GP_FORCE_PROD: '1' };
  const bad = spawnSync(electronPath, ['.', '--no-sandbox', `--user-data-dir=${dir}`, '--reset-password=court'], { env, encoding: 'utf8', timeout: 60_000 });
  expect(bad.stdout + bad.stderr).toContain('Impossible de réinitialiser');
  const ok = spawnSync(electronPath, ['.', '--no-sandbox', `--user-data-dir=${dir}`, '--reset-password=NouveauMdp#1'], { env, encoding: 'utf8', timeout: 60_000 });
  expect(ok.stdout + ok.stderr).toContain('Mot de passe réinitialisé pour « admin »');

  // 3. l'ancien mot de passe est refusé, le nouveau fonctionne, les données sont conservées
  ({ app, page } = await launch(dir));
  try {
    await page.getByLabel('Identifiant').fill('admin');
    await page.getByLabel('Mot de passe', { exact: true }).fill('Admin#2026');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Identifiant ou mot de passe incorrect')).toBeVisible();
    await page.getByLabel('Mot de passe', { exact: true }).fill('NouveauMdp#1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
    await expect(page.getByText('Boutique Oubli').first()).toBeVisible();
  } finally { await quit(app); }
});
