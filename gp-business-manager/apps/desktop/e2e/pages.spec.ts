import { expect, test } from '@playwright/test';
import { launch, quit, shot } from './helpers';

test('tous les écrans se chargent sans erreur ; thème sombre ; anglais ; permissions de menu', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  try {
    await page.waitForSelector('text=Bienvenue');
    await page.getByLabel('Nom de l’entreprise').fill('Épicerie Test');
    await page.getByLabel('Nom affiché').fill('Admin');
    await page.getByLabel('Mot de passe').fill('Admin#2026');
    await page.getByLabel('Confirmation').fill('Admin#2026');
    await page.getByRole('button', { name: 'Créer mon espace' }).click();
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

    const routes: [string, string][] = [
      ['Caisse (POS)', 'Ouvrir la caisse'], ['Historique des ventes', 'Historique des ventes'], ['Sessions de caisse', 'Sessions de caisse'], ['Clients', 'Clients'],
      ['Produits', 'Produits'], ['Stocks', 'Stocks'], ['Achats & fournisseurs', 'Achats & fournisseurs'], ['Finances', 'Finances'], ['Rapports', 'Rapports'], ['Administration', 'Administration'], ['Paramètres', 'Paramètres'],
    ];
    for (const [link, marker] of routes) {
      await page.getByRole('link', { name: link }).click();
      await expect(page.getByText(marker).first()).toBeVisible();
      await page.waitForTimeout(250);
    }
    // sous-onglets
    await page.getByRole('link', { name: 'Stocks' }).click();
    for (const tab of ['Mouvements', 'Transferts', 'Inventaires', 'Péremptions', 'Niveaux de stock']) await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('link', { name: 'Finances' }).click();
    for (const tab of ['Écritures', 'Dépenses', 'Créances clients', 'Comptes & flux']) await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('link', { name: 'Achats & fournisseurs' }).click();
    for (const tab of ['Fournisseurs', 'Dettes & échéances', 'Bons de commande']) await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('link', { name: 'Administration' }).click();
    for (const tab of ['Rôles & permissions', 'Organisation', 'Journal d’activité', 'Sauvegardes', 'Utilisateurs']) await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('link', { name: 'Paramètres' }).click();
    for (const tab of ['Paramètres commerciaux', 'Modes de paiement', 'Taxes', 'Numérotation', 'Tickets & caisse', 'Entreprise']) await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('link', { name: 'Rapports' }).click();
    await page.waitForTimeout(400);
    await shot(app, '10-reports');

    // thème sombre + anglais
    await page.getByRole('button', { name: 'Changer le thème' }).click();
    await page.getByLabel('Langue').selectOption('en');
    await expect(page.getByRole('link', { name: 'Sales history' })).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await page.waitForTimeout(900);
    await shot(app, '11-dashboard-dark-en');
    await page.getByRole('link', { name: 'Point of sale' }).click();
    await page.waitForTimeout(500);
    await shot(app, '12-pos-dark-en');
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await quit(app);
  }
});
