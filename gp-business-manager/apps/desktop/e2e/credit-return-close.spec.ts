import { expect, test } from '@playwright/test';
import { launch, quit, setupCompany, shot } from './helpers';

test('vente à crédit partielle → retour → clôture de caisse avec écart → dépense (via l’interface)', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  try {
    await setupCompany(page);

    // produit
    await page.getByRole('link', { name: 'Produits' }).click();
    await page.getByRole('button', { name: 'Nouveau produit' }).click();
    await page.getByLabel('Nom du produit').fill('Savon');
    await page.getByLabel('Prix d’achat').fill('600');
    await page.getByLabel(/Prix de vente/).fill('1000');
    await page.getByLabel('Stock initial').fill('50');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Savon').first()).toBeVisible();

    // client avec plafond de crédit
    await page.getByRole('link', { name: 'Clients' }).click();
    await page.getByRole('button', { name: 'Nouveau client' }).click();
    await page.getByLabel('Nom / Raison sociale').fill('Mme Rasoa');
    await page.getByLabel('Plafond de crédit').fill('100000');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Mme Rasoa')).toBeVisible();

    // ouverture de caisse (fond 10 000) puis vente de 5 × Savon à Mme Rasoa, 2 000 payés
    await page.getByRole('link', { name: 'Sessions de caisse' }).click();
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await page.getByLabel('Fond de caisse (espèces comptées)').fill('10000');
    await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await expect(page.getByText('Espèces attendues en caisse')).toBeVisible();

    await page.getByRole('link', { name: 'Caisse (POS)' }).click();
    await page.getByPlaceholder(/Scanner un code-barres/).fill('Savon');
    await page.getByRole('button', { name: /^Savon/ }).first().click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('input[inputmode=decimal]').last()).toHaveValue('5');
    await page.getByRole('button', { name: /Client comptoir/ }).click();
    await page.getByPlaceholder('Nom ou téléphone…').fill('Rasoa');
    await page.getByRole('button', { name: /Mme Rasoa/ }).click();
    await page.getByRole('button', { name: /Encaisser/ }).click();
    await page.getByRole('button', { name: 'Espèces' }).click();
    await page.locator('input[inputmode=decimal]').last().fill('2000');
    await expect(page.getByText('Reste à crédit').first()).toBeVisible();
    await shot(app, '13-pos-credit');
    await page.getByRole('button', { name: 'Valider (reste à crédit)' }).click();
    await expect(page.getByText('Vente enregistrée')).toBeVisible();
    await page.getByRole('button', { name: /Nouvelle vente/ }).click();

    // retour d'1 article depuis l'historique
    await page.getByRole('link', { name: 'Historique des ventes' }).click();
    await page.getByText(/TK-\d{4}-000001/).click();
    await page.getByRole('button', { name: 'Retour / remboursement' }).click();
    await page.getByPlaceholder(/0 – 5/).fill('1');
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Espèces' }) }).selectOption({ label: 'Espèces' });
    await shot(app, '14-return');
    await page.getByRole('button', { name: 'Valider le retour' }).click();
    await expect(page.getByText(/Retour enregistré/)).toBeVisible();
    await page.keyboard.press('Escape');

    // le solde client : 5 000 − 1 000 (retour) − 2 000 (payé) = 2 000
    await page.getByRole('link', { name: 'Clients' }).click();
    await expect(page.getByText(/Doit\s+2\s?000\s?Ar/).first()).toBeVisible();

    // clôture avec écart : attendu 10 000 + 2 000 = 12 000, compté 11 000 → commentaire exigé
    await page.getByRole('link', { name: 'Sessions de caisse' }).click();
    await expect(page.getByText(/12\s?000\s?Ar/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Clôturer' }).click();
    await page.getByLabel('Espèces comptées').fill('11000');
    await expect(page.getByText(/Écart/).first()).toBeVisible();
    await page.getByLabel(/Commentaire/).fill('Rendu erroné');
    await shot(app, '15-close');
    await page.getByRole('button', { name: 'Clôturer la caisse' }).click();
    await expect(page.getByText('Clôturée').first()).toBeVisible();

    // dépense depuis la finance (compte espèces)
    await page.getByRole('link', { name: 'Finances' }).click();
    await page.getByRole('tab', { name: 'Dépenses' }).click();
    await page.getByRole('button', { name: 'Nouvelle dépense' }).click();
    await page.getByLabel('Libellé').fill('Électricité');
    await page.getByLabel('Montant').fill('500');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('td', { hasText: 'Électricité' }).first()).toBeVisible();
    await shot(app, '16-expenses');

    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    await quit(app);
  }
});
