# ARCHITECTURE — GP Business Manager

> Périmètre actuel : **application Windows (Electron) hors ligne**. API, web et mobile viennent ensuite et réutiliseront les mêmes règles métier.

## 1. Principes directeurs

1. **Local-first** : la base SQLite locale est la source de vérité de l'application Windows ; elle fonctionne sans Internet.
2. **Règles métier uniques** : calcul des paniers, taxes, remises, règlement, retours, permissions, numérotation, i18n vivent dans `@gp/shared` (TypeScript pur, sans dépendance plateforme). Web, mobile et API les importeront sans duplication.
3. **Argent exact** : montants = entiers en unité mineure (MGA : 1 Ar, EUR : 1 centime) ; quantités = entiers en millièmes. Aucun flottant dans un calcul financier. Arrondi « half away from zero » en BigInt (`roundDiv`) ; répartition par plus fort reste (`allocate`) pour que la somme des parts soit toujours égale au total.
4. **Atomicité** : toute opération métier (vente, retour, réception, virement…) est **une seule transaction SQLite** (`BEGIN IMMEDIATE`). Rien n'est écrit à moitié.
5. **Immuabilité** : les écritures financières validées ne sont jamais modifiées ni supprimées — des *triggers SQLite* lèvent `IMMUTABLE_RECORD` sur `UPDATE/DELETE`. Une correction = une écriture inverse (retour, remboursement, contre-passation).
6. **Sécurité en profondeur** : les permissions sont vérifiées dans le **processus principal**, jamais seulement dans l'interface ; le renderer ne voit jamais le jeton de session.

## 2. Arborescence du monorepo

```
gp-business-manager/
├─ package.json              # workspaces npm
├─ tsconfig.base.json
├─ packages/
│  └─ shared/                # @gp/shared — règles métier, permissions, i18n (Vitest)
│     └─ src/{money,pricing,permissions,numbering,i18n/}
├─ apps/
│  └─ desktop/               # @gp/desktop — Windows (Electron + React + SQLite)
│     ├─ src/main/           # processus principal
│     │  ├─ index.ts         #   fenêtre, IPC, impression, export, sauvegarde/restauration
│     │  └─ core/            #   cœur métier SANS dépendance Electron (testable sous Node)
│     │     ├─ schema.ts     #     migrations SQL + triggers d'immuabilité
│     │     ├─ db.ts         #     node:sqlite, transactions imbriquées, backup
│     │     ├─ api.ts        #     registre unique des endpoints (permission + schéma Zod)
│     │     ├─ auth.ts setup.ts masterdata.ts catalog.ts stock.ts
│     │     ├─ parties.ts sales.ts cash.ts finance.ts purchases.ts
│     │     └─ dashboard.ts reports.ts
│     ├─ src/preload/        #   contextBridge : `window.gp.call/system`
│     ├─ src/renderer/       #   React 19 + Tailwind 4 + TanStack Query + React Router
│     ├─ tests/              #   Vitest (intégration sur vraie base SQLite en mémoire)
│     └─ e2e/                #   Playwright (_electron)
├─ docs/                     # ARCHITECTURE, DATABASE, API, SECURITY, TESTING, …
└─ (à venir) apps/api  apps/web  apps/mobile  packages/sync
```

Le dossier racine du dépôt contient aussi le projet vidéo Remotion préexistant (`/src`, `/public`, `/out`) : **il n'a pas été touché**.

## 3. Application Windows

### 3.1 Processus
```
Renderer (React, sandbox, CSP stricte)
   │  window.gp.call(method, params)   ← seule surface exposée (contextBridge)
   ▼
Preload ──ipcRenderer.invoke──▶ Main process
                                 ├─ vérifie l'origine de l'expéditeur (file://)
                                 ├─ associe un jeton de session à la fenêtre (jamais envoyé au renderer)
                                 └─ App.call() : authentifie → autorise (perm) → valide (Zod) → exécute → enveloppe {ok|error}
                                       └─ core/* → node:sqlite (SQLite embarqué dans Electron, aucun module natif)
```
Choix : `node:sqlite` (intégré à Node 24 / Electron 45) plutôt que `better-sqlite3` → **aucune compilation native**, installateur Windows produisible depuis Linux/CI, pas de problème d'ABI Electron.

### 3.2 Contrat d'API interne
Un **registre unique** (`core/api.ts`) déclare chaque endpoint : permission(s) requise(s), schéma Zod d'entrée, fonction. Les types d'entrée/sortie sont inférés et réutilisés par le renderer (`useQ('sales.list', …)` est typé de bout en bout). Ce même registre servira de modèle pour les routes REST NestJS (mêmes noms, mêmes schémas, déplacés dans `@gp/shared`).

### 3.3 Données (voir DATABASE.md)
Une base SQLite = une entreprise (isolation physique stricte). Plusieurs établissements, entrepôts et caisses coexistent dans une entreprise.

## 4. Définitions comptables (anti double comptage)

| Notion | Définition | Source |
|---|---|---|
| **Chiffre d'affaires (HT)** | Σ ventes HT − Σ retours HT sur la période (une vente à crédit compte dès qu'elle est faite) | `sales`, `sale_returns` |
| **Marge brute** | CA − coût des marchandises vendues (coût moyen pondéré figé à la vente, net des retours remis en stock) | `sale_items.unit_cost` |
| **Encaissements** | Entrées d'argent réelles : `SALE_RECEIPT`, `CUSTOMER_PAYMENT`, `CUSTOMER_ADVANCE` | `financial_transactions` |
| **Créances clients** | Solde positif du compte client (vente à crédit − règlements) — *jamais* un encaissement | `customer_ledger` |
| **Apports / prélèvements** | `CAPITAL_CONTRIBUTION` / `OWNER_WITHDRAWAL` : trésorerie uniquement, ni CA ni dépense | `financial_transactions` |
| **Dépenses** | Sorties d'exploitation | `expenses` + 1 écriture `EXPENSE` |
| **Remboursements** | Sorties liées aux retours (`REFUND`), distinctes des dépenses | `payments` OUT + `REFUND` |
| **Virements internes** | 2 écritures liées (`TRANSFER_OUT/IN`), nettes = 0 sur la trésorerie globale | `financial_transactions` |

Règle : **un flux d'argent = exactement une écriture de trésorerie** (créée avec le paiement dans la même transaction). Les soldes de comptes = solde d'ouverture + Σ écritures ; la somme des soldes est testée = Σ des écritures.

## 5. Stratégie de synchronisation (Phase 7 — prévue, préparée)

> **État** : *non implémentée*. Ce qui existe : identifiants UUID générés côté client, table **`outbox`** alimentée par chaque mutation de données synchronisables, soft-delete (`deleted_at` = tombstone), colonnes `version`, idempotence des ventes par identifiant fourni par le client.

### 5.1 Modèle
- **Outbox (appareil → serveur)** : chaque mutation écrit une ligne `outbox(op_id UUID unique, entity, entity_id, op, payload, status)` *dans la même transaction* que la mutation. Un worker envoie par lots (`POST /sync/push`), le serveur répond par opération : `APPLIED | DUPLICATE | REJECTED | CONFLICT`. Reprise après coupure : les lignes `PENDING/FAILED` sont rejouées ; l'idempotence repose sur `op_id` (clé unique côté serveur) → un rejeu ne double jamais une vente.
- **Pull incrémental (serveur → appareil)** : journal `change_log(seq, entity, entity_id, op, at)` côté serveur, alimenté par triggers PostgreSQL. L'appareil conserve un curseur ; `GET /sync/pull?cursor=` renvoie les changements suivants (suppressions = tombstones). Pour éviter de rater une transaction validée après une plus récente (ordre de commit ≠ ordre de séquence), le curseur utilise le *snapshot xmin* PostgreSQL (`pg_snapshot_xmin`), et les lignes dont la transaction n'est pas encore visible sont différées.
- **Jamais de « dernier arrivé gagne » sur l'argent.**

### 5.2 Politique de conflits (explicite)
| Donnée | Règle |
|---|---|
| Ventes, paiements, mouvements de caisse, écritures de trésorerie, retours | **Faits immuables, append-only** : jamais écrasés. Acceptés tels quels, même si le prix du catalogue ou le stock ont changé entre-temps (le prix vendu est celui vu par le client). |
| Stock | Un mouvement est un fait ; la quantité est recalculée côté serveur. Si le stock devient négatif suite à des ventes hors ligne, la vente est **conservée** et un conflit `STOCK_NEGATIVE` est journalisé pour régularisation (inventaire). |
| Numérotation | L'appareil attribue un numéro de reprise (préfixe d'appareil) ; le numéro légal/séquentiel serveur est attribué à la synchronisation. |
| Données de référence (produits, prix, clients) | Concurrence optimiste par `version` : si `baseVersion` ≠ version serveur → `CONFLICT`, **le serveur gagne**, l'appareil reçoit la version serveur et le conflit reste visible dans le journal de synchronisation (aucune perte silencieuse : la version locale rejetée est conservée dans `sync_log`). |
| Suppressions | Tombstones (`deleted_at`) propagés ; une suppression ne gagne jamais contre une écriture financière liée (refus). |
| Comptes clients | Solde = somme du grand livre : la fusion est une union d'écritures, pas une écrasement de solde. |

### 5.3 Garanties et limites (à documenter aux utilisateurs)
- **Garanti** : aucune vente perdue ni dupliquée ; ordre d'application par appareil préservé ; données financières jamais modifiées silencieusement.
- **Non garanti hors ligne** : un appareil hors ligne ne connaît **pas** les modifications faites ailleurs (stock, prix, plafond de crédit, solde client). Il peut vendre au-delà d'un plafond de crédit ou d'un stock réellement épuisé ; l'écart est détecté à la synchronisation et signalé, pas empêché.
- Cohérence **éventuelle** entre appareils ; cohérence **forte** sur un appareil donné.

## 6. Architecture cible (phases suivantes)

```
Windows (Electron+SQLite) ─┐
Mobile (Expo+SQLite)       ├─ HTTPS ─▶ API NestJS (REST/OpenAPI, JWT + refresh rotatif, RBAC)
Web (React)                ┘                └─ PostgreSQL (Prisma), multi-tenant :
                                                 tenant_id/company_id sur chaque table + Row-Level Security
```
- **Multi-tenant** : `Tenant → Company → Branch → Warehouse/CashRegister`. Isolation par `company_id` + RLS PostgreSQL (`set_config('app.company_id')` par transaction) ; un utilisateur n'accède qu'aux entreprises/établissements de ses `UserCompany`.
- **Authentification** : JWT court (15 min) + refresh token opaque haché, rotation et détection de réutilisation, sessions révocables ; Argon2id pour les mots de passe serveur.
- **Contrats** : les schémas Zod migreront de `core/api.ts` vers `@gp/shared` pour être partagés avec l'API.

## 7. Décisions techniques importantes (ADR courts)

| # | Décision | Raison / alternative écartée |
|---|---|---|
| 1 | `node:sqlite` plutôt que better-sqlite3 | Pas de module natif → build Windows depuis Linux, pas d'ABI à gérer. API synchrone, suffisante. |
| 2 | Une base SQLite par entreprise | Isolation physique, sauvegarde simple (1 fichier), pas de `company_id` partout en local. |
| 3 | Entiers (unité mineure / millièmes) | Exactitude des calculs ; aucun flottant. |
| 4 | Triggers d'immuabilité en base | Garantie indépendante du code applicatif (un bug applicatif ne peut pas réécrire l'historique). |
| 5 | Permissions dans le main process | Un renderer compromis ne peut pas élever ses droits. Jeton jamais exposé au renderer. |
| 6 | Mot de passe local : scrypt (N=16384) | Natif Node, sans dépendance ; Argon2id côté serveur. |
| 7 | Prix recalculés côté cœur à la vente | Un client falsifié ne peut pas imposer un prix (dérogation = permission `sale.discount`). |
| 8 | Coût moyen pondéré figé sur la ligne de vente | Marge exacte et stable même si le coût change ensuite. |
| 9 | Texte français = clé i18n | Écriture rapide, malgache = ajout d'un dictionnaire. Clé manquante → repli français. |
| 10 | Projet dans `gp-business-manager/` | Le dépôt contenait déjà un projet Remotion à la racine : rien n'a été déplacé ni supprimé. |

## 8. Principaux risques techniques

| Risque | Impact | Mitigation |
|---|---|---|
| Synchronisation multi-appareils (ordre, conflits, stock négatif) | Élevé | Faits immuables + idempotence + journal de conflits ; tests multi-appareils dédiés (Phase 7). |
| Perte/corruption de la base locale | Élevé | WAL + sauvegarde auto quotidienne (14 j) + export manuel + contrôle d'intégrité à la restauration. À ajouter : chiffrement au repos optionnel. |
| Signature de code Windows absente | Moyen | SmartScreen avertit tant que l'exécutable n'est pas signé (certificat à acheter). Voir DEPLOYMENT.md. |
| `node:sqlite` encore « expérimental » côté Node | Moyen | Verrouillé par la version d'Electron embarquée ; suite de tests d'intégration ; repli possible vers better-sqlite3 derrière la classe `Db`. |
| Volumétrie (>100 k produits, >1 M lignes de vente) | Moyen | Index posés, requêtes paginées ; tests de charge à faire (Phase 9). |
| Impression ticket thermique (pilotes variés) | Moyen | Impression HTML 80 mm via le pilote système ; ESC/POS natif et tiroir-caisse à ajouter si besoin. |
