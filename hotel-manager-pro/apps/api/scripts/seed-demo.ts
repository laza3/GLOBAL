/**
 * Données de DÉMONSTRATION (fictives) pour tester le logiciel : un hôtel « [DÉMO] … » avec chambres, clients et réservations.
 *
 *   pnpm api:seed-demo
 *
 * Variables : API_URL (défaut http://127.0.0.1:3000), DEMO_ORIGIN (adresse de l'interface autorisée par l'API, défaut
 * http://127.0.0.1:5173), DEMO_EMAIL, DEMO_PASSWORD (sinon généré et affiché UNE fois).
 *
 * GARDE-FOU : le script interroge /api/v1/meta et REFUSE de s'exécuter si l'instance est en « production ». Il passe par l'API
 * publique (mêmes règles que l'interface) : aucune écriture directe dans la base. Les données fictives n'existent donc que
 * en développement et en staging, jamais à côté de vrais hôtels.
 */
import { addDays, todayIn } from '@hmp/shared';
import { randomBytes } from 'node:crypto';

const API_URL = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ORIGIN = process.env.DEMO_ORIGIN ?? 'http://127.0.0.1:5173';
const EMAIL = (process.env.DEMO_EMAIL ?? 'demo.proprietaire@example.test').toLowerCase();
const generated = !process.env.DEMO_PASSWORD;
const PASSWORD = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(9).toString('base64url')}-7`;
const HOTEL = '[DÉMO] Hôtel Les Baobabs';

function fail(message: string): never {
  console.error(`\nERREUR : ${message}\n`);
  process.exit(1);
}

const jar = new Map<string, string>();
let csrf = '';

async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    fail(`API injoignable sur ${API_URL}. Démarrez-la d'abord (pnpm local:start) ou renseignez API_URL.`);
  }
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0]!;
    const eq = pair.indexOf('=');
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* corps non JSON */ }
  return { status: res.status, body: parsed as T };
}

async function must<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await call<T>(method, path, body);
  if (res.status >= 300) fail(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// 1. Garde-fou d'environnement
const meta = await call<{ environment?: string }>('GET', '/api/v1/meta');
if (meta.status !== 200 || !meta.body?.environment) fail('Réponse inattendue de /api/v1/meta : instance non reconnue, abandon.');
if (meta.body.environment === 'production') fail('Cette instance est en PRODUCTION : les données de démonstration y sont interdites. Aucune donnée n\'a été créée.');
console.log(`Environnement détecté : ${meta.body.environment} — création de l'hôtel de démonstration…`);

// 2. Établissement + compte propriétaire (inscription réelle)
const reg = await call<{ csrfToken?: string; hotel?: { id: string }; error?: { code: string } }>('POST', '/api/v1/auth/register-hotel', {
  hotelName: HOTEL, city: 'Nosy Be', ownerName: 'Propriétaire Démo', email: EMAIL, password: PASSWORD, acceptTerms: true,
});
if (reg.status !== 201) {
  fail(reg.status === 409 || reg.body?.error?.code === 'email_taken'
    ? `Le compte ${EMAIL} existe déjà : la démonstration est déjà installée (connectez-vous avec ce compte).`
    : `Inscription refusée (${reg.status}) : ${JSON.stringify(reg.body)}`);
}
csrf = reg.body.csrfToken ?? '';

// 3. Chambres
const category = async (code: string, name: string, baseRate: number, sortOrder: number) => (await must('POST', '/api/v1/rooms/categories', { code, name, baseRate, sortOrder })).id as string;
const std = await category('STD', 'Standard', 120_000, 1);
const dlx = await category('DLX', 'Deluxe vue mer', 220_000, 2);
const ste = await category('STE', 'Suite familiale', 380_000, 3);
for (const [cat, numbers, capacity] of [[std, ['101', '102', '103', '104', '105', '106'], 2], [dlx, ['201', '202', '203', '204'], 3], [ste, ['301', '302'], 4]] as const) {
  for (const number of numbers) await must('POST', '/api/v1/rooms', { categoryId: cat, number, capacity });
}

// 4. Clients fictifs (adresses en example.test : jamais de vraie personne)
const names: Array<[string, string]> = [['Hanitra', 'Rakoto'], ['Mamy', 'Andrianina'], ['Voahangy', 'Ravelo'], ['Tahina', 'Randria'], ['Jean', 'Dupont'], ['Maria', 'Gonzalez']];
const guests: string[] = [];
for (const [firstName, lastName] of names) {
  guests.push((await must('POST', '/api/v1/guests', { firstName, lastName, email: `${firstName}.${lastName}@example.test`.toLowerCase() })).id as string);
}

// 5. Réservations autour d'aujourd'hui (fuseau de l'hôtel)
const today = todayIn('Indian/Antananarivo');
const plan: Array<{ guest: number; cat: string; from: number; nights: number; adults: number; source: string }> = [
  { guest: 0, cat: std, from: 0, nights: 2, adults: 2, source: 'phone' },
  { guest: 1, cat: dlx, from: 1, nights: 3, adults: 2, source: 'direct' },
  { guest: 2, cat: std, from: 2, nights: 4, adults: 1, source: 'website' },
  { guest: 3, cat: ste, from: 3, nights: 5, adults: 4, source: 'phone' },
  { guest: 4, cat: dlx, from: 6, nights: 2, adults: 2, source: 'direct' },
  { guest: 5, cat: std, from: 9, nights: 3, adults: 2, source: 'website' },
];
for (const r of plan) {
  await must('POST', '/api/v1/reservations', {
    guestId: guests[r.guest], source: r.source,
    rooms: [{ categoryId: r.cat, checkIn: addDays(today, r.from), checkOut: addDays(today, r.from + r.nights), adults: r.adults }],
  });
}

console.log(`\n✔ Hôtel de démonstration créé : ${HOTEL}`);
console.log(`   ${3} catégories, 12 chambres, ${names.length} clients, ${plan.length} réservations`);
console.log(`   Connexion :  ${EMAIL}`);
console.log(`   Mot de passe : ${PASSWORD}${generated ? '   (généré : notez-le, il ne sera plus affiché)' : ''}`);
