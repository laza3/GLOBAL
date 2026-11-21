# Hotel Manager Pro

SaaS multi-établissements de gestion hôtelière. Une seule application et une seule base servent des centaines d'hôtels
indépendants, avec isolation stricte des données.

**État : Phase 4 / 11 terminée** — base de données multi-tenant avec couche SaaS commerciale (Phase 2), design system
vitré clair/sombre (Phase 3), et **API** : authentification, inscription d'un hôtel, abonnements, facturation SaaS,
paiements à validation manuelle, licences, console super-administrateur, support (Phase 4).
**Pas encore d'écrans pour la console ni pour l'espace client, ni de modules métier hôteliers** (chambres, réservations…) :
Phases 5 et suivantes. Aucun prestataire de paiement en ligne n'est connecté.
Voir [docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md), [docs/security-model.md](docs/security-model.md) et
[docs/design-system.md](docs/design-system.md).

## Prérequis

Node ≥ 22, pnpm 10, PostgreSQL 16.

## Démarrage

```bash
pnpm install
./scripts/setup-dev-db.sh        # crée le compte et la base de développement, applique les migrations
pnpm test                        # 315 tests sur un vrai PostgreSQL (une base clonée par fichier de test)
pnpm typecheck
pnpm web:dev                      # design system : http://127.0.0.1:5173
pnpm check:ui                    # contrastes + rendu + accessibilité + comportements (2 thèmes × 4 tailles)
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
  src/pages/    page de démonstration du design system
  scripts/      mesure des contrastes, vérification visuelle et comportementale
docs/           architecture, API (règles et limites), modèle de sécurité, design system
```

Une migration appliquée n'est jamais modifiée (checksum vérifié) : on en ajoute une nouvelle.
