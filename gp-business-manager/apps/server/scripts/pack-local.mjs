// Prépare le dossier « GP-Serveur-Local » : serveur + site + node.exe + lanceur .bat (test sur le Wi-Fi local, sans Internet).
// À exécuter sous Windows (node.exe copié = celui qui exécute ce script).
import { cpSync, mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/GP-Serveur-Local');
if (!existsSync(resolve(root, 'dist/server.cjs'))) throw new Error('Lancez d’abord : npm run build -w @gp/server');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, 'dist/server.cjs'), resolve(out, 'server.cjs'));
cpSync(resolve(root, 'dist/public'), resolve(out, 'public'), { recursive: true });
copyFileSync(process.execPath, resolve(out, 'node.exe'));

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
writeFileSync(resolve(out, 'Demarrer-GP-Serveur.bat'), crlf(`@echo off
chcp 65001 >nul
title GP Business Manager - Serveur local de test
cd /d "%~dp0"
set GP_DATA_DIR=%~dp0donnees
set PORT=3000
set HOST=0.0.0.0
echo.
echo  ===== GP Business Manager - serveur de test =====
echo.
echo  Sur CET ordinateur :  http://localhost:3000
echo.
echo  Sur le TELEPHONE (connecte au MEME Wi-Fi), ouvrir dans le navigateur UNE de ces adresses :
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=* delims= " %%b in ("%%a") do echo      http://%%b:3000
echo.
echo  - Si Windows demande d'autoriser le reseau : cliquez "Autoriser l'acces" (reseaux prives).
echo  - Au PREMIER lancement, un CODE D'INSTALLATION s'affiche plus bas : il sera demande a la creation de l'entreprise.
echo  - Ne fermez pas cette fenetre : elle fait tourner le serveur. Pour arreter : fermez-la.
echo.
node.exe --disable-warning=ExperimentalWarning server.cjs
echo.
echo Le serveur s'est arrete.
pause
`));
writeFileSync(resolve(out, 'Reinitialiser-mot-de-passe.bat'), crlf(`@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GP_DATA_DIR=%~dp0donnees
set /p NEWPW=Nouveau mot de passe administrateur (8 caracteres minimum) : 
node.exe --disable-warning=ExperimentalWarning server.cjs --reset-password=%NEWPW%
pause
`));
writeFileSync(resolve(out, 'LISEZ-MOI.txt'), crlf(`GP Business Manager - serveur local de TEST
==========================================

1. Double-cliquez sur "Demarrer-GP-Serveur.bat". Une fenetre noire s'ouvre et reste ouverte (c'est le serveur).
2. Sur l'ordinateur : ouvrez http://localhost:3000 dans un navigateur.
3. Sur le telephone (meme Wi-Fi que l'ordinateur) : ouvrez l'adresse http://192.168.x.x:3000 affichee dans la fenetre.
4. Premiere fois : creez l'entreprise. Le "code d'installation" est affiche dans la fenetre noire.

A savoir
- Les donnees sont dans le dossier "donnees" (a cote de ces fichiers). Copiez-le pour sauvegarder.
- Ce serveur sert a TESTER sur votre reseau local. Pour vos clients, il faudra un vrai serveur en ligne (HTTPS).
- Les donnees de ce serveur sont separees de celles du logiciel Windows installe : elles ne se melangent pas.
- Aucun acces Internet n'est necessaire. Tous les appareils doivent etre sur le meme Wi-Fi/reseau.
- Si le telephone n'arrive pas a se connecter : verifiez le meme Wi-Fi, autorisez node.exe dans le pare-feu Windows (reseau prive), ou desactivez l'"isolation des clients" du routeur.
- Mot de passe administrateur oublie : double-cliquez sur "Reinitialiser-mot-de-passe.bat".
`));
console.log('✔ dossier prêt :', out);
