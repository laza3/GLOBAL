# Sauvegardes et restauration

Une sauvegarde qui n'a jamais été restaurée est une hypothèse, pas une sauvegarde. Le dispositif comporte **trois couches** et **un test mensuel**.

| Couche | Protège contre | Fréquence | Où |
|---|---|---|---|
| 1. Historique du fournisseur de base (Neon : restauration à un instant donné) | Erreur humaine récente (suppression, mauvaise manipulation) | Continue | Chez le fournisseur ; durée de l'historique selon l'offre (à vérifier dans Neon → Settings) |
| 2. **Sauvegarde chiffrée nocturne** (GitHub Actions → stockage externe) | Perte du fournisseur, compte piraté, erreur ancienne | Chaque nuit, 02:17 UTC | Cloudflare R2 ou Backblaze B2 (**hors** de Neon et de Vercel) |
| 3. **Sauvegarde automatique avant chaque migration de production** | Migration défectueuse | À chaque mise en Production | Même stockage |

**Les clés sont aussi importantes que les données.** `ENCRYPTION_KEY` (numéros de pièces d'identité) et `BACKUP_PASSPHRASE` (déchiffrement des sauvegardes) doivent être conservées **hors de l'ordinateur et hors de Vercel/GitHub** : gestionnaire de mots de passe + copie papier dans un lieu sûr. Sans elles, les données chiffrées sont définitivement illisibles.

## Mise en place GRATUITE, sans carte (recommandée pour démarrer)

La sauvegarde nocturne fonctionne **sans stockage externe** : la copie chiffrée est conservée comme « artefact » GitHub pendant 30 jours, et **chaque nuit** un test prouve qu'elle se restaure (sur un PostgreSQL jetable fourni par GitHub : même votre réseau bloquant le port 5432 n'est pas un problème).

1. Mettez le dépôt à jour (commande d'extraction du guide), pour que le fichier `.github/workflows/backup.yml` soit dans votre dépôt GitHub.
2. Récupérez l'adresse **directe** de la base de production : Neon → projet `hmp-production` → **Connect** → décochez « Connection pooling » → copiez l'adresse avec le mot de passe (c'est la ligne `DATABASE_ADMIN_URL` du fichier `online-production-admin.txt`).
3. Créez le mot de passe de chiffrement : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Conservez-le à part** (gestionnaire de mots de passe) : sans lui, aucune sauvegarde ne peut être déchiffrée.
4. GitHub → dépôt → **Settings → Environments → New environment** : `production`. Ajoutez deux **secrets** : `DATABASE_ADMIN_URL` et `BACKUP_PASSPHRASE`.
5. **Actions → « Sauvegarde de la base » → Run workflow** (`production`). Après 2 à 3 minutes, la pastille est verte, le journal affiche « Restauration vérifiée : … tables… » et, en bas de la page, un **artefact** `sauvegarde-production-…` est disponible.
6. Vérifiez que la branche par défaut du dépôt est `main` (Settings → Branches) : GitHub ne lance les tâches planifiées que depuis elle. Gardez les notifications d'échec activées (profil GitHub → Settings → Notifications → Actions).

Limites : 30 jours d'historique, et les copies restent chez GitHub. Pour une copie **hors de GitHub**, ajoutez plus tard les secrets S3 ci-dessous.

## Mise en place de la couche 2 avec stockage externe (facultatif)

1. Ouvrez un compte **Cloudflare** → R2 → **Create bucket** `hmp-backups` (ou Backblaze B2, compatible S3).
2. Créez un **jeton d'accès API** limité à ce bucket (lecture et écriture) : notez `Access Key ID`, `Secret Access Key` et l'adresse du point d'accès (`https://IDENTIFIANT.r2.cloudflarestorage.com`).
3. Dans le bucket, ajoutez une **règle de cycle de vie** : supprimer les objets après **90 jours** (durée de conservation).
4. Générez `BACKUP_PASSPHRASE` : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` et **conservez-la à part** (voir plus haut).
5. GitHub → Settings → Environments → `production` → Secrets : `DATABASE_ADMIN_URL`, `BACKUP_PASSPHRASE`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
6. Actions → **« Sauvegarde de la base » → Run workflow** : doit réussir et déposer `production/hmp-AAAAMMJJ….dump.gpg` dans le bucket. Si un secret manque, le travail **échoue visiblement** (GitHub vous écrit) : jamais de sauvegarde silencieusement absente.
7. Réglez dans le workflow `PG_CLIENT_MAJOR` si votre base n'est pas en PostgreSQL 16.

Les sauvegardes contiennent des données personnelles : elles sont **chiffrées (AES-256)** avant de quitter GitHub. Une demande de suppression de données d'un client ne disparaît des sauvegardes qu'à leur expiration (90 jours) : mentionnez-le dans votre politique de confidentialité.

## Sauvegarde manuelle (avant une opération risquée)

Dans Git Bash, avec les outils PostgreSQL (`export PATH="/c/Program Files/PostgreSQL/16/bin:$PATH"`) :

```bash
DATABASE_ADMIN_URL="ADRESSE_DIRECTE" BACKUP_DIR=./backups scripts/backup.sh
```

Le fichier `backups/hmp-….dump` n'est **jamais publié** (ignoré par Git). Le script vérifie qu'il est lisible.

## Restaurer

**Cas A — petite erreur récente** (quelques heures) : Neon → votre projet → **Restore** à un instant précédant l'erreur (de préférence vers une *nouvelle branche*, vérifiez, puis basculez). Documentez l'heure de l'incident.

**Cas B — la base est perdue ou corrompue** (restauration depuis une sauvegarde chiffrée : artefact GitHub — page de l'exécution, section *Artifacts* — ou stockage externe). Faites-le depuis un **Codespace** (votre réseau bloque peut-être le port 5432) après `sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && sudo apt-get install -y postgresql-client-16` :

1. Téléchargez le dernier `….dump.gpg` depuis le bucket.
2. Déchiffrez (Git Bash ; `gpg` est fourni avec Git for Windows) :

```bash
gpg --batch --pinentry-mode loopback --passphrase "VOTRE_BACKUP_PASSPHRASE" -o hmp.dump -d hmp-AAAAMMJJTHHMMSSZ.dump.gpg
```

3. Créez une **nouvelle base** (nouveau projet Neon), exécutez `deploy/prepare-managed-db.sql` (rôles), puis :

```bash
scripts/restore.sh hmp.dump "ADRESSE_DIRECTE_DE_LA_NOUVELLE_BASE/neondb"
```

   La restauration refuse d'écraser une base qui contient déjà des données ; en cas d'échec elle supprime la base partielle.
4. Redonnez un mot de passe aux deux rôles (`ALTER ROLE hmp_app LOGIN PASSWORD …`, `ALTER ROLE hmp_platform LOGIN PASSWORD …`), mettez à jour `DATABASE_URL_APP` / `DATABASE_URL_PLATFORM` dans Vercel (et GitHub), puis **Redeploy**.
5. Le marqueur d'environnement est restauré avec la base : une sauvegarde de Production ne démarrera **que** sous `APP_ENV=production`. Une API de Staging la refusera : c'est le comportement voulu (données réelles interdites en test).

**Ne restaurez jamais des données de Production dans Staging** pour « tester avec du vrai » : ce sont des données personnelles de vrais clients. Utilisez la démonstration.

## Test mensuel de restauration (obligatoire)

Une fois par mois, et **après chaque changement de base** :

```bash
DATABASE_ADMIN_URL="ADRESSE_DIRECTE" BACKUP_DIR=./backups scripts/verify-backup.sh
```

Il restaure la dernière sauvegarde dans une base jetable, compare les comptages, vérifie que les **droits des rôles applicatifs** sont conservés (sans quoi l'application ne pourrait pas utiliser la base restaurée), puis supprime la base jetable. Notez la date du test dans votre journal d'exploitation.

## Ce qui a été répété

Panne simulée sur un serveur PostgreSQL 16 séparé, avec un compte **non-superuser** comme chez un hébergeur : hôtel de démonstration → sauvegarde → restauration dans une **nouvelle** base → API sur les rôles à moindre privilège → connexion, 6 réservations et 12 chambres retrouvées. **Non vérifié** : l'envoi vers un stockage S3 réel et la restauration chez Neon (à faire lors du premier test sur Staging).
