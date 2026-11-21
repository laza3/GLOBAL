# Hotel Manager Pro

SaaS multi-établissements de gestion hôtelière. Une seule application et une seule base servent des centaines d'hôtels
indépendants, avec isolation stricte des données.

**État : Phase 2 / 11 terminée** — fondations de la base (multi-tenant, abonnements, licences, facturation, réservations).
Pas encore d'API ni d'interface. Voir [docs/architecture.md](docs/architecture.md) et
[docs/security-model.md](docs/security-model.md).

## Prérequis

Node ≥ 22, pnpm 10, PostgreSQL 16.

## Démarrage

```bash
pnpm install
./scripts/setup-dev-db.sh        # crée le compte et la base de développement, applique les migrations
pnpm test                        # 196 tests sur un vrai PostgreSQL (une base clonée par fichier de test)
pnpm typecheck
```

Variables : voir [.env.example](.env.example). Les tests utilisent `HMP_TEST_ADMIN_URL`
(défaut : `postgres://hmp_dev:hmp_dev@127.0.0.1:5432/postgres`).

## Structure

```
packages/db/
  migrations/   SQL = source de vérité (rôles, tables, RLS, contraintes, triggers, vues, données de référence)
  src/          migrateur, contexte transactionnel (withTenant / withPlatform), traduction des erreurs
  test/         tests d'isolation, de réservation, de facturation, SaaS, licences, limites, support
docs/           architecture et modèle de sécurité
```

Une migration appliquée n'est jamais modifiée (checksum vérifié) : on en ajoute une nouvelle.
