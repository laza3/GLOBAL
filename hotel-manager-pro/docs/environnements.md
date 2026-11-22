# Les trois environnements (Development, Staging, Production)

**Un seul code source**, trois configurations. Rien n'est dupliqué : le même dépôt Git alimente votre ordinateur, le serveur de tests et le serveur commercial. Seuls changent la **branche Git**, la **base de données** et les **variables d'environnement**.

| | **Development** | **Staging** (tests en ligne) | **Production** (version commerciale) |
|---|---|---|---|
| Où | Votre ordinateur | Projet Vercel `hmp-staging` | Projet Vercel `hmp-production` |
| Branche Git | `feat/…` (vos modifications) | `staging` | `main` |
| `APP_ENV` / `NODE_ENV` | `development` / `development` | `staging` / `production` | `production` / `production` |
| Base de données | PostgreSQL local `hmp_dev` | Neon, projet `hmp-staging` | Neon, projet `hmp-production` |
| Données | **Fictives** (`pnpm api:seed-demo`) | **Fictives** (`pnpm api:seed-demo`) | **Réelles uniquement** : la démonstration est refusée |
| Secrets | Fichier `.env` (jamais publié) | Vercel (projet staging) + GitHub Environment `staging` | Vercel (projet production) + GitHub Environment `production` |
| E-mails | Aucun | Aucun ou boîte de test (Mailtrap) | Vrai serveur SMTP |
| Signe visible | — | Bandeau « Environnement de test » | Aucun |
| Qui y accède | Vous | Vous et vos testeurs | Les hôtels clients |

## Les garde-fous contre le mélange des données

1. **Une base distincte par environnement**, avec ses propres identifiants : Staging et Production ne partagent aucun mot de passe, aucune clé, aucune base.
2. **`APP_ENV` est obligatoire** dès que `NODE_ENV=production` : on ne peut pas se retrouver en « production » par oubli. Staging et Production gardent les réglages de sécurité de la production (cookies sécurisés `__Host-`, clé de chiffrement obligatoire).
3. **Marqueur d'environnement dans la base** (migration 0022) : la base mémorise l'environnement auquel elle appartient. L'API, le cycle de vie et la commande de migration comparent leur `APP_ENV` à ce marqueur et **refusent de démarrer ou de migrer** si la base est celle d'un autre environnement. Conséquences : une API de test branchée par erreur sur la base de production s'arrête ; une sauvegarde de production restaurée dans la base de test s'arrête aussi.
4. **Les données de démonstration sont refusées en production** : `pnpm api:seed-demo` interroge l'instance et s'arrête si elle répond « production ». Elles passent par l'API publique, jamais par une écriture directe dans la base.
5. **Bandeau « Environnement de test »** sur toutes les pages de Staging : impossible de croire qu'on saisit de vraies réservations.
6. **Secrets jamais dans Git** : `.env`, `.env.*`, `*.dump`, `.vercel/` sont ignorés (`.gitignore`) ; seuls les fichiers `*.example` sont versionnés.

> Un changement **volontaire** de marqueur (très rare, par exemple après une restauration vers un autre environnement) se fait avec le compte d'administration de la base :
> `UPDATE deployment_marker SET environment = 'staging'` — à ne jamais faire pour « faire passer » un message d'erreur : le message est précisément là pour vous arrêter.

## Variables d'environnement

Ce que l'on règle dans **Vercel** (Settings → Environment Variables), une valeur **différente** par projet :

| Variable | Valeur | Remarque |
|---|---|---|
| `NODE_ENV` | `production` | Staging aussi |
| `APP_ENV` | `staging` ou `production` | Doit correspondre au projet |
| `DATABASE_URL_APP` | `postgres://hmp_app:…@…-pooler…/…?sslmode=require` | Adresse **poolée** (pooleur du fournisseur) |
| `DATABASE_URL_PLATFORM` | `postgres://hmp_platform:…@…-pooler…/…?sslmode=require` | Adresse **poolée** |
| `CSRF_SECRET` | 48 octets aléatoires (base64) | Distinct par environnement |
| `ENCRYPTION_KEY` | 32 octets aléatoires (base64) | Distinct par environnement ; **à sauvegarder à part** |
| `ALLOWED_ORIGINS` | L'adresse exacte du site (`https://…`) | Sans `/` final |
| `PUBLIC_URL` | La même adresse | Liens des e-mails |
| `TRUST_PROXY` | `true` | Adresse IP réelle derrière Vercel |
| `DB_POOL_MAX_APP` / `DB_POOL_MAX_PLATFORM` | `3` / `2` | Chaque instance serverless a ses propres connexions |
| `SMTP_URL`, `MAIL_FROM` | Facultatifs | Sans SMTP, aucun e-mail ne part et la réinitialisation par e-mail est indisponible |
| `HMP_FUNCTION_REGION` | `fra1` (défaut) | Région de la fonction : la même que la base |

Ce que l'on règle dans **GitHub** (Settings → Environments → `staging` / `production` → Secrets) :

| Secret | Sert à | Où |
|---|---|---|
| `DATABASE_ADMIN_URL` | Migrations, sauvegardes (adresse **directe**, sans pooleur) | staging et production |
| `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`, `CSRF_SECRET`, `ENCRYPTION_KEY` | Tâche horaire des abonnements (mêmes valeurs que Vercel) | production (et staging si vous la lancez) |
| `BACKUP_PASSPHRASE`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Sauvegarde chiffrée hors hébergeur | production |
| `VERCEL_DEPLOY_HOOK` | Déploiement après la migration (facultatif) | staging et production |

Générer un secret sous Windows (Node est déjà installé), **une valeur différente par environnement** :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

(1re ligne : `CSRF_SECRET` ; 2e : `ENCRYPTION_KEY` et `BACKUP_PASSPHRASE` ; 3e : mots de passe de base `hmp_app` / `hmp_platform`.)

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié dans l'environnement de développement : toutes les migrations (22) avec un compte **non-superuser** après `deploy/prepare-managed-db.sql` ; l'application sur les rôles `hmp_app` / `hmp_platform` à moindre privilège ; le refus d'une migration ou d'un démarrage sur une base d'un autre environnement ; la construction Vercel et sa **simulation locale** (routage, en-têtes de sécurité, cookies `__Host-`, bandeau, connexion hôtel et console, PDF, argon2) ; la répétition complète d'une panne (démo → sauvegarde → restauration dans une **nouvelle** base → API → connexion) ; 524 tests.

**Non vérifié** (aucun compte Vercel, Neon, GitHub Actions ni stockage externe n'était accessible) : la détection de `.vercel/output` par la construction distante de Vercel, le comportement exact du pooleur de Neon, les droits du compte propriétaire Neon, les workflows GitHub Actions (jamais exécutés), l'envoi vers un stockage S3. Le premier déploiement de **Staging** sert à les valider un par un : ne mettez rien en production avant que Staging n'ait passé la liste de contrôle de `docs/guide-mise-en-ligne.md`.
