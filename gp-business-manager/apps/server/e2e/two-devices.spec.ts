import { devices, expect, test, type Page } from '@playwright/test';
import { setupCompany, shot, startServer } from './helpers';

const gp = (page: Page, method: string, params?: unknown) =>
  page.evaluate(async ([m, p]) => { const r = await (window as any).gp.call(m, p); if (!r.ok) throw new Error(r.error.message); return r.data; }, [method, params] as const);

test('le gérant (ordinateur) et la vendeuse (téléphone) travaillent sur les mêmes données', async ({ browser }) => {
  const srv = await startServer(4312);
  const problems: string[] = [];
  try {
    // ---------- gérant sur ordinateur ----------
    const pcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pc = await pcCtx.newPage();
    pc.on('pageerror', (e) => problems.push(String(e)));
    await pc.goto(srv.url);
    await setupCompany(pc, 'Vêtements Mada');
    await shot(pc, 'x1-pc-dashboard');

    // produit + compte vendeuse préparés par le gérant (API : les écrans sont couverts ailleurs)
    await gp(pc, 'products.save', { name: 'Robe wax', variants: [{ costPrice: 20000, price: 45000, barcodes: ['111222333'], openingQtyMilli: 10000 }] });
    const roles = await gp(pc, 'roles.list');
    await gp(pc, 'users.create', { username: 'fara', displayName: 'Fara', password: 'Temporaire#1', roleId: roles.find((r: any) => r.code === 'CASHIER').id });

    // ---------- vendeuse sur téléphone ----------
    const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
    const ph = await phoneCtx.newPage();
    ph.on('pageerror', (e) => problems.push(String(e)));
    await ph.goto(srv.url);
    await ph.getByLabel('Identifiant').fill('fara');
    await ph.getByLabel('Mot de passe').fill('Temporaire#1');
    await ph.getByRole('button', { name: 'Se connecter' }).click();
    // mot de passe temporaire : changement obligatoire
    await expect(ph.getByText('Choisissez votre mot de passe')).toBeVisible();
    await shot(ph, 'x2-phone-forced-password');
    await ph.locator('[role=dialog] input[type=password]').nth(0).fill('Temporaire#1');
    await ph.locator('[role=dialog] input[type=password]').nth(1).fill('MonSecret#2026');
    await ph.locator('[role=dialog] input[type=password]').nth(2).fill('MonSecret#2026');
    await ph.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(ph.getByText('Choisissez votre mot de passe')).toBeHidden();

    await ph.goto(`${srv.url}/#/pos`);
    await ph.getByRole('button', { name: 'Ouvrir la caisse' }).first().click();
    await ph.getByLabel('Fond de caisse (espèces comptées)').fill('5000');
    await shot(ph, 'x3-phone-open-cash');
    await ph.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    const search = ph.getByPlaceholder(/Scanner un code-barres/);
    await search.fill('Robe');
    await ph.waitForTimeout(1200);
    await shot(ph, 'x3b-phone-search');
    await ph.getByRole('button', { name: /Robe wax/ }).first().click();
    await shot(ph, 'x4-phone-pos-cart');
    await ph.getByRole('button', { name: /Encaisser/ }).click();
    await ph.getByRole('button', { name: 'Espèces' }).click();
    await ph.locator('input[inputmode=decimal]').last().fill('50000');
    await shot(ph, 'x5-phone-payment');
    await ph.getByRole('button', { name: 'Valider la vente' }).click();
    await expect(ph.getByText('Vente enregistrée')).toBeVisible();
    await shot(ph, 'x6-phone-done');

    // la vendeuse n'a pas accès à l'administration
    await ph.goto(`${srv.url}/#/admin`);
    await expect(ph.getByRole('heading', { name: 'Administration' })).toBeHidden();

    // ---------- le gérant voit la vente depuis son ordinateur ----------
    // l'écran du gérant (resté sur le tableau de bord, sans rien toucher) se met à jour tout seul
    await expect(pc.getByText(/45\s?000\s?Ar/).first()).toBeVisible({ timeout: 35_000 });
    await pc.goto(`${srv.url}/#/sales`);
    await expect(pc.getByText('TK-2026-000001').or(pc.getByText(/TK-\d{4}-\d{6}/)).first()).toBeVisible();
    await shot(pc, 'x7-pc-sees-sale');
    // et le stock est descendu à 9
    const stock = await gp(pc, 'stock.levels', {});
    expect(JSON.stringify(stock)).toContain('9000');

    // ---------- le gérant sur son téléphone : aucune page ne déborde de l'écran ----------
    const mgCtx = await browser.newContext({ ...devices['Pixel 7'] });
    const mg = await mgCtx.newPage();
    mg.on('pageerror', (e) => problems.push(String(e)));
    await mg.goto(srv.url);
    await mg.getByLabel('Identifiant').fill('admin');
    await mg.getByLabel('Mot de passe').fill('Admin#2026');
    await mg.getByRole('button', { name: 'Se connecter' }).click();
    await mg.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    const overflow: string[] = [];
    for (const path of ['/', '/pos', '/sales', '/cash', '/customers', '/products', '/stock', '/purchasing', '/finance', '/reports', '/admin', '/settings']) {
      await mg.goto(`${srv.url}/#${path}`);
      await mg.waitForTimeout(600);
      const over = await mg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) overflow.push(`${path} (+${over}px)`);
      await shot(mg, 'y-phone' + (path === '/' ? '-home' : path.replace('/', '-')));
    }
    expect(overflow).toEqual([]);
    await mgCtx.close();

    expect(problems).toEqual([]);
    await pcCtx.close(); await phoneCtx.close();
  } finally { srv.stop(); }
});
