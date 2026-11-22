#!/usr/bin/env node
/**
 * Construit l'installateur Windows « HotelManagerPro-Setup-<version>.exe » : UN seul fichier qui installe tout (le logiciel, sa base
 * de données PostgreSQL, Node.js) chez un client, sans rien d'autre à installer. Voir docs/installateur-windows.md.
 *
 *   node scripts/build-windows-installer.mjs                 construit l'installateur (à lancer sous Windows ; NSIS requis)
 *   node scripts/build-windows-installer.mjs --payload-only  assemble seulement le paquet (test sous Linux/macOS : pas de runtime, pas de .exe)
 *   options : --skip-web-build (réutilise apps/web/dist)
 *
 * Sortie : build/installateur/payload/ (le paquet) puis build/installateur/HotelManagerPro-Setup-<version>.exe
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build', 'installateur');
const PAYLOAD = join(OUT, 'payload');
const CACHE = join(ROOT, 'build', 'cache');
const ARGS = process.argv.slice(2);
const PAYLOAD_ONLY = ARGS.includes('--payload-only');
const WIN = process.platform === 'win32';
const VERSION = process.env.HMP_VERSION ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
// PostgreSQL 16 : binaires officiels EDB (zip), avec les extensions « contrib » (btree_gist, citext) dont les migrations ont besoin.
const PG_ZIP = process.env.HMP_PG_ZIP_URL ?? 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip';
const VCREDIST = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: WIN && !/\.exe"?$/i.test(cmd), ...opts });
const step = (m) => console.log(`\n▸ ${m}`);
const size = (dir) => { let n = 0; for (const f of readdirSync(dir, { withFileTypes: true })) n += f.isDirectory() ? size(join(dir, f.name)) : f.isSymbolicLink() ? 0 : lstatSync(join(dir, f.name)).size; return n; };
const mo = (n) => `${(n / 1048576).toFixed(0)} Mo`;

async function download(url, file, attempts = 6) {
  if (existsSync(file) && statSync(file).size > 1_000_000) { console.log(`  (déjà téléchargé : ${file})`); return; }
  mkdirSync(dirname(file), { recursive: true });
  console.log(`  téléchargement : ${url}`);
  // Les gros téléchargements sont parfois coupés par le réseau : on réessaie ; le fichier n'est écrit qu'une fois COMPLET.
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok) throw new Error(`code ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      const why = e?.cause?.code ?? e?.message ?? String(e);
      if (i >= attempts) throw new Error(`Téléchargement impossible après ${attempts} essais (${why}) : ${url}`);
      console.log(`  ✘ interrompu (${why}) — nouvel essai ${i + 1}/${attempts} dans ${3 * i} s`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(PAYLOAD, 'app'), { recursive: true });

/* ---------------------------------------------------------------------------------------------- interface web */
if (!ARGS.includes('--skip-web-build')) { step('Interface web'); run('pnpm', ['--filter', '@hmp/web', 'build']); }
cpSync(join(ROOT, 'apps', 'web', 'dist'), join(PAYLOAD, 'app', 'web'), { recursive: true });

/* ---------------------------------------------------------------------------------------------- serveur et lanceur (esbuild) */
step('Serveur et lanceur (esbuild)');
const thirdParty = new Set();
for (const dir of ['apps/api', 'packages/db', 'packages/shared']) {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.dependencies ?? {})) if (!name.startsWith('@hmp/')) thirdParty.add(name);
}
const { build } = createRequire(join(ROOT, 'apps', 'api', 'package.json'))('esbuild');
for (const [entry, outfile] of [['apps/api/src/index.ts', 'server.mjs'], ['apps/api/scripts/launcher.ts', 'launcher.mjs']]) {
  await build({
    entryPoints: [join(ROOT, entry)], outfile: join(PAYLOAD, 'app', outfile), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: [...thirdParty].flatMap((n) => [n, `${n}/*`]),
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    legalComments: 'none', logLevel: 'warning',
  });
}

step('Bibliothèques tierces de production (pnpm deploy, structure à plat)');
const tmp = join(OUT, '_deploy');
run('pnpm', ['--filter', '@hmp/api', '--config.node-linker=hoisted', 'deploy', '--prod', '--legacy', tmp]);
cpSync(join(tmp, 'node_modules'), join(PAYLOAD, 'app', 'node_modules'), { recursive: true });
rmSync(join(PAYLOAD, 'app', 'node_modules', '@hmp'), { recursive: true, force: true }); // déjà regroupés dans les fichiers .mjs
rmSync(join(PAYLOAD, 'app', 'node_modules', '.bin'), { recursive: true, force: true }); // raccourcis de développement : inutiles et fragiles
rmSync(tmp, { recursive: true, force: true });

// Élagage : tests, exemples, documentation et fichiers de types des bibliothèques ne servent pas à l'exécution (paquet plus léger,
// et NSIS n'a plus à traiter des fichiers de test aux noms inhabituels).
// Seulement des dossiers qui ne sont JAMAIS du code d'exécution (attention : « doc » ou « docs » peuvent l'être, ex. yaml/dist/doc).
const JUNK_DIRS = new Set(['test', 'tests', '__tests__', '.github', 'benchmark', 'benchmarks']);
const JUNK_FILE = /\.(md|markdown|map)$|\.d\.[cm]?ts$/i;
let pruned = 0;
(function prune(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink() || (e.isDirectory() && JUNK_DIRS.has(e.name)) || (e.isFile() && JUNK_FILE.test(e.name))) { rmSync(full, { recursive: true, force: true }); pruned++; }
    else if (e.isDirectory()) prune(full);
  }
})(join(PAYLOAD, 'app', 'node_modules'));
console.log(`  ${pruned} éléments inutiles retirés des bibliothèques`);

cpSync(join(ROOT, 'packages', 'db', 'migrations'), join(PAYLOAD, 'app', 'migrations'), { recursive: true });
writeFileSync(join(PAYLOAD, 'app', 'version.txt'), `${VERSION}\n`);
// Package « module » pour que Node traite server.mjs / launcher.mjs comme des modules ES
writeFileSync(join(PAYLOAD, 'app', 'package.json'), JSON.stringify({ type: 'module', private: true }));

/* ---------------------------------------------------------------------------------------------- fichiers de lancement (double-clic) */
step('Fichiers de lancement');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const cmd = (name, body) => writeFileSync(join(PAYLOAD, name), crlf(body));
cmd('Lancer.cmd', `@echo off
chcp 65001 >nul
title Hotel Manager Pro
cd /d "%~dp0"
"runtime\\node.exe" "app\\launcher.mjs" %*
if errorlevel 1 (
  echo.
  echo Une erreur s'est produite. Notez le message ci-dessus et contactez l'editeur.
  pause
)
`);
cmd('Sauvegarder.cmd', `@echo off
chcp 65001 >nul
title Hotel Manager Pro - Sauvegarde
cd /d "%~dp0"
if /i "%~1"=="auto" goto auto
if exist "copie-supplementaire.txt" goto lancer
echo Copie de securite des donnees de l'hotel.
echo.
echo Pour une COPIE SUPPLEMENTAIRE sur une cle USB ou un disque externe,
echo tapez son dossier (exemple : E:\\Sauvegardes-Hotel)
set "DEST="
set /p DEST=ou appuyez sur Entree pour ignorer :
if defined DEST if "%DEST:~-1%"=="\\" set "DEST=%DEST:~0,-1%"
if defined DEST goto avec
:lancer
"runtime\\node.exe" "app\\launcher.mjs" backup
goto fin
:avec
"runtime\\node.exe" "app\\launcher.mjs" backup --vers "%DEST%"
goto fin
:auto
"runtime\\node.exe" "app\\launcher.mjs" backup --auto
exit /b 0
:fin
echo.
echo Appuyez sur une touche pour fermer cette fenetre.
pause >nul
`);
cmd('Restaurer.cmd', `@echo off
chcp 65001 >nul
title Hotel Manager Pro - Restauration
cd /d "%~dp0"
echo ATTENTION : cette operation REMPLACE les donnees de l'hotel par celles d'une sauvegarde.
echo Fermez d'abord Hotel Manager Pro.
echo.
echo Tapez le chemin du fichier de sauvegarde (ex : E:\\Sauvegardes-Hotel\\hmp-20260101-130000.dump)
set "F="
set /p F=ou appuyez sur Entree pour prendre la plus recente de ce PC :
if defined F goto avec
"runtime\\node.exe" "app\\launcher.mjs" restore
goto fin
:avec
"runtime\\node.exe" "app\\launcher.mjs" restore "%F%"
:fin
echo.
pause
`);
cmd('Creer-compte-editeur.cmd', `@echo off
chcp 65001 >nul
title Hotel Manager Pro - Compte editeur
cd /d "%~dp0"
"runtime\\node.exe" "app\\launcher.mjs" admin
echo.
pause
`);
cmd('Arreter.cmd', `@echo off
chcp 65001 >nul
cd /d "%~dp0"
"runtime\\node.exe" "app\\launcher.mjs" stop
timeout /t 3 >nul
`);
writeFileSync(join(PAYLOAD, 'LISEZMOI.txt'), crlf(`Hotel Manager Pro - version locale (${VERSION})

Demarrer           : double-clic sur "Hotel Manager Pro" (bureau ou menu Demarrer). Ne fermez pas la fenetre noire tant que l'hotel travaille.
Autres appareils   : l'adresse a taper dans le navigateur (ex. http://192.168.1.20:5173) est affichee dans la fenetre noire.
Sauvegarde         : double-clic sur "Sauvegarder Hotel Manager Pro". Copiez le dossier "sauvegardes" sur une cle USB.
Restauration       : "Restaurer Hotel Manager Pro" (apres avoir ferme le logiciel).
Donnees de l'hotel : dossier "donnees" - ne jamais le supprimer ni le deplacer.
`));

if (PAYLOAD_ONLY) { console.log(`\n✔ Paquet assemblé (${mo(size(PAYLOAD))}) : ${PAYLOAD}`); process.exit(0); }

/* ---------------------------------------------------------------------------------------------- runtime : Node.js + PostgreSQL + VC++ */
step('Node.js (exécutable)');
mkdirSync(join(PAYLOAD, 'runtime', 'pg'), { recursive: true });
if (WIN) cpSync(process.execPath, join(PAYLOAD, 'runtime', 'node.exe'));
else { await download(`https://nodejs.org/dist/v${process.versions.node}/win-x64/node.exe`, join(CACHE, `node-${process.versions.node}.exe`)); cpSync(join(CACHE, `node-${process.versions.node}.exe`), join(PAYLOAD, 'runtime', 'node.exe')); }

step('PostgreSQL 16 (binaires)');
const zip = join(CACHE, 'postgresql-binaries.zip');
await download(PG_ZIP, zip);
const extracted = join(CACHE, 'pg-extracted');
rmSync(extracted, { recursive: true, force: true });
mkdirSync(extracted, { recursive: true });
// Windows : « tar.exe » de Windows (bsdtar, lit les .zip). Celui de Git Bash (GNU tar), prioritaire dans le PATH, prend « D:\… » pour un serveur distant.
if (WIN) run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', extracted]); else run('unzip', ['-q', zip, '-d', extracted]);
const pgRoot = join(extracted, 'pgsql');
if (!existsSync(join(pgRoot, 'bin', 'postgres.exe'))) throw new Error('Archive PostgreSQL inattendue : bin/postgres.exe introuvable.');
for (const d of ['bin', 'lib', 'share']) cpSync(join(pgRoot, d), join(PAYLOAD, 'runtime', 'pg', d), { recursive: true });
rmSync(join(PAYLOAD, 'runtime', 'pg', 'share', 'doc'), { recursive: true, force: true });
rmSync(join(PAYLOAD, 'runtime', 'pg', 'share', 'locale'), { recursive: true, force: true }); // traductions des messages de PostgreSQL : inutiles
await download(VCREDIST, join(CACHE, 'vc_redist.x64.exe'));
cpSync(join(CACHE, 'vc_redist.x64.exe'), join(PAYLOAD, 'runtime', 'vc_redist.x64.exe'));

/* ---------------------------------------------------------------------------------------------- installateur (NSIS) */
step('Installateur (NSIS)');
const makensis = [process.env.MAKENSIS, 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe', 'makensis'].filter(Boolean).find((c) => { try { execFileSync(c, ['/VERSION'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!makensis) throw new Error('NSIS introuvable : installez-le (Windows : choco install nsis).');
const outfile = join(OUT, `HotelManagerPro-Setup-${VERSION}.exe`);
run(makensis, [`/DVERSION=${VERSION}`, `/DPAYLOAD=${PAYLOAD}`, `/DOUTFILE=${outfile}`, `/DASSETS=${join(ROOT, 'installer')}`, join(ROOT, 'installer', 'hotel-manager-pro.nsi')]);
console.log(`\n✔ Installateur prêt : ${outfile}  (${mo(statSync(outfile).size)})`);
