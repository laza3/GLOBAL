# Hotel Manager Pro

SaaS multi-établissements de gestion hôtelière. Une seule application et une seule base servent des centaines d'hôtels
indépendants, avec isolation stricte des données.

**État : les 11 phases sont réalisées.** Base de données multi-tenant avec couche SaaS commerciale, design system vitré clair/sombre,
API (authentification, abonnements, facturation SaaS), console du super-administrateur, et **les treize modules de l'établissement** :
chambres, clients, réservations, calendrier, réception, housekeeping et maintenance, restaurant, facturation des clients, finances,
personnel et permissions, rapports, tableau de bord. Ajouts de la phase finale : double authentification (TOTP) des super-administrateurs,
réinitialisation de mot de passe par e-mail, interface en français / anglais / malgache (socle et écrans principaux), brouillons locaux,
Docker, intégration continue, sauvegardes vérifiées.

**Aucun paiement n'est simulé ni automatisé** : aucun prestataire (Mobile Money, carte) n'est connecté ; les encaissements sont saisis
par l'équipe, avec la référence de la transaction. **Les textes légaux, les prix des formules et la traduction malgache sont à valider**
(voir [Limites](#limites-à-connaître-avant-la-production)).

Documentation : [architecture](docs/architecture.md) · [API](docs/api.md) · [interface web](docs/web.md) ·
[modèle de sécurité](docs/security-model.md) · [design system](docs/design-system.md) · [déploiement et sauvegardes](docs/deployment.md) · [environnements](docs/environnements.md) · [mise en ligne pas à pas](docs/guide-mise-en-ligne.md) · [mises à jour et retour arrière](docs/mises-a-jour.md) · [sauvegardes](docs/sauvegardes.md).

## Prérequis

Node ≥ 22, pnpm 10, PostgreSQL 16.

## Lancer le logiciel sur son ordinateur (débutant, Windows / macOS / Linux)

```bash
pnpm install
pnpm local:setup     # une seule fois : base de données, tables, fichier .env, 1er super-administrateur
pnpm local:start     # démarre l'API et l'interface, ouvre Chrome sur http://127.0.0.1:5173
```

Guide pas à pas pour Windows (installation de Node, pnpm, PostgreSQL, dépannage) : [docs/lancement-local-windows.md](docs/lancement-local-windows.md).

## Démarrage (développeurs)

```bash
pnpm install
./scripts/setup-dev-db.sh        # crée le compte et la base de développement, applique les migrations
pnpm test                        # 512 tests (shared 41 · db 207 · api 237 · web 27), PostgreSQL réel pour db et api
pnpm typecheck
pnpm web:dev                      # interface : http://127.0.0.1:5173 (relaie /api vers l'API sur le port 3000)
pnpm check:ui                    # design system (/design) : contrastes + rendu + accessibilité + comportements
pnpm check:e2e                   # parcours réels (13 modules) dans Chromium + API + base jetables, puis 330 écrans/états audités (axe WCAG A/AA, 2 thèmes × 3 tailles, sans défilement horizontal ni erreur console)
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
  migrations/   SQL = source de vérité (rôles, tables, RLS, contraintes, triggers, vues, fonctions étroites) — 21 migrations
  src/          migrateur, contexte transactionnel (withTenant / withPlatform), traduction des erreurs
  test/         isolation, réservation, facturation, SaaS, licences, limites, support, sécurité structurelle
packages/shared/
  src/          permissions, état d'accès, codes d'erreur, prix et taxes d'un séjour, dates, argent — partagés par l'API et l'interface
apps/api/
  src/modules/  routes : authentification, établissement, abonnement, console, chambres, clients, réservations, calendrier,
                facturation client, réception, housekeeping, restaurant, personnel, finances, rapports
  src/services/ règles métier : réservations (affectation, prix figés), note du client, facture PDF, sessions, cycle de vie
  test/         tests d'API sur un PostgreSQL réel (dont audit des routes et concurrence)
  scripts/      create-admin, run-lifecycle
apps/web/
  src/ui/       design system ; src/i18n/ catalogues fr / en / mg ; src/pages/<module>/ un dossier par module
  scripts/      pile de test réelle, parcours de bout en bout (Playwright + axe), contrastes
deploy/         nginx, création des rôles ; Dockerfile, docker-compose.yml, .github/workflows/ci.yml, scripts/{backup,restore,verify-backup}.sh
docs/           architecture, API, interface web, sécurité, design system, déploiement
```

Une migration appliquée n'est jamais modifiée (checksum vérifié) : on en ajoute une nouvelle.

## Limites à connaître avant la production

* **Prix des formules** : valeurs d'exemple (Starter 80 000 / Business 180 000 / Premium 350 000 Ar par mois) ; à fixer depuis la console.
* **Textes légaux** (conditions, confidentialité) : rédigés comme **gabarits** à faire valider par un juriste ; leur version est tracée à l'inscription.
* **Traduction** : l'anglais et le malgache couvrent le menu, la connexion et le tableau de bord ; les autres écrans restent en français. Le **malgache est à faire relire par un locuteur natif**.
* **Paiements** : saisie manuelle uniquement. Brancher MVola, Orange Money, Airtel Money ou une carte exige des contrats marchands.
* **Docker** : images et compose écrits mais **non exécutés ici** (pas de démon) ; vérifier un premier déploiement sur un serveur de test.
* **Hors ligne** : pas de file de synchronisation ; seuls les brouillons de saisie sont conservés localement.
* **Fonctions de formule non encore appliquées** : `multi_currency`, `api_access`, `custom_branding`, `multi_property` (déclarées dans le catalogue).
* **Non testé** : PostgreSQL managé, montée en charge, lecteurs d'écran réels, audit de sécurité externe, limitation de débit répartie.
