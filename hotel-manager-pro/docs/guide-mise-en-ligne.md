# Guide pas à pas : mettre Hotel Manager Pro en ligne (Staging puis Production)

À faire **une seule fois**. Comptez une demi-journée. Faites d'abord **tout Staging**, validez-le, puis répétez pour Production. Les écrans des sites tiers (GitHub, Neon, Vercel) changent de temps en temps : si un bouton porte un autre nom, cherchez le même réglage.

> **Avant de commencer, trois points de coût.** Vercel **Hobby** est réservé à un usage **non commercial** : pour Production, prévoyez le plan **Pro**. Neon gratuit met la base en veille quand elle est inactive (premier accès plus lent) et limite l'historique de restauration : prévoyez une offre payante pour Production. Un stockage de sauvegardes (Cloudflare R2 ou Backblaze B2) coûte quelques centimes par mois.

## A. GitHub : un dépôt dédié, sans copie du code

1. Sur github.com → **New repository** : nom `hotel-manager-pro`, **Private**. **Ne cochez rien** (ni README, ni .gitignore, ni licence).
2. Dans le dossier `GLOBAL` de votre ordinateur : clic droit → **Git Bash Here**, puis :

```bash
bash hotel-manager-pro/scripts/extract-to-new-repo.sh https://github.com/laza3/hotel-manager-pro.git
```

   Le script reprend **tout l'historique du logiciel** (sans la vidéo) et crée les branches `main` (Production) et `staging` (Tests). Il ne supprime rien : `GLOBAL` reste en l'état, comme archive.
3. Sur GitHub, dépôt `hotel-manager-pro` → **Settings → Branches** (ou *Rules*) :
   - **Default branch** = `main`.
   - Règle de protection pour `main` **et** `staging` : *Require a pull request before merging*, *Require status checks to pass* (cochez `test` et `e2e` une fois la première vérification passée), *Block force pushes*. Vous ne pourrez ainsi plus casser Production par un envoi direct.
4. Travaillez désormais dans le nouveau dépôt :

```bash
cd /d %USERPROFILE%\Documents
git clone https://github.com/laza3/hotel-manager-pro.git
cd hotel-manager-pro
pnpm install
pnpm local:setup
pnpm local:start
```

## B. Neon : deux bases séparées

Pour **chaque** environnement (d'abord `hmp-staging`) :

1. https://neon.tech → **New project** : nom `hmp-staging` (puis `hmp-production`), PostgreSQL **16**, région **Frankfurt (aws-eu-central-1)**. Deux **projets** distincts (pas deux « branches » du même projet) : identifiants, historique et sauvegardes indépendants.
2. Bouton **Connect** : notez les deux adresses (de la forme `postgres://utilisateur:motdepasse@…/neondb?sslmode=require`) :
   - **Direct** (sans pooleur) = `DATABASE_ADMIN_URL` (migrations, sauvegardes) ;
   - **Pooled** (hôte contenant `-pooler`) : sert de base aux adresses de l'application, voir 4.
3. **SQL Editor** : collez le contenu du fichier `deploy/prepare-managed-db.sql`, exécutez. (Il crée les rôles `hmp_owner`, `hmp_app`, `hmp_platform` et autorise les migrations. Relançable sans risque.)
4. Générez deux mots de passe (`randomBytes(24).toString('hex')`, voir `docs/environnements.md`), puis dans le **SQL Editor** :

```sql
ALTER ROLE hmp_app LOGIN PASSWORD 'MOT_DE_PASSE_1';
ALTER ROLE hmp_platform LOGIN PASSWORD 'MOT_DE_PASSE_2';
```

   Construisez ensuite les deux adresses de l'application en remplaçant, dans l'adresse **Pooled**, l'utilisateur et le mot de passe :
   `DATABASE_URL_APP=postgres://hmp_app:MOT_DE_PASSE_1@…-pooler…/neondb?sslmode=require` et `DATABASE_URL_PLATFORM=postgres://hmp_platform:MOT_DE_PASSE_2@…-pooler…/neondb?sslmode=require`.

## C. GitHub : environnements et secrets

Dépôt → **Settings → Environments** → créez `staging` et `production`.
- `production` : activez **Required reviewers** (vous) et limitez **Deployment branches** à `main` : toute migration de production attendra votre clic.
- Ajoutez les secrets listés dans `docs/environnements.md` (au minimum `DATABASE_ADMIN_URL` pour chaque environnement).

## D. Créer les tables et le premier compte

1. GitHub → **Actions → « Migrations de la base » → Run workflow** → `staging`. Succès = les 22 migrations sont appliquées et la base est marquée « staging ». (Pour Production : même chose avec `production` ; une sauvegarde automatique précède, puis votre approbation est demandée.)
2. Créez le **super-administrateur** de cet environnement depuis votre ordinateur (Invite de commandes) :

```bash
set DATABASE_ADMIN_URL=ADRESSE_DIRECTE_DE_CET_ENVIRONNEMENT
set ADMIN_EMAIL=vous@exemple.mg
set ADMIN_NAME=Votre Nom
pnpm api:create-admin
```

   Le mot de passe se saisit à l'invite (des `*` s'affichent). Fermez ensuite la fenêtre : les variables disparaissent.

## E. Vercel : deux projets, même dépôt

Pour **chaque** environnement :

1. https://vercel.com → connectez votre compte GitHub → **Add New → Project** → importez `hotel-manager-pro`.
2. Nom : `hmp-staging` (puis `hmp-production`). **Framework Preset : Other**. Laissez les commandes de construction par défaut : `vercel.json` les fournit.
3. **Environment Variables** : saisissez celles du tableau de `docs/environnements.md` **avant** le premier déploiement (`APP_ENV` = `staging` ou `production`, etc.). `ALLOWED_ORIGINS` et `PUBLIC_URL` = l'adresse exacte du projet (visible après création, par ex. `https://hmp-staging.vercel.app`) : si elle n'est pas connue d'avance, déployez une première fois, renseignez-la, puis **Redeploy**.
4. **Settings → Git → Production Branch** : `staging` pour `hmp-staging`, `main` pour `hmp-production`.
5. Déployez. Vérifiez :
   - `https://VOTRE-ADRESSE/api/v1/meta` répond `{"environment":"staging"}` (ou `"production"`) ;
   - `/inscription` affiche le bandeau « Environnement de test » (Staging uniquement) ;
   - `/platform/connexion` accepte le super-administrateur de l'étape D.
6. **Staging seulement** — données de démonstration :

```bash
set API_URL=https://VOTRE-ADRESSE-STAGING
set DEMO_ORIGIN=https://VOTRE-ADRESSE-STAGING
pnpm api:seed-demo
```

7. (Recommandé) **Ordre « base d'abord, code ensuite »** : dans le projet Vercel, *Settings → Git → Ignored Build Step → Don't build anything*, créez un **Deploy Hook** (branche `staging` ou `main`) et collez-le dans le secret GitHub `VERCEL_DEPLOY_HOOK` de l'environnement. Chaque fusion applique alors la migration puis déclenche le déploiement. Sans cela, Vercel déploie dès la fusion : les migrations doivent rester compatibles avec la version précédente (voir `docs/mises-a-jour.md`).

## F. Sauvegardes

Suivez `docs/sauvegardes.md` (stockage externe, secrets, premier test de restauration). **Ne pas ouvrir Production à un vrai client avant ce test.**

## G. Liste de contrôle avant le premier vrai hôtel

- [ ] Staging validé : inscription, connexion, démonstration, quelques réservations et une facture PDF.
- [ ] Production migrée, super-administrateur créé, adresse en **HTTPS**, `/api/v1/meta` répond « production ».
- [ ] Un hôtel de test créé **dans Production par vous-même** puis supprimé : jamais de démonstration en Production.
- [ ] **Prix des forfaits** modifiés dans la console (ceux fournis sont des exemples) ; **textes légaux** relus par un juriste (ce sont des modèles) ; coordonnées de l'éditeur renseignées.
- [ ] SMTP configuré (sans lui : pas de réinitialisation de mot de passe par e-mail).
- [ ] Double authentification (TOTP) activée sur le compte super-administrateur.
- [ ] Sauvegarde nocturne **réussie** (Actions) et **restauration testée** ; `ENCRYPTION_KEY` et `BACKUP_PASSPHRASE` conservées hors de l'ordinateur (gestionnaire de mots de passe + copie papier).
- [ ] Plan Vercel **Pro** et offre Neon adaptée à Production.
