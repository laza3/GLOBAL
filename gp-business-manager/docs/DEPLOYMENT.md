# DEPLOYMENT — Application Windows

## Produire l'installateur
Prérequis : Node ≥ 22.13, npm. Depuis la racine du monorepo :
```bash
npm install
npm run desktop:dist        # = build (esbuild + Vite) puis electron-builder --win --x64
# → apps/desktop/release/GP-Business-Manager-Setup-<version>.exe  (NSIS, x64)
```
- **Depuis Windows** : aucune dépendance supplémentaire.
- **Depuis Linux/CI** : l'installateur NSIS nécessite Wine (génération du désinstalleur) :
  ```bash
  sudo dpkg --add-architecture i386 && sudo apt-get update
  sudo apt-get install -y wine64 wine32:i386 xvfb
  WINEDEBUG=-all xvfb-run -a npm run desktop:dist
  ```
  Le build de l'application n'utilise **aucun module natif** (SQLite = `node:sqlite` d'Electron) : pas de compilation croisée.
- Taille ≈ 120 Mo (runtime Electron/Chromium inclus). Installation par utilisateur (pas d'élévation), dossier modifiable, raccourcis bureau + menu Démarrer, langues FR/EN. La désinstallation **conserve les données** (`deleteAppDataOnUninstall: false`).

## Emplacement des données (par utilisateur Windows)
| Contenu | Chemin |
|---|---|
| Base de données | `%APPDATA%\GP Business Manager\data\gp-business.db` (+ `-wal`, `-shm`) |
| Sauvegardes automatiques | `%APPDATA%\GP Business Manager\backups\auto-AAAA-MM-JJ.db` (14 jours) |
| Journal technique | `%APPDATA%\GP Business Manager\gp.log` |
Variable `GP_DB_PATH` : surcharge l'emplacement de la base (tests, poste de démonstration).

## Repartir de zéro (nouvelle entreprise sur un poste déjà utilisé)
La désinstallation **conserve** les données. Pour retrouver l'écran de bienvenue : application fermée, renommer `%APPDATA%\GP Business Manager` (ex. en `GP Business Manager ancien` — réversible), puis relancer. Dossier d'installation par défaut : `%LOCALAPPDATA%\Programs\GP Business Manager\` (en cas de doute : clic droit sur le raccourci → Propriétés).

## Signature de code (recommandé avant diffusion commerciale)
Sans certificat, Windows SmartScreen affiche « Éditeur inconnu ». Acquérir un certificat de signature de code (OV ou EV), puis configurer `CSC_LINK` / `CSC_KEY_PASSWORD` (ou signature Azure Trusted Signing) avant `desktop:dist`. electron-builder signera l'exécutable et l'installateur automatiquement. **Ne jamais commiter** le certificat ni ses mots de passe.

## Mises à jour
Non implémentées. Plan : `electron-updater` + serveur de publication HTTPS, paquets signés, migrations de schéma automatiques (déjà en place : `schema_migrations`, appliquées au démarrage, avec sauvegarde préalable à ajouter).

## Impression
Tickets 80 mm et factures A4 passent par le pilote d'impression Windows (`webContents.print`). Choisir l'imprimante thermique comme imprimante par défaut du poste. Impression silencieuse : option « Imprimer automatiquement » (Paramètres → Tickets & caisse). Ouverture automatique du tiroir-caisse (commande ESC/POS) : **non implémentée**.

## Matériel testé
Lecteur de codes-barres : tout lecteur « clavier » (HID) terminant par Entrée. **Non testé sur matériel réel** dans l'environnement de développement.

## Déploiements serveur (futur)
Docker Compose (PostgreSQL + API NestJS + web) sera documenté lors de la phase API. Voir ARCHITECTURE.md §6.
