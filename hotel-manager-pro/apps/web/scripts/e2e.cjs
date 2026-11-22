/* eslint-disable */
/**
 * Vérification de bout en bout, en conditions réelles : navigateur (Chromium) → interface construite → API réelle (rôles PostgreSQL
 * à moindre privilège) → base PostgreSQL jetable. AUCUNE donnée simulée.
 *
 * Usage : pnpm check:e2e   (démarre la pile, exécute ce script, arrête la pile)
 *         ou, pile déjà démarrée :  BASE_URL=http://127.0.0.1:4173 node scripts/e2e.cjs
 *
 * Parcours : inscription d'un hôtel → configuration → choix de formule → déclaration de paiement → validation par la plateforme →
 * formule active ; assistance (note interne invisible) ; suspension et réactivation ; licence (clé montrée une fois) ;
 * isolation entre établissements ; puis balayage accessibilité (axe-core) et responsive de chaque écran, 2 thèmes × 3 tailles.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '.shots', 'e2e');
const AXE = require.resolve('axe-core/axe.min.js', { paths: [process.cwd()] });
const ADMIN = { email: 'admin@e2e.test', password: 'Mot-de-passe-solide-42' };
const PASSWORD = 'Mot-de-passe-solide-42';
const RUN = Date.now().toString(36);
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'}  ${label}${!cond && detail ? '  — ' + detail : ''}`);
  return cond;
};
const section = (t) => console.log(`\n── ${t}`);

async function newPage(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'fr-FR', deviceScaleFactor: 1, ...opts });
  const page = await context.newPage();
  page.consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && page.consoleErrors.push(m.text()));
  page.on('pageerror', (e) => page.consoleErrors.push(String(e)));
  return page;
}

const visible = (loc, timeout = 6000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const gone = (loc, timeout = 6000) => loc.first().waitFor({ state: 'hidden', timeout }).then(() => true, () => false);
const toast = (page, text) => visible(page.locator('[data-sonner-toast]').filter({ hasText: text }));
const bodyText = (page) => page.locator('body').innerText();

async function pick(page, label, optionName) {
  await page.getByLabel(label, { exact: false }).first().click();
  await page.getByRole('option', { name: optionName }).first().click();
}

/* ------------------------------------------------------------------------------------------------ */
async function registerHotel(browser, { name, email, ownerName = 'Hanitra Rasoamanana' }) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
  await page.getByLabel(/Nom de l'établissement/).fill(name);
  await page.getByLabel(/Ville/).fill('Nosy Be');
  await page.getByLabel('Votre nom').fill(ownerName);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /conditions/ }).click();
  await page.getByRole('button', { name: 'Créer mon établissement' }).click();
  await page.waitForURL('**/overview', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: /Terminez la configuration/ }).waitFor({ timeout: 10000 });
  await page.getByText(/Chambres/).first().waitFor({ timeout: 10000 });
  return page;
}

async function loginPlatform(browser) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/platform/connexion`, { waitUntil: 'networkidle' });
  await page.getByLabel('Adresse e-mail').fill(ADMIN.email);
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/platform/dashboard', { timeout: 15000 });
  return page;
}

/* ------------------------------------------------------------------------------------------------ */
/* Parcours des modules métier (un bloc par module, ajoutés au fil des phases) */
async function modulesJourney(browser, hotel, admin) {
  section('Chambres : catégories, chambres, tarifs saisonniers');
  {
    await hotel.goto(`${BASE}/rooms`, { waitUntil: 'networkidle' });
    ok(await visible(hotel.getByText('Commencez par créer une catégorie')), 'sans catégorie, l\'écran guide vers la première étape');
    ok(!/Bientôt/.test(await hotel.getByRole('button', { name: /^Chambres/ }).innerText()), 'le module Chambres n\'est plus « Bientôt »');
    await hotel.getByRole('link', { name: 'Créer une catégorie' }).click();
    await hotel.waitForURL('**/rooms/categories');
    await hotel.getByRole('button', { name: 'Nouvelle catégorie' }).first().click();
    let dlg = hotel.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(/Le code est obligatoire/.test(await dlg.innerText()), 'catégorie : le code est exigé');
    await dlg.getByLabel('Code').fill('STD');
    await dlg.getByLabel(/^Nom/).fill('Standard');
    await dlg.getByLabel(/Tarif de base par nuit/).fill('100 000');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await toast(hotel, 'Catégorie enregistrée'), 'catégorie créée');
    ok(/100\s?000\sAr/.test(await hotel.getByRole('row').filter({ hasText: 'Standard' }).first().innerText()), 'le tarif de base s\'affiche en Ariary');

    await hotel.goto(`${BASE}/rooms`, { waitUntil: 'networkidle' });
    await hotel.getByRole('button', { name: 'Ajouter en série' }).first().click();
    dlg = hotel.getByRole('dialog');
    await dlg.getByLabel('Catégorie').click();
    await hotel.getByRole('option', { name: 'Standard' }).click();
    await dlg.getByLabel(/^De\*?$/).fill('101');
    await dlg.getByLabel(/^À\*?$/).fill('105');
    ok(/101 à 105 — 5 chambres/.test(await dlg.innerText()), 'l\'aperçu annonce ce qui sera créé');
    await dlg.getByRole('button', { name: 'Créer les chambres' }).click();
    ok(await toast(hotel, '5 chambres créées'), 'création en série');
    ok((await hotel.getByRole('row').filter({ hasText: 'Disponible' }).count()) === 5, 'les 5 chambres sont « disponibles » (état dérivé)');

    await hotel.getByRole('button', { name: 'Ajouter une chambre' }).first().click();
    dlg = hotel.getByRole('dialog');
    await dlg.getByLabel('Catégorie').click();
    await hotel.getByRole('option', { name: 'Standard' }).click();
    await dlg.getByLabel('Numéro').fill('101');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await visible(dlg.getByText(/existe déjà/)), 'un numéro en double est refusé, dans la fenêtre');
    await dlg.getByLabel('Numéro').fill('201');
    await dlg.getByLabel(/Tarif propre à la chambre/).fill('150000');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await toast(hotel, 'Chambre créée'), 'chambre créée avec un tarif propre');
    const r201 = hotel.getByRole('row').filter({ hasText: '201' });
    ok(/150\s?000\sAr/.test(await r201.first().innerText()) && /tarif propre/.test(await r201.first().innerText()), 'le tarif propre est signalé');

    await hotel.getByRole('button', { name: 'Modifier la chambre 101' }).click();
    dlg = hotel.getByRole('dialog');
    await dlg.getByLabel(/Nom \(facultatif\)/).fill('Vue mer');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await toast(hotel, 'Chambre modifiée'), 'chambre modifiée');
    ok(/Vue mer/.test(await bodyText(hotel)), 'le nouveau nom s\'affiche');

    await hotel.getByRole('button', { name: 'Archiver la chambre 105' }).click();
    ok(await toast(hotel, 'Chambre 105 archivée'), 'chambre archivée');
    ok(await gone(hotel.getByRole('row').filter({ hasText: '105' })), 'une chambre archivée disparaît de la liste');
    await hotel.getByRole('switch', { name: 'Archivées' }).click();
    ok(await visible(hotel.getByRole('button', { name: 'Restaurer la chambre 105' })), 'les archivées sont consultables');
    await hotel.getByRole('button', { name: 'Restaurer la chambre 105' }).click();
    ok(await toast(hotel, 'Chambre 105 restaurée'), 'chambre restaurée');

    await hotel.goto(`${BASE}/rooms/rates`, { waitUntil: 'networkidle' });
    await hotel.getByRole('button', { name: 'Nouvelle période' }).first().click();
    dlg = hotel.getByRole('dialog');
    await dlg.getByLabel(/^Nom/).fill('Haute saison');
    await dlg.getByLabel('Première nuit').fill('2027-07-01');
    await dlg.getByLabel(/Dernière nuit/).fill('2027-08-31');
    await dlg.getByLabel('Tarif par nuit').fill('200000');
    await dlg.getByLabel(/Tarif week-end/).fill('260000');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await toast(hotel, 'Période enregistrée'), 'période tarifaire créée');
    await hotel.getByLabel('Arrivée').fill('2027-07-09');
    await hotel.getByLabel('Départ').fill('2027-07-12');
    await hotel.waitForTimeout(800);
    const sim = await bodyText(hotel);
    ok(/Total — 3 nuits/.test(sim) && /720\s?000\sAr/.test(sim), 'simulateur : vendredi + samedi au tarif week-end, dimanche au tarif normal = 720 000 Ar', sim.slice(-300));
    ok(/Saison : Haute saison/.test(sim), 'le simulateur dit d\'où vient chaque tarif');
  }

}

/* ------------------------------------------------------------------------------------------------ */
(async () => {
  const browser = await chromium.launch();
  const QUICK = !!process.env.E2E_QUICK; // inscription + modules métier seulement (itération rapide)
  const SWEEP_ONLY = !!process.env.E2E_SWEEP_ONLY; // rejoue seulement le balayage, sur les données d'un parcours complet précédent
  let hotelName = `Hôtel Baobab ${RUN}`;
  let email = `owner-${RUN}@e2e.test`;
  let hotel, admin, hotelId;
  if (SWEEP_ONLY) ({ hotelName, email, hotelId } = JSON.parse(fs.readFileSync(path.join(SHOTS, 'state.json'), 'utf8')));

  if (QUICK) {
    hotel = await registerHotel(browser, { name: hotelName, email });
    admin = await loginPlatform(browser);
    await modulesJourney(browser, hotel, admin);
    console.log(`\n${failures === 0 ? 'Modules : tout passe.' : failures + ' vérification(s) en échec.'}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
  }
  if (!SWEEP_ONLY) {
  /* ================================================================ 1. Accès et inscription */
  section('Accès et inscription');
  {
    const anon = await newPage(browser);
    await anon.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
    ok(anon.url().endsWith('/connexion'), 'une page protégée renvoie vers la connexion', anon.url());
    ok(anon.consoleErrors.length === 0, 'aucune erreur console pour un visiteur anonyme (pas de 401 inutile)', anon.consoleErrors.join(' | '));
    await anon.goto(`${BASE}/platform/dashboard`, { waitUntil: 'networkidle' });
    ok(anon.url().endsWith('/platform/connexion'), 'la console exige sa propre connexion', anon.url());

    await anon.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
    await anon.getByRole('button', { name: 'Créer mon établissement' }).click();
    const t = await bodyText(anon);
    ok(/Le nom de l'établissement doit contenir au moins 2 caractères/.test(t), 'inscription : erreur sous le nom de l\'établissement');
    ok(/Saisissez une adresse e-mail valide/.test(t), 'inscription : erreur sous l\'e-mail');
    ok(/au moins 10 caractères/.test(t), 'inscription : règle du mot de passe expliquée');
    ok(/accepter les conditions/.test(t), 'inscription : conditions à accepter');
    ok((await anon.locator('[role="alert"]').count()) >= 4, 'inscription : erreurs annoncées aux lecteurs d\'écran (role=alert)');
    await anon.getByLabel(/Nom de l'établissement/).fill('Hôtel Test');
    await anon.getByLabel('Votre nom').fill('Aina R');
    await anon.getByLabel('Adresse e-mail').fill('aina@e2e.test');
    await anon.locator('input[autocomplete="new-password"]').fill('motdepasse1');
    await anon.getByRole('checkbox', { name: /conditions/ }).click();
    await anon.getByRole('button', { name: 'Créer mon établissement' }).click();
    ok(/trop courant/.test(await bodyText(anon)), 'inscription : mot de passe courant refusé avant l\'envoi');
    await anon.context().close();
  }

  hotel = await registerHotel(browser, { name: hotelName, email });
  {
    const t = await bodyText(hotel);
    ok(/Terminez la configuration/.test(t), 'après inscription : on arrive sur la configuration initiale');
    ok(/Essai gratuit/.test(t) && /Business/.test(t), 'l\'essai gratuit de la formule Business est actif');
    ok(/Chambres\s*0 sur 30/.test(t.replace(/\n/g, ' ')), 'les quotas réels sont affichés (0 chambre sur 30)');
    ok(/ne montrons jamais de valeurs d'exemple/.test(t), 'le tableau de bord n\'invente aucun indicateur d\'exploitation');
    const cookies = await hotel.context().cookies();
    const session = cookies.find((c) => c.name === 'hmp_session');
    ok(session && session.httpOnly && session.sameSite === 'Lax', 'cookie de session HttpOnly + SameSite=Lax', JSON.stringify(session));
    const csrf = cookies.find((c) => c.name === 'hmp_csrf');
    ok(csrf && !csrf.httpOnly, 'cookie CSRF lisible par l\'application (requis pour l\'en-tête)');
    ok(!(await hotel.evaluate(() => document.cookie)).includes('hmp_session'), 'le jeton de session est invisible du JavaScript');
    ok((await hotel.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).indexOf('hmp_session') === -1, 'aucun jeton dans le stockage du navigateur');
  }

  /* ================================================================ 2. Navigation et modules à venir */
  section('Navigation et modules à venir');
  {
    ok((await hotel.getByText('Bientôt', { exact: true }).count()) >= 10, 'les modules non développés sont signalés « Bientôt »');
    await hotel.getByRole('button', { name: /Réservations/ }).click();
    await hotel.waitForURL('**/reservations');
    const t = await bodyText(hotel);
    ok(/Réservations : bientôt disponible/.test(t), 'un module non développé le dit franchement');
    ok(!/\d{2,} réservations/.test(t), 'aucune fausse donnée dans un module à venir');
    ok((await hotel.title()).startsWith('Réservations'), 'le titre de l\'onglet suit la page', await hotel.title());
    await hotel.keyboard.press('Control+k');
    ok(await visible(hotel.getByRole('dialog', { name: /Palette/ })), 'palette de commandes (Ctrl+K)');
    await hotel.keyboard.type('abonnement');
    await hotel.keyboard.press('Enter');
    await hotel.waitForURL('**/settings/subscription');
    ok(true, 'la palette mène aux paramètres (clavier seul)');
  }

  /* ================================================================ 3. Configuration de l'établissement */
  section('Configuration de l\'établissement');
  {
    await hotel.goto(`${BASE}/settings/hotel`, { waitUntil: 'networkidle' });
    await hotel.getByLabel('Téléphone').fill('+261 34 00 000 00');
    await hotel.getByLabel('Adresse', { exact: true }).fill('Lot 12, Hell-Ville');
    ok(await visible(hotel.getByText('Modifications non enregistrées')), 'barre « modifications non enregistrées » dès qu\'on modifie');
    await hotel.getByLabel('E-mail de l\'établissement').fill('pas-un-email');
    await hotel.getByRole('button', { name: 'Enregistrer' }).click();
    ok(/adresse e-mail valide/.test(await bodyText(hotel)), 'validation du formulaire avant envoi');
    await hotel.getByLabel('E-mail de l\'établissement').fill('contact@baobab.test');
    await hotel.getByRole('button', { name: 'Enregistrer' }).click();
    ok(await toast(hotel, 'Modifications enregistrées'), 'enregistrement du profil confirmé');
    await hotel.reload({ waitUntil: 'networkidle' });
    ok((await hotel.getByLabel('Téléphone').inputValue()) === '+261 34 00 000 00', 'le profil est bien conservé après rechargement');

    await hotel.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
    ok(/Coordonnées de l'établissement\s*:\s*fait/.test(await bodyText(hotel)), 'la configuration reflète les données réelles (coordonnées : fait)');
    await hotel.getByRole('button', { name: 'Terminer la configuration' }).first().click();
    const dlg = hotel.getByRole('dialog');
    ok(await visible(dlg), 'confirmation avant de terminer');
    ok(/ne pourra plus être modifiée/.test(await dlg.innerText()), 'la confirmation prévient du verrouillage de la devise');
    ok((await hotel.evaluate(() => document.activeElement?.textContent)) === 'Garder', 'le focus est sur le choix sûr (Garder)');
    await dlg.getByRole('button', { name: 'Terminer la configuration' }).click();
    ok(await toast(hotel, 'Configuration terminée'), 'configuration terminée');
    ok(await visible(hotel.getByRole('heading', { name: /Bonjour Hanitra/ })), 'le tableau de bord passe à l\'état « prêt »');
    await hotel.goto(`${BASE}/settings/hotel`, { waitUntil: 'networkidle' });
    ok(await hotel.getByLabel('Devise de facturation').isDisabled(), 'la devise est verrouillée après la configuration');
  }

  admin = await loginPlatform(browser);
  await modulesJourney(browser, hotel, admin);

  /* ================================================================ 4. Choix d'une formule, facture, paiement */
  section('Abonnement, facture et paiement (validation manuelle)');
  {
    await hotel.goto(`${BASE}/settings/subscription`, { waitUntil: 'networkidle' });
    const t = await bodyText(hotel);
    ok(/Formule Business/.test(t) && /Essai gratuit/.test(t), 'l\'abonnement affiche l\'essai en cours');
    ok(/Sur devis/.test(t), 'la formule Enterprise est « sur devis »');
    await hotel.getByRole('button', { name: 'Souscrire à Starter' }).click();
    const dlg = hotel.getByRole('dialog');
    ok(/80\s?000\sAr/.test(await dlg.innerText()), 'le prix catalogue du mois s\'affiche (80 000 Ar)');
    ok(/rien n'est prélevé automatiquement/.test(await dlg.innerText()), 'la fenêtre dit qu\'aucun prélèvement automatique n\'a lieu');
    await dlg.getByRole('button', { name: /Confirmer et recevoir la facture/ }).click();
    await hotel.waitForURL('**/settings/invoices');
    ok(await toast(hotel, /Facture FS-\d{4}-\d{6} émise/), 'la facture est émise (numéro séquentiel)');
    await hotel.waitForLoadState('networkidle');
    const row = hotel.getByRole('row').filter({ hasText: 'FS-' });
    ok(await visible(row), 'la facture est dans la liste');
    ok(/80\s?000\sAr/.test(await row.first().innerText()) && /À régler/.test(await row.first().innerText()), 'facture de 80 000 Ar « à régler »');

    await row.first().getByRole('button', { name: /Détails/ }).click();
    const drawer = hotel.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Déclarer un paiement' }).click();
    ok(/Aucun moyen de paiement n'est ouvert/.test(await hotel.getByRole('dialog').last().innerText()), 'tant que la plateforme n\'ouvre aucun moyen de paiement, l\'hôtel ne peut rien déclarer');
    await hotel.keyboard.press('Escape');
    await hotel.keyboard.press('Escape');
  }
  {
    // La plateforme ouvre MVola (manuel) ; la carte reste impossible (aucun prestataire connecté)
    await admin.goto(`${BASE}/platform/settings`, { waitUntil: 'networkidle' });
    await admin.getByRole('tab', { name: 'Moyens de paiement' }).click();
    const cards = admin.locator('li').filter({ has: admin.getByRole('heading', { name: 'MVola' }) });
    await cards.getByLabel('Consignes de paiement').fill('Envoyez le montant au 034 00 000 00 (MVola) puis déclarez la référence.');
    await cards.getByRole('switch').click();
    ok(await toast(admin, 'Moyen de paiement enregistré'), 'la plateforme ouvre MVola (moyen manuel)');
    const card = admin.locator('li').filter({ has: admin.getByRole('heading', { name: 'Carte bancaire' }) });
    ok(await card.getByRole('switch').isDisabled(), 'la carte bancaire ne peut pas être activée');
    ok(/Aucun prestataire de paiement en ligne n'est connecté/.test(await card.innerText()), 'la carte dit pourquoi : aucun prestataire connecté');
  }
  {
    await hotel.goto(`${BASE}/settings/invoices`, { waitUntil: 'networkidle' });
    await hotel.getByRole('row').filter({ hasText: 'FS-' }).first().getByRole('button', { name: /Détails/ }).click();
    await hotel.getByRole('dialog').getByRole('button', { name: 'Déclarer un paiement' }).click();
    const modal = hotel.getByRole('dialog').last();
    await modal.getByLabel('Moyen de paiement utilisé').click();
    await hotel.getByRole('option', { name: 'MVola' }).click();
    ok(/034 00 000 00/.test(await modal.innerText()), 'les consignes de la plateforme s\'affichent pour le moyen choisi');
    await modal.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    ok(/Saisissez la référence/.test(await modal.innerText()), 'la référence est exigée');
    await modal.getByLabel(/Référence de la transaction/).fill('MP260101.1234');
    await modal.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    ok(await toast(hotel, 'sera pris en compte dès sa vérification'), 'paiement déclaré : « pris en compte après vérification »');
    const drawer = hotel.getByRole('dialog');
    ok(await visible(drawer.getByText('En attente de validation')), 'le paiement est « en attente de validation », pas confirmé');
    ok(/À régler/.test(await drawer.innerText()), 'la facture reste « à régler » tant que la plateforme n\'a pas validé');
    await hotel.keyboard.press('Escape');
    const t = await (async () => { await hotel.goto(`${BASE}/settings/subscription`, { waitUntil: 'networkidle' }); return bodyText(hotel); })();
    ok(/Essai gratuit/.test(t), 'la formule n\'a PAS changé avant la validation');
  }
  {
    await admin.goto(`${BASE}/platform/payments`, { waitUntil: 'networkidle' });
    const row = admin.getByRole('row').filter({ hasText: hotelName });
    ok(await visible(row), 'le paiement apparaît dans la file de la plateforme');
    ok(/MP260101\.1234/.test(await row.first().innerText()), 'avec sa référence');
    await row.first().getByRole('button', { name: /Valider le paiement/ }).click();
    const dlg = admin.getByRole('dialog');
    ok(/Confirmez que vous l'avez bien reçu/.test(await dlg.innerText()), 'confirmation explicite avant validation');
    await dlg.getByRole('button', { name: 'Valider le paiement' }).click();
    ok(await toast(admin, 'formule changée'), 'validation : la formule est changée');
    await hotel.goto(`${BASE}/settings/subscription`, { waitUntil: 'networkidle' });
    const t = await bodyText(hotel);
    ok(/Formule Starter/.test(t) && /Actif/.test(t), 'côté hôtel : formule Starter active');
    ok(/Formule actuelle/.test(t), 'la formule actuelle est signalée dans le catalogue');
    await hotel.goto(`${BASE}/settings/invoices`, { waitUntil: 'networkidle' });
    ok(/Réglée/.test(await hotel.getByRole('row').filter({ hasText: 'FS-' }).first().innerText()), 'la facture est maintenant « réglée »');
  }

  /* ================================================================ 5. Assistance : la note interne reste interne */
  section('Assistance');
  {
    await hotel.goto(`${BASE}/settings/support`, { waitUntil: 'networkidle' });
    await hotel.getByRole('button', { name: /Nouvelle demande|Écrire au support/ }).first().click();
    const modal = hotel.getByRole('dialog');
    await modal.getByRole('button', { name: 'Envoyer la demande' }).click();
    ok(/au moins 3 caractères/.test(await modal.innerText()), 'ticket : l\'objet est exigé');
    await modal.getByLabel('Objet').fill('Question sur ma facture');
    await modal.getByLabel('Message').fill('Pouvez-vous confirmer la réception de mon virement ?');
    await modal.getByRole('button', { name: 'Envoyer la demande' }).click();
    ok(await toast(hotel, /Demande .* envoyée/), 'demande envoyée');
    ok(await visible(hotel.getByRole('dialog').getByText('Pouvez-vous confirmer la réception')), 'le fil de discussion s\'ouvre');
    await hotel.keyboard.press('Escape');

    await admin.goto(`${BASE}/platform/support`, { waitUntil: 'networkidle' });
    await admin.getByRole('button', { name: /Question sur ma facture/ }).first().click();
    const drawer = admin.getByRole('dialog');
    await drawer.getByLabel('Votre réponse').fill('Bonjour, votre virement est bien reçu. Merci !');
    await drawer.getByRole('button', { name: 'Répondre' }).click();
    ok(await toast(admin, 'Réponse envoyée'), 'la plateforme répond publiquement');
    await drawer.getByRole('switch', { name: /Note interne/ }).click();
    await drawer.getByRole('textbox', { name: 'Note interne' }).fill('Client sérieux, virement vérifié sur le relevé BNI.');
    await drawer.getByRole('button', { name: 'Ajouter la note' }).click();
    ok(await toast(admin, 'Note interne ajoutée'), 'la plateforme ajoute une note interne');

    await hotel.goto(`${BASE}/settings/support`, { waitUntil: 'networkidle' });
    await hotel.getByRole('button', { name: /Question sur ma facture/ }).first().click();
    const t = await hotel.getByRole('dialog').innerText();
    ok(/votre virement est bien reçu/.test(t), 'l\'hôtel voit la réponse publique');
    ok(!/Client sérieux/.test(t) && !/relevé BNI/.test(t), 'l\'hôtel ne voit JAMAIS la note interne');
    ok(/Support Hotel Manager Pro/.test(t), 'la réponse est signée « Support Hotel Manager Pro »');
    await hotel.keyboard.press('Escape');
  }

  /* ================================================================ 6. Suspension et réactivation */
  section('Suspension et réactivation');
  {
    await admin.goto(`${BASE}/platform/hotels?q=${encodeURIComponent(RUN)}`, { waitUntil: 'networkidle' });
    await admin.getByRole('link', { name: hotelName }).click();
    await admin.waitForURL(/\/platform\/hotels\/[0-9a-f-]{36}/);
    hotelId = admin.url().split('/').pop();
    await admin.getByRole('heading', { name: hotelName, level: 1 }).waitFor();
    await admin.waitForLoadState('networkidle');
    const t = await bodyText(admin);
    ok(/Starter/.test(t) && /Actif/.test(t), 'la fiche affiche la formule et l\'état');
    ok(/MP260101\.1234/.test(t) && /FS-\d{4}-\d{6}/.test(t), 'la fiche rassemble ses paiements et ses factures (données de la plateforme)');
    await admin.getByRole('button', { name: 'Suspendre' }).click();
    const dlg = admin.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Suspendre le compte' }).click();
    ok(/motif d'au moins 3 caractères/.test(await dlg.innerText()), 'un motif est exigé pour suspendre');
    await dlg.getByLabel('Motif').fill('Test de suspension e2e');
    await dlg.getByRole('button', { name: 'Suspendre le compte' }).click();
    ok(await toast(admin, 'Compte suspendu'), 'compte suspendu');

    await hotel.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
    ok(await visible(hotel.getByRole('heading', { name: 'Compte suspendu' })), 'l\'hôtel suspendu voit un écran dédié, pas ses données');
    ok(!/Chambres/.test(await bodyText(hotel)), 'aucune donnée de l\'établissement n\'est affichée');
    await hotel.getByRole('button', { name: /Contacter l'assistance/ }).click();
    ok(await visible(hotel.getByRole('button', { name: /Nouvelle demande|Écrire au support/ })), 'l\'assistance reste joignable pendant la suspension');

    await admin.getByRole('button', { name: 'Réactiver le compte' }).click();
    ok(await toast(admin, 'Compte réactivé'), 'compte réactivé');
    await hotel.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
    ok(await visible(hotel.getByRole('heading', { name: /Bonjour Hanitra/ })), 'l\'hôtel retrouve son espace');
  }

  /* ================================================================ 7. Licence : clé montrée une fois */
  section('Licence définitive');
  {
    await admin.goto(`${BASE}/platform/hotels/${hotelId}`, { waitUntil: 'networkidle' });
    await admin.getByRole('button', { name: 'Actions' }).click();
    await admin.getByRole('menuitem', { name: /Émettre une licence/ }).click();
    const dlg = admin.getByRole('dialog');
    await dlg.getByLabel('Édition').fill('perpetuelle-pro');
    await dlg.getByRole('button', { name: 'Émettre la licence' }).click();
    const key = await dlg.getByTestId('license-key').textContent({ timeout: 8000 }).catch(() => null);
    ok(key && /^HMP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(key.trim()), 'la clé de licence est affichée une fois', String(key));
    ok(/ne sera plus jamais affichée/.test(await dlg.innerText()), 'avec l\'avertissement qu\'elle ne sera plus affichée');
    await dlg.getByRole('button', { name: /J'ai conservé la clé/ }).click();
    await admin.waitForLoadState('networkidle');
    ok(!(await bodyText(admin)).includes(key.trim()), 'la clé a disparu de l\'écran de la plateforme');
    ok(/perpetuelle-pro/.test(await bodyText(admin)), 'la licence figure sur la fiche (préfixe seulement)');

    await hotel.goto(`${BASE}/settings/subscription`, { waitUntil: 'networkidle' });
    const t = await bodyText(hotel);
    ok(/Votre licence/.test(t) && /perpetuelle-pro/.test(t), 'côté hôtel : la licence prime sur l\'abonnement');
    ok(!t.includes(key.trim()), 'la clé n\'est jamais ré-affichée à l\'hôtel');
  }

  /* ================================================================ 8. Isolation et sécurité */
  section('Isolation entre établissements et sécurité');
  {
    const other = await registerHotel(browser, { name: `Hôtel Voisin ${RUN}`, email: `voisin-${RUN}@e2e.test`, ownerName: 'Bao Rakoto' });
    await other.goto(`${BASE}/settings/invoices`, { waitUntil: 'networkidle' });
    ok(/Aucune facture pour le moment/.test(await bodyText(other)), 'isolation : le voisin ne voit aucune facture du premier hôtel');
    await other.goto(`${BASE}/settings/support`, { waitUntil: 'networkidle' });
    ok(/Aucune demande/.test(await bodyText(other)), 'isolation : ni ses demandes d\'assistance');
    await other.goto(`${BASE}/settings/subscription`, { waitUntil: 'networkidle' });
    ok(/Formule Business/.test(await bodyText(other)) && !/perpetuelle-pro/.test(await bodyText(other)), 'isolation : ni sa licence ni sa formule');
    await other.goto(`${BASE}/platform/dashboard`, { waitUntil: 'networkidle' });
    ok(other.url().endsWith('/platform/connexion'), 'un compte d\'hôtel ne donne aucun accès à la console');

    await admin.goto(`${BASE}/platform/hotels?q=${encodeURIComponent(RUN)}`, { waitUntil: 'networkidle' });
    const list = await bodyText(admin);
    ok(/Hôtel Voisin/.test(list) && /Hôtel Baobab/.test(list), 'la console liste les deux établissements');
    ok(!/MP260101|Question sur ma facture|Pouvez-vous confirmer/.test(list), 'l\'annuaire de la console ne contient aucune donnée de l\'hôtel');

    // Déconnexion : plus aucun accès, même avec le bouton « précédent »
    await hotel.getByRole('button', { name: /Menu du compte/ }).click();
    await hotel.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await hotel.waitForURL('**/connexion');
    await hotel.goBack();
    await hotel.waitForLoadState('networkidle');
    ok(hotel.url().endsWith('/connexion') || (await bodyText(hotel)).includes('Connexion'), 'après déconnexion, « précédent » ne rend pas l\'espace');
    ok(!(await hotel.context().cookies()).some((c) => c.name === 'hmp_session'), 'le cookie de session est supprimé à la déconnexion');
    await other.context().close();
  }

  /* ================================================================ 9. Mot de passe */
  section('Compte et mot de passe');
  {
    const p = await newPage(browser);
    await p.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
    await p.getByLabel('Adresse e-mail').fill(email);
    await p.locator('input[autocomplete="current-password"]').fill('mauvais-mot-de-passe-1');
    await p.getByRole('button', { name: 'Se connecter' }).click();
    ok(await visible(p.getByRole('alert').filter({ hasText: /incorrect|invalide|Identifiants/i })), 'mauvais mot de passe : message clair');
    await p.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.waitForURL('**/overview');
    await p.goto(`${BASE}/settings/account`, { waitUntil: 'networkidle' });
    await p.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const news = p.locator('input[autocomplete="new-password"]');
    await news.nth(0).fill('court1');
    await news.nth(1).fill('court1');
    await p.getByRole('button', { name: 'Modifier le mot de passe' }).click();
    ok(/au moins 10 caractères/.test(await bodyText(p)), 'changement : règle du mot de passe appliquée côté interface');
    await news.nth(0).fill('Nouveau-mot-de-passe-77');
    await news.nth(1).fill('Nouveau-mot-de-passe-77');
    await p.getByRole('button', { name: 'Modifier le mot de passe' }).click();
    ok(await toast(p, 'Mot de passe modifié'), 'mot de passe modifié');
    await p.context().close();
  }


  fs.writeFileSync(path.join(SHOTS, 'state.json'), JSON.stringify({ hotelName, email, hotelId, run: RUN }));
  }

  /* ================================================================ 10. Accessibilité et responsive de CHAQUE écran */
  section('Accessibilité (axe-core WCAG 2.1 A/AA) et responsive — chaque écran, 2 thèmes × 3 tailles');
  {
    const SIZES = [{ n: 'mobile', w: 375, h: 812 }, { n: 'tablette', w: 768, h: 1024 }, { n: 'bureau', w: 1440, h: 900 }];
    const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
    const NEW_PASSWORD = 'Nouveau-mot-de-passe-77';

    const audit = async (page, label, shot) => {
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(450);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const errs = page.consoleErrors.splice(0);
      await page.addScriptTag({ path: AXE });
      const violations = await page.evaluate(async (tags) => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, rules: { 'page-has-heading-one': { enabled: true }, 'landmark-one-main': { enabled: true } } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, target: (v.nodes[0].target || []).join(' '), html: (v.nodes[0].html || '').slice(0, 140) }));
      }, RULES);
      const good = overflow <= 1 && errs.length === 0 && violations.length === 0;
      if (!good) {
        const parts = [];
        if (overflow > 1) parts.push(`défilement horizontal de ${overflow}px`);
        if (errs.length) parts.push(`erreurs console : ${errs.slice(0, 2).join(' | ')}`);
        for (const v of violations) parts.push(`axe ${v.id} (${v.impact}) ×${v.count} ${v.target} ${v.html}`);
        ok(false, label, parts.join(' ; '));
      } else {
        passed++;
      }
      if (shot) await page.screenshot({ path: path.join(SHOTS, `${shot}.png`), fullPage: false });
    };
    let passed = 0;

    for (const scheme of ['light', 'dark']) {
      for (const size of SIZES) {
        const opts = { viewport: { width: size.w, height: size.h }, colorScheme: scheme };
        // --- visiteur anonyme
        const anon = await newPage(browser, opts);
        for (const route of ['/connexion', '/inscription', '/conditions', '/confidentialite', '/platform/connexion']) {
          await anon.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
          await audit(anon, `${route} — ${scheme} ${size.n}`, size.n === 'bureau' || size.n === 'mobile' ? `anon${route.replace(/\//g, '-')}-${scheme}-${size.n}` : null);
        }
        await anon.context().close();

        // --- établissement
        const h = await newPage(browser, opts);
        await h.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
        await h.getByLabel('Adresse e-mail').fill(email);
        await h.locator('input[autocomplete="current-password"]').fill(NEW_PASSWORD);
        await h.getByRole('button', { name: 'Se connecter' }).click();
        await h.waitForURL('**/overview');
        for (const route of ['/overview', '/reservations', '/rooms', '/rooms/categories', '/rooms/rates', '/settings/hotel', '/settings/subscription', '/settings/invoices', '/settings/support', '/settings/account', '/design']) {
          await h.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
          await audit(h, `${route} — ${scheme} ${size.n}`, size.n !== 'tablette' ? `hotel${route.replace(/\//g, '-')}-${scheme}-${size.n}` : null);
        }
        // fenêtres et panneaux (focus piégé, feuille basculante sur mobile)
        await h.goto(`${BASE}/settings/invoices`, { waitUntil: 'networkidle' });
        await h.getByRole('row').filter({ hasText: 'FS-' }).first().getByRole('button', { name: /Détails/ }).click().catch(async () => h.getByRole('button', { name: /FS-\d{4}-\d{6}/ }).first().click());
        await audit(h, `panneau d'une facture — ${scheme} ${size.n}`, size.n === 'mobile' ? `hotel-facture-${scheme}` : null);
        await h.keyboard.press('Escape');
        await h.goto(`${BASE}/settings/support`, { waitUntil: 'networkidle' });
        await h.getByRole('button', { name: /Nouvelle demande/ }).first().click();
        await audit(h, `fenêtre « nouvelle demande » — ${scheme} ${size.n}`);
        await h.keyboard.press('Escape');
        await h.keyboard.press('Control+k');
        await audit(h, `palette de commandes — ${scheme} ${size.n}`);
        await h.context().close();

        // --- console
        const a = await newPage(browser, opts);
        await a.goto(`${BASE}/platform/connexion`, { waitUntil: 'networkidle' });
        await a.getByLabel('Adresse e-mail').fill(ADMIN.email);
        await a.locator('input[autocomplete="current-password"]').fill(ADMIN.password);
        await a.getByRole('button', { name: 'Se connecter' }).click();
        await a.waitForURL('**/platform/dashboard');
        const routes = ['/platform/dashboard', '/platform/hotels', `/platform/hotels/${hotelId}`, '/platform/subscriptions', '/platform/payments?status=all', '/platform/invoices', '/platform/plans', '/platform/licenses', '/platform/support', '/platform/settings', '/platform/audit'];
        for (const route of routes) {
          await a.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
          await audit(a, `${route.replace(hotelId, ':id')} — ${scheme} ${size.n}`, size.n !== 'tablette' && /dashboard|hotels\/|payments|plans/.test(route) ? `platform${route.split('?')[0].replace(/[/:]/g, '-').replace(hotelId, 'id')}-${scheme}-${size.n}` : null);
        }
        await a.goto(`${BASE}/platform/settings`, { waitUntil: 'networkidle' });
        await a.getByRole('tab', { name: 'Moyens de paiement' }).click();
        await audit(a, `/platform/settings (moyens de paiement) — ${scheme} ${size.n}`);
        await a.goto(`${BASE}/platform/plans`, { waitUntil: 'networkidle' });
        await a.getByRole('button', { name: /Modifier$/ }).first().click();
        await audit(a, `fenêtre « modifier un forfait » — ${scheme} ${size.n}`);
        await a.keyboard.press('Escape');
        await a.goto(`${BASE}/platform/hotels/${hotelId}`, { waitUntil: 'networkidle' });
        await a.getByRole('button', { name: 'Actions' }).click();
        await a.getByRole('menuitem', { name: 'Activer une formule' }).click();
        await audit(a, `fenêtre « activer une formule » — ${scheme} ${size.n}`);
        await a.context().close();
      }
    }
    ok(true, `${passed} écrans/états audités sans défaut (sans défilement horizontal, sans erreur console, sans violation axe A/AA)`);
  }

  await hotel?.context().close();
  await admin?.context().close();
  await browser.close();

  console.log(`\n${failures === 0 ? 'Tous les parcours passent.' : failures + ' vérification(s) en échec.'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
