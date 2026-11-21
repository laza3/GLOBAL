/* eslint-disable */
/**
 * Vérification visuelle et comportementale du design system (Playwright + axe-core).
 *
 * Usage : pnpm build && pnpm preview &  puis  pnpm check:visual
 * Variables : BASE_URL (défaut http://127.0.0.1:4173), SHOTS_DIR (défaut ./.shots)
 *
 * 1. Pour chaque thème (clair, sombre) × taille (375, 768, 1024, 1440) :
 *    capture pleine page, absence de défilement horizontal, erreurs console, audit axe-core (WCAG 2.1 A/AA).
 * 2. Comportements : thème mémorisé, palette ⌘K, validation du formulaire, tri/recherche du tableau, modales
 *    (Échap, restitution du focus), annulation avec « Annuler », menu replié, feuille « Plus » mobile,
 *    vue tableau des graphiques, mouvement réduit, focus clavier visible.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '.shots');
const AXE = require.resolve('axe-core/axe.min.js', { paths: [process.cwd()] });
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablette', width: 768, height: 1024 },
  { name: 'portable', width: 1024, height: 768 },
  { name: 'bureau', width: 1440, height: 900 },
];
const SECTIONS = ['intro-h', 'couleurs', 'typographie', 'formes', 'actions', 'formulaires', 'donnees', 'retours', 'superpositions', 'navigation'];

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const visible = (loc) => loc.locator('visible=true').first();
async function shows(loc, timeout = 3000) {
  try {
    await visible(loc).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function newPage(browser, { width, height, scheme, reducedMotion }) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    reducedMotion: reducedMotion || 'no-preference',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900); // laisse finir l'animation d'apparition des graphiques
  return { page, context, errors };
}

async function audit(browser) {
  console.log('\n=== 1. Rendu, débordement, console, accessibilité ===');
  for (const scheme of ['light', 'dark']) {
    for (const vp of VIEWPORTS) {
      const { page, context, errors } = await newPage(browser, { ...vp, scheme });
      const tag = `${scheme === 'light' ? 'clair' : 'sombre'}/${vp.name}`;
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      ok(theme === (scheme === 'light' ? 'light' : 'dark'), `${tag} : thème appliqué avant le rendu`, theme);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 0, `${tag} : aucun défilement horizontal`, overflow > 0 ? `${overflow}px de trop` : '');
      ok(errors.length === 0, `${tag} : aucune erreur console`, errors.slice(0, 2).join(' | '));

      await page.addScriptTag({ path: AXE });
      const result = await page.evaluate(async () =>
        // eslint-disable-next-line no-undef
        axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
      );
      const v = result.violations;
      ok(v.length === 0, `${tag} : axe-core WCAG 2.1 A/AA`, v.map((x) => `${x.id} ×${x.nodes.length} (${x.impact}) ${x.nodes[0]?.html?.slice(0, 140)}`).join(' ; '));
      const cc = result.incomplete.find((x) => x.id === 'color-contrast');
      if (cc) console.log(`      (info) ${cc.nodes.length} élément(s) de contraste non évaluables automatiquement (fond translucide) — couverts par check:contrast`);

      await page.screenshot({ path: path.join(SHOTS, `${scheme}-${vp.name}-page.png`), fullPage: true });
      if (vp.name === 'bureau' || vp.name === 'mobile') {
        for (const id of SECTIONS) {
          const el = page.locator(`#${id}`).first();
          if (await el.count()) {
            const target = id === 'intro-h' ? page.locator('section[aria-labelledby="intro-h"]') : el;
            await target.screenshot({ path: path.join(SHOTS, `${scheme}-${vp.name}-${id}.png`) });
          }
        }
      }
      await context.close();
    }
  }
}

async function behaviors(browser) {
  console.log('\n=== 2. Comportements (bureau, clair) ===');
  let { page, context } = await newPage(browser, { width: 1440, height: 900, scheme: 'light' });

  // --- Focus clavier visible dès la première tabulation (lien d'évitement) : AVANT tout clic
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = el && getComputedStyle(el);
    return { text: el?.textContent?.trim(), outline: cs?.outlineStyle, width: cs?.outlineWidth };
  });
  ok(skip.text === 'Aller au contenu' && skip.outline !== 'none', 'clavier : lien « Aller au contenu » focalisé avec anneau visible', JSON.stringify(skip));

  // --- Thème : changement + mémorisation
  await page.getByRole('radio', { name: 'Sombre' }).click();
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'thème : bascule vers sombre');
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'thème : choix conservé après rechargement (sans flash)');
  await page.getByRole('radio', { name: 'Clair' }).click();

  // --- Palette de commandes
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Rechercher une section, une action…');
  ok(await input.isVisible(), 'palette : s\'ouvre avec Ctrl+K');
  await input.fill('typo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600); // défilement fluide
  const y = await page.evaluate(() => document.getElementById('typographie').getBoundingClientRect().top);
  ok(!(await input.isVisible()) && y < 250 && y > -50, 'palette : « typo » + Entrée referme et amène à la section Typographie', `top=${Math.round(y)}`);
  await page.keyboard.press('Control+k');
  await input.fill('zzzz');
  ok(await page.getByText('Aucun résultat. Essayez un autre mot.').isVisible(), 'palette : message clair quand rien ne correspond');
  await page.keyboard.press('Escape');
  ok(!(await input.isVisible()), 'palette : Échap referme');

  // --- Formulaire : validation et focus
  const submit = page.getByRole('button', { name: 'Enregistrer la réservation' });
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  ok(await page.getByText('Indiquez le nom du client.').isVisible(), 'formulaire : erreur claire sous le champ nom');
  ok(await page.getByText('Choisissez une catégorie de chambre.').isVisible(), 'formulaire : erreur sur la catégorie');
  await page.waitForTimeout(150); // le focus est posé à l'image suivante
  const focusedInvalid = await page.evaluate(() => document.activeElement?.getAttribute('aria-invalid'));
  ok(focusedInvalid === 'true', 'formulaire : le focus va au premier champ invalide');
  await page.getByLabel('Nom du client').fill('Hanitra R.');
  await page.getByLabel('E-mail').fill('pas-un-email');
  await page.getByLabel('E-mail').blur();
  ok(await page.getByText(/semble incorrecte/).isVisible(), 'formulaire : validation d\'e-mail à la sortie du champ');
  await page.getByLabel('Nom du client').fill('');
  await page.getByLabel('Nom du client').blur();
  await page.getByLabel('Nom du client').fill('Hanitra Rasoamanana');
  ok(!(await page.getByText('Indiquez le nom du client.').isVisible()), 'formulaire : l\'erreur disparaît une fois corrigée');
  await page.getByLabel('E-mail').fill('hanitra@exemple.mg');
  await page.getByRole('combobox', { name: /Catégorie/ }).click();
  await page.getByRole('option', { name: 'Suite' }).click();
  await page.getByLabel('Arrivée').first().fill('2026-12-02');
  await page.getByLabel('Départ').first().fill('2026-12-01');
  await page.getByLabel('Départ').first().blur();
  ok(await page.getByText(/Le départ doit être après l'arrivée/).isVisible(), 'formulaire : cohérence des dates (départ après arrivée)');
  await page.getByLabel('Départ').first().fill('2026-12-05');
  await submit.click();
  ok(await shows(page.getByText('Formulaire valide')), 'formulaire : soumission valide → notification');

  // --- Tableau : tri, recherche, état vide
  const table = page.getByRole('table', { name: 'Réservations récentes' });
  await table.scrollIntoViewIfNeeded();
  const firstGuest = async () => (await table.locator('tbody tr').first().locator('td').nth(1).innerText()).split('\n')[0];
  await table.getByRole('button', { name: /^Client/ }).click();
  ok((await table.getByRole('columnheader', { name: /Client/ }).getAttribute('aria-sort')) === 'ascending', 'tableau : tri croissant annoncé (aria-sort)');
  ok((await firstGuest()) === 'Andry Rakotoarisoa', 'tableau : tri alphabétique correct', await firstGuest());
  await table.getByRole('button', { name: /^Client/ }).click();
  ok((await firstGuest()) === 'Thomas Keller', 'tableau : tri décroissant correct', await firstGuest());
  await page.getByPlaceholder('Client ou référence').fill('xyz');
  ok(await shows(page.getByText('Aucune réservation ne correspond')), 'tableau : état vide illustré avec explication');
  await page.getByRole('button', { name: 'Effacer la recherche' }).click();
  ok((await table.locator('tbody tr').count()) === 8, 'tableau : « Effacer la recherche » restaure les 8 lignes');
  await page.getByRole('button', { name: 'Simuler un premier chargement' }).click();
  ok((await page.locator('table[aria-busy="true"]').count()) >= 1, 'tableau : squelette annoncé (aria-busy) pendant le chargement');
  await page.waitForTimeout(1500);

  // --- Graphique : vue tableau
  const fig = page.locator('figure').first();
  await fig.getByRole('button', { name: 'Tableau' }).click();
  ok(await fig.locator('table').isVisible(), 'graphique : la vue tableau affiche les mêmes données');
  await fig.getByRole('button', { name: 'Graphique' }).click();

  // --- Modale : Échap + restitution du focus
  const trigger = page.getByRole('button', { name: 'Modifier les dates' });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const dlg = page.getByRole('dialog', { name: 'Modifier les dates du séjour' });
  ok(await dlg.isVisible(), 'modale : s\'ouvre avec un titre accessible');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(!(await dlg.isVisible()), 'modale : Échap referme');
  ok((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Modifier les dates', 'modale : le focus revient au bouton d\'origine');

  // --- Confirmation destructive + annulation
  await page.getByRole('button', { name: 'Actions sur la réservation' }).click();
  await page.getByRole('menuitem', { name: 'Annuler la réservation' }).click();
  const confirm = page.getByRole('dialog', { name: /Annuler la réservation RES-2043/ });
  ok(await confirm.isVisible(), 'confirmation : action sensible confirmée avant exécution');
  ok((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Garder', 'confirmation : le choix sûr (« Garder ») est focalisé par défaut');
  await confirm.getByRole('button', { name: 'Annuler la réservation' }).click();
  await page.getByText('Réservation RES-2043 annulée').waitFor({ timeout: 4000 });
  ok(await page.getByRole('button', { name: 'Annuler', exact: true }).first().isVisible(), 'confirmation : la notification propose « Annuler » (retour arrière)');

  // --- Barre latérale repliable
  const navSection = page.locator('#navigation');
  await navSection.scrollIntoViewIfNeeded();
  const toggle = page.getByRole('button', { name: 'Replier le menu' });
  const w1 = (await toggle.locator('xpath=ancestor::nav').boundingBox()).width;
  await toggle.click();
  await page.waitForTimeout(400);
  const toggle2 = page.getByRole('button', { name: 'Déplier le menu' });
  const w2 = (await toggle2.locator('xpath=ancestor::nav').boundingBox()).width;
  ok(w2 < w1 && (await toggle2.getAttribute('aria-expanded')) === 'false', 'sidebar : se replie (aria-expanded)', `${Math.round(w1)}px → ${Math.round(w2)}px`);
  await page.getByRole('button', { name: 'Réservations', exact: true }).first().click();
  ok((await page.getByRole('button', { name: 'Réservations', exact: true }).first().getAttribute('aria-current')) === 'page', 'sidebar : l\'état actif reste visible une fois repliée');
  await context.close();

  // --- Mobile : feuille « Plus »
  ({ page, context } = await newPage(browser, { width: 375, height: 812, scheme: 'light' }));
  await page.locator('#navigation').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Plus' }).click();
  const more = page.getByRole('dialog', { name: 'Tous les modules' });
  ok(await more.isVisible(), 'mobile : « Plus » ouvre la feuille des autres modules');
  await page.waitForTimeout(600); // fin de l'animation d'ouverture
  const sheetBox = await more.boundingBox();
  ok(Math.abs(sheetBox.y + sheetBox.height - 812) < 2, 'mobile : la fenêtre est une feuille ancrée en bas', `bas=${Math.round(sheetBox.y + sheetBox.height)}`);
  await more.getByRole('button', { name: 'Finances' }).click();
  await page.waitForTimeout(400);
  // 5 onglets maximum
  const tabs = await page.locator('nav[aria-label="Navigation principale"]').last().locator('button').count();
  ok(tabs >= 2 && tabs <= 5, 'mobile : 5 entrées au plus dans la barre d\'onglets', `${tabs}`);
  const bar = await page.locator('nav[aria-label="Navigation principale"]').last().boundingBox();
  const lastTab = await page.getByRole('button', { name: 'Plus' }).boundingBox();
  ok(lastTab.x + lastTab.width <= bar.x + bar.width + 1, 'mobile : aucune entrée de la barre d\'onglets n\'est rognée', `${Math.round(lastTab.x + lastTab.width)} ≤ ${Math.round(bar.x + bar.width)}`);
  // cibles tactiles
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role="radio"], [role="tab"]')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), r: e.getBoundingClientRect() }))
      .filter((x) => x.t !== 'Aller au contenu' && x.r.height < 24 && x.r.width < 24 && x.r.height > 0)
      .map((x) => `${x.t}:${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
  );
  ok(small.length === 0, 'mobile : aucune cible inférieure à 24 px (WCAG 2.5.8)', small.slice(0, 4).join(', '));
  await context.close();

  // --- Mouvement réduit
  ({ page, context } = await newPage(browser, { width: 1440, height: 900, scheme: 'light', reducedMotion: 'reduce' }));
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('button')).transitionDuration);
  ok(parseFloat(dur) <= 0.01, 'mouvement réduit : les transitions sont neutralisées', dur);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await audit(browser);
    await behaviors(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nToutes les vérifications passent.' : `\n${failures} vérification(s) en échec.`);
  console.log(`Captures : ${SHOTS}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
