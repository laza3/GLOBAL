# Guide pas à pas : mettre Hotel Manager Pro en ligne (Staging puis Production)

## Parcours express, gratuit : un seul environnement de test en ligne

Pour **voir le logiciel en ligne sans payer** : GitHub (dépôt privé), Neon (offre gratuite) et Vercel (offre Hobby). Comptez 1 heure. **Vercel Hobby est réservé aux tests et démonstrations** : pour de vrais hôtels qui paient, il faudra le plan Pro (voir plus bas). Les écrans de ces sites changent parfois de nom de bouton : cherchez le même réglage.

1. **Mettre à jour votre dossier** (Invite de commandes) : `cd /d %USERPROFILE%\Documents\GLOBAL\hotel-manager-pro` puis `git pull`.
2. **Comptes** (connectez-vous avec GitHub) : https://neon.tech et https://vercel.com (offre « Hobby »).
3. **Dépôt dédié** : sur GitHub, *New repository* `hotel-manager-pro`, **Private**, rien de coché. Puis, dans le dossier `GLOBAL` : clic droit → **Git Bash Here** :

```bash
bash hotel-manager-pro/scripts/extract-to-new-repo.sh https://github.com/laza3/hotel-manager-pro.git
```

4. **Base Neon** : *New project* `hmp-staging`, PostgreSQL 16, région **Frankfurt**. Bouton **Connect** : gardez la fenêtre ouverte (l'adresse contient un mot de passe : ne l'envoyez à personne).
5. **Travailler dans le nouveau dépôt** (Invite de commandes) :

```bash
cd /d %USERPROFILE%\Documents
git clone https://github.com/laza3/hotel-manager-pro.git
cd hotel-manager-pro
pnpm install
```

6. **Préparer la base en une commande** :

```bash
pnpm online:setup
```

   Elle demande : l'environnement (`staging`), l'adresse Neon (collez-la : des `*` s'affichent), le nom du projet Vercel (`hmp-staging`), puis votre e-mail, nom et mot de passe de **super-administrateur**. Elle crée les rôles, applique les 22 migrations, marque la base « staging », et écrit deux fichiers **secrets** dans le dossier (jamais publiés, jamais affichés dans le terminal) :
   - `online-staging-vercel.txt` : les réglages à coller dans Vercel ;
   - `online-staging-admin.txt` : l'adresse d'administration de la base (jamais dans Vercel).

   Relançable sans risque : les secrets déjà créés sont réutilisés. Si vous collez l'adresse de la mauvaise base, elle refuse.
7. **Projet Vercel** : *Add New → Project* → importez `hotel-manager-pro`. Nom `hmp-staging`, **Framework Preset : Other**, ne changez pas les commandes (`vercel.json` les fournit). Dans **Environment Variables**, collez tout le contenu de `online-staging-vercel.txt` dans le premier champ (Vercel sépare les lignes). **Deploy**.
8. **Régler la branche** : Settings → Git → **Production Branch** = `staging` → Save, puis Deployments → **Redeploy**.
9. **Vérifier** (dans Chrome) :
   - `https://hmp-staging.vercel.app/api/v1/meta` doit afficher `{"environment":"staging"}` ;
   - `/inscription` affiche le bandeau « Environnement de test » ;
   - `/platform/connexion` accepte votre super-administrateur.
   Si l'adresse réelle de Vercel est différente (nom déjà pris), corrigez `ALLOWED_ORIGINS` et `PUBLIC_URL` dans Vercel avec l'adresse exacte, puis **Redeploy**.
10. **Données de démonstration** (Invite de commandes) :

```bash
set API_URL=https://hmp-staging.vercel.app
set DEMO_ORIGIN=https://hmp-staging.vercel.app
pnpm api:seed-demo
```

   Connectez-vous avec l'e-mail et le mot de passe affichés sur la page d'accueil du site en ligne.

**Gardez précieusement** (gestionnaire de mots de passe) la ligne `ENCRYPTION_KEY` du fichier `online-staging-vercel.txt`. Ne mettez **pas de vraies données de clients** sur cet environnement de test.

**Limites du gratuit** : la base Neon gratuite se met en veille (premier chargement plus lent) et garde un historique de restauration court ; Vercel Hobby interdit l'usage commercial. Pour **Production** avec de vrais clients : plan Vercel **Pro**, offre Neon payante, sauvegardes (`docs/sauvegardes.md`), puis refaites le même parcours avec `production` (`pnpm online:setup` demande alors de taper PRODUCTION pour confirmer). Le reste de ce document décrit le parcours complet.

---

## Parcours complet (Staging et Production, avec automatisations GitHub)

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
