import { expect, test } from '@playwright/test';
import { launch, quit, setupCompany, shot } from './helpers';

test('l’administrateur crée un compte vendeuse ; elle change son mot de passe et n’a accès qu’à son profil', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  try {
    await setupCompany(page, 'Vêtements Mada');

    // 1. l'administrateur crée une boutique
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('tab', { name: 'Organisation' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).first().click();
    await page.getByLabel('Nom').fill('Boutique Nord');
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    // 2. puis un compte pour une vendeuse de cette boutique
    await page.getByRole('tab', { name: 'Comptes utilisateurs' }).click();
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await expect(page.locator('[role=dialog] select').nth(0).locator('option', { hasText: 'Responsable des ventes' })).toHaveCount(1);
    await expect(page.locator('[role=dialog] select').nth(0).locator('option', { hasText: 'Gérant' })).toHaveCount(1);
    await page.getByLabel('Nom de la personne').fill('Vendeuse Nord');
    await page.getByLabel('Identifiant de connexion').fill('vend.nord');
    await page.locator('[role=dialog] select').nth(0).selectOption({ label: 'Vendeur / Vendeuse' });
    await expect(page.getByText('Vend en boutique')).toBeVisible();
    await page.locator('[role=dialog] select').nth(1).selectOption({ label: 'Boutique Nord' });
    await page.getByLabel('Mot de passe temporaire').fill('Temp0raire!');
    await shot(app, '17-create-account');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('row', { name: /Vendeuse Nord/ })).toContainText('Boutique Nord');
    await expect(page.getByRole('row', { name: /Vendeuse Nord/ })).toContainText('Mot de passe temporaire');

    // 3. déconnexion de l'administrateur, connexion de la vendeuse
    await page.locator('header .group > button').first().hover();
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await page.getByLabel('Identifiant').fill('vend.nord');
    await page.getByLabel('Mot de passe').fill('Temp0raire!');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // 4. changement de mot de passe obligatoire : impossible de fermer la fenêtre
    await expect(page.getByText('Choisissez votre mot de passe')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Choisissez votre mot de passe')).toBeVisible();
    await shot(app, '18-forced-password');
    await page.getByLabel('Mot de passe temporaire (reçu de l’administrateur)').fill('Temp0raire!');
    await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('MonVraiMdp#7');
    await page.getByLabel('Confirmer le nouveau mot de passe').fill('MonVraiMdp#7');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Choisissez votre mot de passe')).toHaveCount(0);

    // 5. elle n'a accès qu'à son profil : caisse oui, finances/administration/paramètres non
    await expect(page.getByRole('link', { name: 'Caisse (POS)' })).toBeVisible();
    for (const n of ['Finances', 'Administration', 'Paramètres', 'Tableau de bord', 'Rapports']) await expect(page.getByRole('link', { name: n, exact: true })).toHaveCount(0);
    await shot(app, '19-vendeuse-home');
    expect(problems, problems.join('\n')).toEqual([]);
  } finally { await quit(app); }
});
