# Hotel Manager Pro

SaaS multi-établissements de gestion hôtelière. Une seule application et une seule base servent des centaines d'hôtels
indépendants, avec isolation stricte des données.

**État : Phase 3 / 11 terminée** — base de données multi-tenant avec couche SaaS commerciale (Phase 2) et design system
vitré clair/sombre (Phase 3). Pas encore d'API, d'authentification ni de modules métier.
Voir [docs/architecture.md](docs/architecture.md), [docs/security-model.md](docs/security-model.md) et
[docs/design-system.md](docs/design-system.md).

## Prérequis

Node ≥ 22, pnpm 10, PostgreSQL 16.

## Démarrage

```bash
pnpm install
./scripts/setup-dev-db.sh        # crée le compte et la base de développement, applique les migrations
pnpm test                        # 196 tests sur un vrai PostgreSQL (une base clonée par fichier de test)
pnpm typecheck
pnpm web:dev                      # design system : http://127.0.0.1:5173
pnpm check:ui                    # contrastes + rendu + accessibilité + comportements (2 thèmes × 4 tailles)
```

Variables : voir [.env.example](.env.example). Les tests utilisent `HMP_TEST_ADMIN_URL`
(défaut : `postgres://hmp_dev:hmp_dev@127.0.0.1:5432/postgres`).

## Structure

```
packages/db/
  migrations/   SQL = source de vérité (rôles, tables, RLS, contraintes, triggers, vues, données de référence)
  src/          migrateur, contexte transactionnel (withTenant / withPlatform), traduction des erreurs
  test/         tests d'isolation, de réservation, de facturation, SaaS, licences, limites, support
apps/web/
  src/styles/   jetons de design (clair/sombre), surfaces vitrées
  src/ui/       composants du design system
  src/pages/    page de démonstration du design system
  scripts/      mesure des contrastes, vérification visuelle et comportementale
docs/           architecture, modèle de sécurité, design system
```

Une migration appliquée n'est jamais modifiée (checksum vérifié) : on en ajoute une nouvelle.
