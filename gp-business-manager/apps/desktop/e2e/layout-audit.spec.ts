import { expect, test } from '@playwright/test';
import { launch, quit, setupCompany, shot } from './helpers';

/** Audit de mise en page : pour chaque écran / fenêtre, rien ne doit déborder de l'écran (ni en haut, ni en bas, ni sur les côtés). */
const SIZES: [number, number][] = [[1100, 640], [1366, 768]];

test('audit de mise en page : écrans et fenêtres à petite et moyenne taille', async () => {
  const { app, page } = await launch();
  const issues: string[] = [];
  const call = (m: string, p?: unknown) => page.evaluate(([m, p]) => (window as any).gp.call(m, p).then((r: any) => { if (!r.ok) throw new Error(r.error.message); return r.data; }), [m, p] as const);

  const audit = async (label: string) => {
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const out: string[] = [];
      const vw = innerWidth, vh = innerHeight;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page déborde horizontalement (${document.documentElement.scrollWidth} > ${vw})`);
      const main = document.querySelector('main') as HTMLElement | null;
      if (main && main.scrollWidth > main.clientWidth + 1) out.push(`zone principale déborde horizontalement (${main.scrollWidth} > ${main.clientWidth})`);
      const dlg = document.querySelector('[role=dialog] .relative.m-auto') as HTMLElement | null;
      if (dlg) {
        const b = dlg.getBoundingClientRect();
        if (b.top < 0 || b.left < 0 || b.bottom > vh + 1 || b.right > vw + 1) out.push(`fenêtre hors écran (top ${Math.round(b.top)}, bottom ${Math.round(b.bottom)}/${vh}, left ${Math.round(b.left)}, right ${Math.round(b.right)}/${vw})`);
        const body = dlg.children[1] as HTMLElement;
        if (body && body.scrollWidth > body.clientWidth + 1) out.push(`contenu de la fenêtre déborde horizontalement (${body.scrollWidth} > ${body.clientWidth})`);
        const ov = document.querySelector('[role=dialog] > div') as HTMLElement;
        const o = ov.getBoundingClientRect();
        if (o.width < vw - 1 || o.height < vh - 1) out.push('le fond de la fenêtre ne couvre pas tout l\'écran');
        // boutons du pied de fenêtre visibles
        const foot = dlg.lastElementChild as HTMLElement;
        if (foot && foot !== body && foot.getBoundingClientRect().bottom > vh + 1) out.push('pied de fenêtre (boutons) hors écran');
      }
      // éléments interactifs coupés à droite
      document.querySelectorAll('button, input, select').forEach((el) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width > 0 && b.right > vw + 1 && !(el.closest('.overflow-x-auto'))) out.push(`contrôle hors écran à droite : ${(el.textContent || (el as HTMLInputElement).placeholder || el.tagName).trim().slice(0, 30)}`);
      });
      return out;
    });
    for (const x of r) issues.push(`[${label}] ${x}`);
  };
  const openClose = async (label: string, open: () => Promise<void>) => {
    await open();
    await audit(label);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };

  try {
    await setupCompany(page);
    // données de test via l'API réelle
    const units = await call('ref.units'); const taxes = await call('ref.taxRates');
    await call('products.save', { name: 'Savon', unitId: units[0].id, variants: [{ costPrice: 600, price: 1000, openingQtyMilli: 20000, barcodes: ['123'] }, { name: 'Grand', size: 'L', color: 'Bleu', costPrice: 900, price: 1500 }] });
    await call('customers.save', { name: 'Mme Rasoa', creditLimit: 100000 });
    await call('suppliers.save', { name: 'Import SA' });
    void taxes;

    for (const [w, h] of SIZES) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
      await page.waitForTimeout(400);
      const S = `${w}x${h}`;
      const nav = async (name: string) => { await page.getByRole('link', { name, exact: true }).click(); await page.waitForTimeout(300); };

      for (const n of ['Tableau de bord', 'Caisse (POS)', 'Historique des ventes', 'Sessions de caisse', 'Clients', 'Produits', 'Stocks', 'Achats & fournisseurs', 'Finances', 'Rapports', 'Administration', 'Paramètres']) {
        await nav(n); await audit(`${S} écran « ${n} »`);
      }
      await nav('Produits');
      await openClose(`${S} produit : nouveau`, () => page.getByRole('button', { name: 'Nouveau produit' }).click());
      await openClose(`${S} produit : modifier`, () => page.getByText('Savon').first().click());
      await nav('Clients');
      await openClose(`${S} client : nouveau`, () => page.getByRole('button', { name: 'Nouveau client' }).click());
      await openClose(`${S} client : fiche`, () => page.getByText('Mme Rasoa').first().click());
      await nav('Stocks');
      await openClose(`${S} stock : entrée`, () => page.getByRole('button', { name: /^Entrée/ }).click());
      await openClose(`${S} stock : transfert`, () => page.getByRole('button', { name: 'Transfert', exact: true }).click());
      await page.getByRole('tab', { name: 'Inventaires' }).click();
      await openClose(`${S} inventaire : nouveau`, () => page.getByRole('button', { name: 'Nouvel inventaire' }).click());
      await nav('Achats & fournisseurs');
      await openClose(`${S} commande : nouvelle`, () => page.getByRole('button', { name: 'Nouvelle commande' }).click());
      await page.getByRole('tab', { name: 'Fournisseurs' }).click();
      await openClose(`${S} fournisseur : nouveau`, () => page.getByRole('button', { name: 'Nouveau fournisseur' }).click());
      await nav('Finances');
      await openClose(`${S} finance : virement`, () => page.getByRole('button', { name: 'Virement interne' }).click());
      await page.getByRole('tab', { name: 'Dépenses' }).click();
      await openClose(`${S} dépense : nouvelle`, () => page.getByRole('button', { name: 'Nouvelle dépense' }).click());
      await nav('Administration');
      await openClose(`${S} utilisateur : nouveau`, () => page.getByRole('button', { name: 'Nouvel utilisateur' }).click());
      await page.getByRole('tab', { name: 'Rôles & permissions' }).click();
      await openClose(`${S} rôle : nouveau`, () => page.getByRole('button', { name: 'Nouveau rôle' }).click());
      await nav('Sessions de caisse');
      const openBtn = page.getByRole('button', { name: 'Ouvrir la caisse' });
      if (await openBtn.count()) {
        await openBtn.click();
        await audit(`${S} ouverture de caisse`);
        await page.getByLabel('Fond de caisse (espèces comptées)').fill('1000');
        await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
      }
      await nav('Caisse (POS)');
      await page.getByPlaceholder(/Scanner/).fill('123'); await page.getByPlaceholder(/Scanner/).press('Enter');
      await expect(page.locator('input[inputmode=decimal]').last()).toHaveValue(/^[1-9]\d*$/);
      await audit(`${S} POS avec panier`);
      await page.getByRole('button', { name: /Encaisser/ }).click();
      await audit(`${S} POS encaissement`);
      await page.getByRole('button', { name: 'Espèces' }).click();
      await audit(`${S} POS encaissement + espèces`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Client comptoir/ }).click();
      await audit(`${S} POS choix client`);
      await page.keyboard.press('Escape');
      await shot(app, `audit-pos-${S}`);
    }
    console.log('AUDIT_ISSUES', JSON.stringify(issues, null, 1));
    expect(issues, issues.join('\n')).toEqual([]);
  } finally { await quit(app); }
});
