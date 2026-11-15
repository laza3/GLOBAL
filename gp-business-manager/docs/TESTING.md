# TESTING

## Lancer les tests
```bash
cd gp-business-manager
npm install
npm test                     # @gp/shared (Vitest) puis @gp/desktop (Vitest)
npm run typecheck            # TypeScript strict, 0 erreur attendue
npm run e2e -w @gp/desktop   # Playwright pilotant l'application Electron (Xvfb sous Linux)
```

## Niveaux
| Niveau | Outil | Contenu |
|---|---|---|
| Unitaire | Vitest (`packages/shared/test`) | Argent (arrondis, conversions, répartition), panier (HT/TTC, remises, invariants), règlement (rendu, multi-paiements, crédit), retours proratisés, numérotation, permissions, i18n (variables conservées). |
| Intégration métier | Vitest (`apps/desktop/tests`) | **Vraie base SQLite en mémoire + vraie couche d'API** (permissions, validation, transactions) : sécurité, ventes, retours, immuabilité, stock/FEFO/inventaire/transferts, achats/dettes, caisse, finances/tableau de bord, exports. |
| Bout en bout | Playwright `_electron` | Parcours réel dans l'application : configuration → création produit → caisse → scan code-barres → encaissement → tableau de bord → historique → stock. |

## Ce qui est couvert (opérations sensibles)
- Atomicité d'une vente (rollback complet si une ligne est en rupture) et idempotence (rejeu du même `id`).
- Aucun double comptage : CA ≠ encaissements ≠ apports ≠ remboursements ≠ dépenses ≠ virements ; somme des soldes = somme des écritures.
- Triggers d'immuabilité (UPDATE/DELETE refusés sur ventes, paiements, trésorerie, stock, audit).
- Permissions serveur (caissier refusé sur gestion produits/utilisateurs/tableau de bord), verrouillage après 5 échecs, dernier admin protégé.
- Crédit (plafond), avances, règlement FIFO, retours partiels (cumul exact), retour sur vente à crédit.
- Stock : coût moyen pondéré, frais d'approche, FEFO, stock négatif refusé, inventaire.
- CSV : anti-injection de formule ; XLSX valide.

## Résultats (dernière exécution)
Voir `PROJECT_STATUS.md`.

## Non couvert (à faire)
- Tests de charge (volumétrie), tests d'accessibilité automatisés, tests visuels de régression.
- Tests de l'installateur sur un vrai Windows (impression, tiroir-caisse, désinstallation) : **aucun Windows disponible dans l'environnement de développement**.
- Tests multi-appareils de synchronisation (Phase 7).
- Parcours e2e détaillés : retours, crédit, achats, inventaire via l'interface (la logique est testée en intégration, pas par l'UI).
