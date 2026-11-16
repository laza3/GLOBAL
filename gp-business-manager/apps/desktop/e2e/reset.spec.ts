import { expect, test } from '@playwright/test';
import { launch, quit, setupCompany, shot } from './helpers';

test('réinitialisation des données (comptes conservés) puis suppression d’un compte, via l’interface', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  const call = (m: string, p?: unknown) => page.evaluate(([m, p]) => (window as any).gp.call(m, p).then((r: any) => { if (!r.ok) throw new Error(r.error.message); return r.data; }), [m, p] as const);
  try {
    await setupCompany(page, 'Boutique à vider');
    await call('products.save', { name: 'Produit test', variants: [{ costPrice: 100, price: 200 }] });
    const roles = await call('roles.list');
    await call('users.create', { username: 'stagiaire', displayName: 'Stagiaire', password: 'Temp0raire!', roleId: roles.find((r: any) => r.code === 'CASHIER').id });
    expect((await call('products.list', {})).total).toBe(1);

    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('tab', { name: 'Réinitialisation' }).click();
    await expect(page.getByText('Conservés :').first()).toBeVisible();
    await shot(app, '20-reset-tab');
    await page.getByRole('button', { name: 'Réinitialiser les données…' }).click();
    await expect(page.getByText('Attention : effacement des données')).toBeVisible();
    await shot(app, '21-reset-step1');
    await page.getByRole('button', { name: 'Je comprends, continuer' }).click();

    const erase = page.getByRole('button', { name: 'Effacer définitivement' });
    await expect(erase).toBeDisabled();
    await page.getByLabel(/Recopiez/).fill('tout effacer');
    await expect(erase).toBeDisabled();
    // mauvais mot de passe : refusé, rien n'est effacé
    await page.getByLabel('Votre mot de passe d’administrateur').fill('mauvais-mot-de-passe');
    await shot(app, '22-reset-step2');
    await erase.click();
    await expect(page.getByText('Mot de passe incorrect.')).toBeVisible();
    expect((await call('products.list', {})).total).toBe(1);

    // bon mot de passe : le contenu est effacé, MAIS les comptes et les paramètres sont conservés et on reste connecté
    await page.getByLabel('Votre mot de passe d’administrateur').fill('Admin#2026');
    await erase.click();
    await expect(page.getByText('Données réinitialisées')).toBeVisible();
    expect((await call('products.list', {})).total).toBe(0);
    expect((await call('company.get')).name).toBe('Boutique à vider');
    expect((await call('users.list')).map((u: any) => u.username).sort()).toEqual(['admin', 'stagiaire']);
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible(); // toujours connecté

    // suppression d'un compte depuis l'écran des comptes
    await page.getByRole('tab', { name: 'Comptes utilisateurs' }).click();
    await page.getByText('Stagiaire').first().click();
    await page.getByRole('button', { name: 'Supprimer le compte' }).click();
    await shot(app, '23-delete-user');
    await page.getByRole('button', { name: 'Supprimer le compte' }).last().click();
    await expect(page.getByText('Compte supprimé.')).toBeVisible();
    expect((await call('users.list')).map((u: any) => u.username)).toEqual(['admin']);
    // on ne peut pas supprimer son propre compte : pas de bouton sur sa fiche
    await page.getByText('@admin').first().click();
    await expect(page.getByRole('button', { name: 'Supprimer le compte' })).toHaveCount(0);

    expect(problems, problems.join('\n')).toEqual([]);
  } finally { await quit(app); }
});
