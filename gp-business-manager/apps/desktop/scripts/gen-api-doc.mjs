// Génère docs/API.md (référence des endpoints) depuis le registre unique `core/api.ts`.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), 'gp-api-doc.cjs');
await build({ entryPoints: [resolve(root, '../../packages/core/src/api.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', external: ['node:sqlite'], logLevel: 'error' });
const { apiDefinitions } = createRequire(import.meta.url)(out);

const fields = (schema) => {
  if (!schema) return '—';
  let s = schema;
  for (let i = 0; i < 3 && s?._zod?.def && ['optional', 'nullable', 'default'].includes(s._zod.def.type); i++) s = s._zod.def.innerType;
  const shape = s?._zod?.def?.shape ?? s?.shape;
  if (!shape) return '`…`';
  return Object.entries(shape).map(([k, v]) => `\`${k}${v?._zod?.def?.type === 'optional' || v?._zod?.def?.type === 'pipe' ? '?' : ''}\``).join(', ') || '—';
};
const groups = {};
for (const [name, d] of Object.entries(apiDefinitions)) (groups[name.split('.')[0]] ??= []).push([name, d]);
let md = `# API interne — référence des endpoints

> Généré par \`npm run docs:api -w @gp/desktop\` depuis \`apps/desktop/../../packages/core/src/api.ts\` (registre unique).
> ${Object.keys(apiDefinitions).length} endpoints. Tous exigent une session authentifiée sauf \`app.status\`, \`app.setup\`, \`auth.login\`.

## Conventions

- **Transport** : IPC Electron \`window.gp.call(method, params)\` → enveloppe \`{ ok: true, data } | { ok: false, error: { code, message, details? } }\`.
- **Montants** : entiers en unité mineure (MGA : 1 Ar). **Quantités** : entiers en millièmes (\`qtyMilli\`: 1500 = 1,5).
- **Permissions** : vérifiées côté processus principal avant toute exécution. Un tableau signifie « l'une de ». Un refus est journalisé (\`security.forbidden\`).
- **Validation** : schéma Zod (les champs inconnus sont ignorés) ; un champ suffixé \`?\` est optionnel.
- **Codes d'erreur** : \`UNAUTHENTICATED\`, \`FORBIDDEN\`, \`VALIDATION\`, \`NOT_FOUND\`, \`DUPLICATE\`, \`IMMUTABLE_RECORD\`, \`INSUFFICIENT_STOCK\`, \`NO_SESSION\`, \`CREDIT_LIMIT\`, \`OVER_RETURN\`, \`INSUFFICIENT_FUNDS\`… (voir \`AppError\` dans \`core/util.ts\`).
- **Idempotence** : \`sales.create\` accepte un \`id\` fourni par le client ; rejouer le même \`id\` renvoie la vente existante (\`duplicate: true\`).
- **Cible REST** : ces mêmes noms/schémas deviendront les routes NestJS (\`POST /sales\`, …) lors de la phase API.

`;
for (const [g, list] of Object.entries(groups)) {
  md += `## ${g}\n\n| Endpoint | Permission | Paramètres |\n|---|---|---|\n`;
  for (const [name, d] of list) md += `| \`${name}\` | ${d.perm ? [].concat(d.perm).map((p) => `\`${p}\``).join(' ou ') : 'session'} | ${fields(d.schema)} |\n`;
  md += '\n';
}
mkdirSync(resolve(root, '../../docs'), { recursive: true });
writeFileSync(resolve(root, '../../docs/API.md'), md);
console.log(`✔ docs/API.md (${Object.keys(apiDefinitions).length} endpoints)`);
