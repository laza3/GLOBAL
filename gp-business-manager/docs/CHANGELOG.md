# CHANGELOG

## 0.1.0 — 2026-11-15 (première version Windows)
### Ajouté
- Application Windows Electron + React + SQLite local, 100 % hors ligne.
- Paquet partagé `@gp/shared` : argent exact, panier/taxes/remises, règlement, retours, permissions, numérotation, i18n FR/EN (+ squelette MG).
- Modules : tableau de bord, POS (scan code-barres, multi-paiements, crédit, attente, tickets, factures, retours), produits/variantes/prix/promos, stocks (mouvements, transferts, inventaires, lots FEFO, valorisation), clients (crédit, avances), fournisseurs/achats/réceptions/dettes, caisse (sessions, écarts), finances (comptes, dépenses, apports, virements, flux), rapports (PDF/Excel/CSV), administration (utilisateurs, rôles, organisation, audit, sauvegardes), paramètres.
- Sécurité : permissions côté processus principal, verrouillage de compte, journal d'audit immuable, écritures financières immuables (triggers).
- Installateur NSIS x64.
- Tests : 21 unitaires (shared), 29 d'intégration (desktop), 3 scénarios e2e Playwright.
### Connu
- Synchronisation cloud non implémentée (outbox préparée). Voir PROJECT_STATUS.md.
