# Hotel Manager Pro

SaaS multi-établissements de gestion hôtelière. Une seule application et une seule base servent des centaines d'hôtels
indépendants, avec isolation stricte des données.

**État : Phase 5 / 11 terminée** — base de données multi-tenant avec couche SaaS commerciale (Phase 2), design system vitré
clair/sombre (Phase 3), API d'authentification, d'abonnements et de facturation SaaS (Phase 4), et **interface** : inscription et
connexion, espace de l'établissement (configuration, abonnement, factures et paiements, assistance, compte) et **console du
super-administrateur** (Phase 5).
**Les modules métier hôteliers (chambres, réservations, clients, réception…) ne sont pas encore développés** : l'interface les
signale « Bientôt » et n'affiche aucune donnée d'exemple (Phases 6 et suivantes). Aucun prestataire de paiement en ligne n'est connecté.
Voir [docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md), [docs/web.md](docs/web.md),
[docs/security-model.md](docs/security-model.md) et [docs/design-system.md](docs/design-system.md).

## Prérequis

Node ≥ 22, pnpm 10, PostgreSQL 16.

## Démarrage

```bash
pnpm install
./scripts/setup-dev-db.sh        # crée le compte et la base de développement, applique les migrations
pnpm test                        # 344 tests (shared 20 · db 207 · api 93 · web 24), PostgreSQL réel pour db et api
pnpm typecheck
pnpm web:dev                      # interface : http://127.0.0.1:5173 (relaie /api vers l'API sur le port 3000)
pnpm check:ui                    # design system (/design) : contrastes + rendu + accessibilité + comportements
pnpm check:e2e                   # parcours réels dans Chromium + API + base jetables, puis 174 écrans/états audités (axe WCAG A/AA)
```

### Lancer l'API

```bash
cp .env.example .env             # adapter CSRF_SECRET (openssl rand -base64 48) et les URL de base
pnpm api:dev                     # http://127.0.0.1:3000 — documentation interactive : /api/docs
DATABASE_ADMIN_URL=… ADMIN_EMAIL=vous@exemple.mg ADMIN_NAME="Votre Nom" pnpm api:create-admin   # 1er super-administrateur
pnpm api:lifecycle               # cycle de vie des abonnements : à planifier toutes les heures (cron)
```

Aucun compte par défaut n'existe : `api:create-admin` est la seule façon de créer un super-administrateur.

Variables : voir [.env.example](.env.example). Les tests utilisent `HMP_TEST_ADMIN_URL`
(défaut : `postgres://hmp_dev:hmp_dev@127.0.0.1:5432/postgres`).

## Structure

```
packages/db/
  migrations/   SQL = source de vérité (rôles, tables, RLS, contraintes, triggers, vues, données de référence)
  src/          migrateur, contexte transactionnel (withTenant / withPlatform), traduction des erreurs
  test/         tests d'isolation, de réservation, de facturation, SaaS, licences, limites, support
packages/shared/
  src/          permissions (40, 7 rôles), état d'accès d'un abonnement, codes d'erreur — partagés par l'API et l'interface
apps/api/
  src/modules/  routes : authentification, établissement, abonnement/facturation, assistance, console plateforme
  src/services/ règles commerciales : sessions, inscription, facturation SaaS, cycle de vie
  test/         92 tests d'API (isolation, CSRF, accès, parcours commercial complet, cycle de vie, console)
  scripts/      create-admin, run-lifecycle
apps/web/
  src/styles/   jetons de design (clair/sombre), surfaces vitrées
  src/ui/       composants du design system
  src/api/      client HTTP (CSRF, erreurs), types et requêtes (hôtel, console)
  src/auth/     session, gardes d'accès, écrans de chargement et d'erreur
  src/layouts/  coques de l'application (hôtel, console), bandeaux d'état d'abonnement
  src/pages/    écrans : accès, vue d'ensemble, paramètres, console plateforme, design system (/design)
  scripts/      contrastes, vérification du design system, pile de test réelle, parcours de bout en bout
docs/           architecture, API, interface web, modèle de sécurité, design system
```

Une migration appliquée n'est jamais modifiée (checksum vérifié) : on en ajoute une nouvelle.
