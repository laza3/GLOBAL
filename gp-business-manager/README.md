# GP BUSINESS MANAGER

ERP commercial universel (vente, stock, finances) pour boutiques, supermarchés, grossistes, importateurs… — conçu pour Madagascar et l'international, **fonctionnement hors ligne**.

> **État** : l'**application Windows installable** (Electron + React + SQLite local) et, depuis 0.4.0, un **serveur web** (ordinateur + téléphone, installable en PWA, **en ligne**) réutilisant le même cœur métier. La synchronisation hors ligne entre appareils n'est pas encore faite. Voir [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) pour l'état exact, ce qui est testé, et ce qui ne l'est pas.

## Démarrage rapide
```bash
npm install
npm run desktop:dev          # développement (Vite + Electron)
npm test                     # tests unitaires + intégration
npm run typecheck
npm run desktop:dist         # installateur Windows → apps/desktop/release/
npm run server:build && npm run server:start   # serveur web → http://localhost:3000
npm run server:e2e           # parcours gérant (PC) + vendeuse (téléphone)
```
Prérequis : Node ≥ 22.13. Pour l'installateur depuis Linux : Wine (voir [DEPLOYMENT](docs/DEPLOYMENT.md)).

Au premier lancement, l'assistant crée l'entreprise et le compte administrateur. **Aucune donnée de démonstration n'est injectée.**

## Fonctionnalités (Windows)
- **Tableau de bord** réel : CA, marge, ventes jour/mois, dépenses, trésorerie, soldes des caisses, valeur du stock, dettes clients/fournisseurs, impayés, top produits, alertes, graphiques, filtres (période, caisse, utilisateur selon droits).
- **POS** : recherche instantanée, lecteur code-barres, remises (ligne/ticket), paiements multiples/partiels, vente à crédit, avances, rendu de monnaie, paniers en attente, ticket 80 mm, facture A4/PDF, retours/remboursements, sessions de caisse avec contrôle d'écart. Raccourcis F2/F3/F4/F9.
- **Produits** : variantes (taille/couleur), SKU, multi-codes-barres, images, prix achat/détail/gros/promo, taxes, marges, historique des prix.
- **Stocks** : multi-entrepôts, mouvements, pertes/casse, transferts, inventaires, lots/péremption (FEFO), coût moyen pondéré, valorisation, alertes.
- **Achats** : fournisseurs, bons de commande, réceptions partielles, frais d'approche, dettes, échéances, paiements partiels.
- **Clients** : comptes, plafond de crédit, avances, règlements (FIFO), historique.
- **Finances** : comptes (caisse/banque/mobile money), dépenses, apports/prélèvements, virements internes, flux de trésorerie, créances/dettes — *sans double comptage*.
- **Rapports** : 12 rapports, export PDF/Excel/CSV.
- **Administration** : utilisateurs, rôles/permissions (32), organisation (établissements/entrepôts/caisses), journal d'activité, sauvegarde/restauration.
- **Paramètres** : entreprise, devise (7), taxes, modes de paiement (MVola, Orange Money, Airtel Money…), numérotation, tickets. **FR/EN** (malgache prêt à compléter). Thème clair/sombre.

## Structure
```
packages/shared   règles métier partagées (argent, panier, permissions, i18n)
apps/desktop      application Windows
docs/             ARCHITECTURE, DATABASE, API, SECURITY, TESTING, DEPLOYMENT, ROADMAP, CHANGELOG, CONTRIBUTING, PROJECT_STATUS
```
> Le dépôt contient aussi un projet vidéo Remotion préexistant à la racine (`/src`, `/public`) — non modifié.

## Documentation
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [SECURITY](docs/SECURITY.md) · [TESTING](docs/TESTING.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [ROADMAP](docs/ROADMAP.md) · [CHANGELOG](docs/CHANGELOG.md) · [CONTRIBUTING](docs/CONTRIBUTING.md) · [PROJECT_STATUS](docs/PROJECT_STATUS.md)
