import { expect, test } from '@playwright/test';
import { launch, quit, shot } from './helpers';

test('parcours complet : configuration → produit → ouverture de caisse → vente → tableau de bord', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  try {
    // 1. première configuration
    await page.waitForSelector('text=Bienvenue');
    await page.getByLabel('Nom de l’entreprise').fill('Boutique Rakoto');
    await page.getByLabel('Nom affiché').fill('Rakoto Admin');
    await page.getByLabel('Mot de passe').fill('Admin#2026');
    await page.getByLabel('Confirmation').fill('Admin#2026');
    await page.getByRole('button', { name: 'Créer mon espace' }).click();
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

    // 2. création d'un produit via l'interface
    await page.getByRole('link', { name: 'Produits' }).click();
    await page.getByRole('button', { name: 'Nouveau produit' }).click();
    await page.getByLabel('Nom du produit').fill('Riz parfumé 5kg');
    await page.getByLabel('Prix d’achat').fill('18000');
    await page.getByLabel(/Prix de vente/).fill('25000');
    await page.getByLabel('Codes-barres').fill('3760123456789');
    await page.getByLabel('Stock initial').fill('20');
    await shot(app, '03-product-form');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Riz parfumé 5kg')).toBeVisible();
    await shot(app, '04-products');

    // 3. caisse : ouverture, ajout par code-barres, encaissement espèces
    await page.getByRole('link', { name: 'Caisse (POS)' }).click();
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).first().click();
    await page.getByLabel('Fond de caisse (espèces comptées)').fill('10000');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    const search = page.getByPlaceholder(/Scanner un code-barres/);
    await search.fill('3760123456789');
    await search.press('Enter');
    await expect(page.getByText('Riz parfumé 5kg').first()).toBeVisible();
    await search.fill('3760123456789');
    await search.press('Enter'); // 2e scan => quantité 2
    await expect(page.locator('input[inputmode=decimal]').last()).toHaveValue('2');
    await shot(app, '05-pos-cart');
    await page.getByRole('button', { name: /Encaisser/ }).click();
    await page.getByRole('button', { name: 'Espèces' }).click();
    await page.locator('input[inputmode=decimal]').last().fill('60000');
    await shot(app, '06-pos-payment');
    await expect(page.getByText('Rendu monnaie').first()).toBeVisible();
    await page.getByRole('button', { name: 'Valider la vente' }).click();
    await expect(page.getByText('Vente enregistrée')).toBeVisible();
    await expect(page.getByText(/10\s?000\s?Ar/).first()).toBeVisible(); // rendu : 60 000 − 50 000
    await shot(app, '07-pos-done');
    await page.getByRole('button', { name: /Nouvelle vente/ }).click();

    // 4. le tableau de bord reflète la vente réelle
    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page.getByText(/50\s?000\s?Ar/).first()).toBeVisible();
    await page.waitForTimeout(900);
    await shot(app, '08-dashboard');

    // 5. historique des ventes + stock mis à jour (18 restants)
    await page.getByRole('link', { name: 'Historique des ventes' }).click();
    await expect(page.getByText(/TK-\d{4}-000001/)).toBeVisible();
    await page.getByRole('link', { name: 'Stocks' }).click();
    await expect(page.getByText('18', { exact: false }).first()).toBeVisible();
    await shot(app, '09-stock');
    // la CSP stricte de production ne doit bloquer aucune ressource et aucune erreur JS ne doit survenir
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await quit(app);
  }
});
