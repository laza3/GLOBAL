# Déploiement, exploitation et sauvegardes

> **Chemin recommandé** : Vercel (interface + API serverless) + base hébergée, avec Staging et Production séparés — voir [environnements](environnements.md), [mise en ligne pas à pas](guide-mise-en-ligne.md), [mises à jour](mises-a-jour.md) et [sauvegardes](sauvegardes.md). Ce document décrit l'alternative **Docker Compose** sur un serveur à soi (mêmes principes : `APP_ENV` obligatoire, base marquée par environnement).

## Architecture de déploiement

```
Internet ──HTTPS──▶ proxy TLS (Caddy, Traefik, nginx…) ──▶ web (nginx, port 8080) ──/api──▶ api (Node, port 3000, non publié)
                                                                                         └──▶ PostgreSQL 16 (db)
```

* **HTTPS est obligatoire** : les cookies de session sont `Secure` + préfixe `__Host-` en production (l'API refuse de démarrer sans `COOKIE_SECURE`).
* L'API n'est **jamais publiée** : seul le service `web` y accède (même origine, donc pas de CORS).
* Deux rôles PostgreSQL applicatifs, un par pool (`hmp_app` avec RLS, `hmp_platform` sans accès aux données d'hôtel) ; le compte d'administration ne sert qu'aux migrations.

## Mise en route (Docker Compose)

```bash
cp deploy/.env.production.example .env          # remplacer TOUS les « CHANGEZ-MOI » ; APP_ENV=production (ou staging sur un serveur de tests)
docker compose up -d --build                    # base, migrations, rôles, API, interface, tâche horaire
docker compose run --rm api pnpm --filter @hmp/api create-admin   # premier super-administrateur (aucun compte par défaut)
```

Secrets à générer : `openssl rand -base64 48` (`CSRF_SECRET`), `openssl rand -base64 32` (`ENCRYPTION_KEY`), mots de passe de base distincts.

> **`ENCRYPTION_KEY` chiffre les numéros de pièces d'identité.** La perdre les rend illisibles : la sauvegarder **séparément** de la base.

Variables facultatives : `SMTP_URL` (`smtp://utilisateur:motdepasse@serveur:587`) et `MAIL_FROM` activent l'e-mail (réinitialisation de mot de passe). **Sans `SMTP_URL`, aucun e-mail ne part** et la réinitialisation par e-mail répond « indisponible » : rien n'est simulé.

Le service `lifecycle` exécute toutes les heures la tâche de cycle de vie (essais et abonnements échus, factures de renouvellement, options de réservation échues). Les **droits d'usage** ne dépendent pas d'elle (calculés par dates à chaque requête) ; elle tient à jour l'état affiché et les factures.

## Mise à jour

```bash
git pull && docker compose up -d --build        # les migrations (immuables, à somme de contrôle) s'appliquent avant l'API
```

Une migration déjà appliquée dont le fichier aurait changé est **refusée** (somme de contrôle) : on ajoute une migration, on n'en modifie jamais une publiée.

## Sauvegardes

```bash
# Sauvegarde quotidienne (cron) — format compressé, rotation de 14 fichiers, lisibilité vérifiée
DATABASE_ADMIN_URL=postgres://hmp_admin:…@db:5432/hmp BACKUP_DIR=/var/backups/hmp KEEP=14 scripts/backup.sh

# PREUVE qu'elle se restaure : restaure la dernière sauvegarde dans une base jetable et compare les comptages
DATABASE_ADMIN_URL=… BACKUP_DIR=/var/backups/hmp scripts/verify-backup.sh

# Restauration réelle (base cible vide ; refuse d'écraser des données)
scripts/restore.sh /var/backups/hmp/hmp-AAAAMMJJTHHMMSSZ.dump postgres://hmp_admin:…@db:5432/hmp_restore
```

À faire : **copier les sauvegardes hors du serveur**, exécuter `verify-backup.sh` chaque semaine, sauvegarder `ENCRYPTION_KEY` à part. Ces scripts ont été exécutés sur la base de vérification du dépôt (sauvegarde → restauration dans une base jetable → comptages identiques).

## Intégration continue

`.github/workflows/ci.yml` : typecheck, tous les tests (PostgreSQL 16 réel), construction de l'interface, parcours de bout en bout dans Chromium (inclut le balayage d'accessibilité), construction des deux images Docker.

## Ce qui n'a pas été vérifié ici

* Les images Docker et `docker compose` n'ont pas pu être **construits dans l'environnement de développement** (pas de démon Docker) : le Dockerfile, le compose et nginx.conf n'ont pas été exécutés. La CI les construit ; vérifiez un premier `docker compose up` sur un serveur de test.
* Aucune installation sur un PostgreSQL managé (la migration 0001 crée des rôles et des extensions).
* Pas de test de charge : le dimensionnement (pools de 20 et 8 connexions) est un point de départ.
* Limitation de débit en mémoire (une instance) : derrière plusieurs instances, la placer sur le proxy ou sur Redis.
