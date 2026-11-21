/**
 * Crée le (premier) super-administrateur de la plateforme. Il n'existe AUCUN compte par défaut et aucune route publique
 * ne permet d'en créer : cette commande est la seule voie, et elle exige l'accès d'administration à la base.
 *
 *   DATABASE_ADMIN_URL=postgres://…  ADMIN_EMAIL=vous@exemple.mg  ADMIN_NAME="Votre Nom"  pnpm --filter @hmp/api create-admin
 *
 * Le mot de passe est saisi à l'invite (masqué) — jamais en argument de ligne de commande (il resterait dans l'historique du
 * shell). Pour l'automatisation, ADMIN_PASSWORD est accepté en variable d'environnement.
 */
import { createInterface } from 'node:readline';
import pg from 'pg';
import { AppError } from '../src/errors';
import { assertStrongPassword, hashPassword } from '../src/lib/security';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    let muted = false;
    const original = out._writeToOutput.bind(rl);
    out._writeToOutput = (s: string) => { if (!muted) original(s); };
    rl.question(label, (answer) => { muted = false; out.output.write('\n'); rl.close(); resolve(answer); });
    muted = true;
  });
}

const url = process.env.DATABASE_ADMIN_URL ?? fail("DATABASE_ADMIN_URL est requis (compte d'administration de la base).");
const email = (process.env.ADMIN_EMAIL ?? fail('ADMIN_EMAIL est requis.')).trim().toLowerCase();
const fullName = (process.env.ADMIN_NAME ?? fail('ADMIN_NAME est requis.')).trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ADMIN_EMAIL n\'est pas une adresse valide.');
if (fullName.length < 2) fail('ADMIN_NAME est trop court.');

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) fail('Aucun terminal : fournissez ADMIN_PASSWORD, ou lancez la commande dans un terminal pour saisir le mot de passe à l\'invite.');
  password = await promptHidden('Mot de passe (10 caractères minimum, lettres et chiffres) : ');
  const confirm = await promptHidden('Confirmez le mot de passe : ');
  if (password !== confirm) fail('Les deux saisies ne correspondent pas.');
}
try {
  assertStrongPassword(password, email);
} catch (e) {
  fail(e instanceof AppError ? 'Mot de passe trop faible : 10 caractères minimum, avec au moins une lettre et un chiffre, et ni votre e-mail ni un mot de passe courant.' : String(e));
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rowCount } = await client.query(
    'INSERT INTO platform_admins (email, full_name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
    [email, fullName, await hashPassword(password)],
  );
  if (!rowCount) fail(`Un administrateur existe déjà avec l'adresse ${email} : rien n'a été modifié.`);
  console.log(`Super-administrateur créé : ${email}`);
} finally {
  await client.end();
}
