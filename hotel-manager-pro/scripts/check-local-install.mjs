#!/usr/bin/env node
/**
 * Vérification dans un vrai navigateur d'une installation locale (installateur Windows) : inscription d'un hôtel, vue d'ensemble,
 * rechargement direct d'une page profonde, connexion à la console de l'éditeur, et AUCUNE erreur de sécurité (CSP) dans la console.
 *
 *   BASE=http://127.0.0.1:5173 EDITOR_EMAIL=… EDITOR_PASSWORD=… node scripts/check-local-install.mjs
 *   MODE=login HOTEL_EMAIL=… (connexion d'un hôtel existant : vérifie une restauration)
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Playwright n'est pas une dépendance du projet : la CI l'installe à part (dossier HMP_PLAYWRIGHT) ; sinon on cherche une installation existante
const candidates = [process.env.HMP_PLAYWRIGHT && join(process.env.HMP_PLAYWRIGHT, 'package.json'), join(ROOT, 'apps', 'web', 'package.json'), join(ROOT, 'package.json')].filter(Boolean);
let chromium;
for (const base of candidates) { try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* suivant */ } }
if (!chromium) { console.error('✘ Playwright introuvable : installez-le (npm install playwright) et indiquez son dossier dans HMP_PLAYWRIGHT.'); process.exit(1); }
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const EDITOR = { email: process.env.EDITOR_EMAIL ?? 'editeur@ci.test', password: process.env.EDITOR_PASSWORD ?? 'Editeur-solide-42' };
const PASSWORD = 'Mot-de-passe-solide-42';
const login = process.env.MODE === 'login';
const hotelEmail = process.env.HOTEL_EMAIL ?? `client${Date.now()}@hotel-local.test`;

const browser = await chromium.launch();
const problems = [];
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' || /content security policy|refused to/i.test(m.text())) problems.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page);
  if (!login) {
    await page.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
    await page.getByLabel(/Nom de l'établissement/).fill('Hôtel Test Installateur');
    await page.getByLabel('Ville').fill('Toamasina');
    await page.getByLabel('Votre nom').fill('Client Local');
    await page.getByLabel('Adresse e-mail').fill(hotelEmail);
    await page.locator('input[autocomplete="new-password"]').fill(PASSWORD);
    await page.getByRole('checkbox', { name: /conditions/ }).click();
    await page.getByRole('button', { name: 'Créer mon établissement' }).click();
    await page.waitForSelector("text=Vue d'ensemble", { timeout: 30000 });
    console.log(`✔ inscription d'un hôtel et vue d'ensemble (${hotelEmail})`);
    await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1:has-text("Calendrier")', { timeout: 20000 });
    console.log('✔ page profonde rechargée directement (/calendar)');
  } else {
    await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle' });
    await page.getByLabel('Adresse e-mail').fill(hotelEmail);
    await page.locator('input[type=password]').fill(PASSWORD);
    await page.getByRole('button', { name: /Se connecter/ }).click();
    await page.waitForSelector("text=Vue d'ensemble", { timeout: 30000 });
    console.log(`✔ connexion de l'hôtel restauré (${hotelEmail})`);
  }
  const platform = await browser.newPage();
  watch(platform);
  await platform.goto(`${BASE}/platform/connexion`, { waitUntil: 'networkidle' });
  await platform.getByLabel('Adresse e-mail').fill(EDITOR.email);
  await platform.locator('input[type=password]').fill(EDITOR.password);
  await platform.getByRole('button', { name: /Se connecter|Connexion/ }).click();
  await platform.waitForURL((u) => !u.pathname.includes('connexion'), { timeout: 30000 });
  console.log('✔ connexion à la console de l\'éditeur');
  if (problems.length) { console.error('✘ Erreurs dans la console du navigateur :\n' + problems.join('\n')); process.exitCode = 1; }
  else console.log('✔ aucune erreur dans la console du navigateur');
} catch (e) {
  console.error(`✘ ${e.message.split('\n')[0]}`);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
