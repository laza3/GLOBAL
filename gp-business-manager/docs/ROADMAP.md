# ROADMAP

Légende : ✅ fait · 🟡 partiel · ⬜ à faire. Priorité actuelle : **application Windows**.

| Phase | Contenu | État |
|---|---|---|
| 1 — Architecture | Monorepo, modules, schéma, contrats, décisions, risques | ✅ (docs/) |
| 2 — Fondations (Windows) | Electron, SQLite, auth/rôles, cœur métier, composants UI | ✅ |
| 3 — Interface | Layout, sidebar, dashboard, tableaux, formulaires, modales, toasts, thème clair/sombre, FR/EN | ✅ |
| 4 — Gestion commerciale | Produits, catégories, stocks, clients, fournisseurs, achats | ✅ |
| 5 — Ventes | POS, paiements, tickets, factures, retours, sessions de caisse | ✅ |
| 6 — Finances | Dépenses, trésorerie, créances, dettes, rapports, indicateurs | ✅ |
| 9 (Windows) — Packaging | Installateur NSIS | ✅ (généré ; **non testé sur Windows réel**) |
| **Prochaines améliorations Windows** | voir ci-dessous | ⬜ |
| 7 — Synchronisation | Outbox → API, pull incrémental, conflits, tests multi-appareils | 🟡 préparé (outbox, UUID, tombstones) |
| API / PostgreSQL / multi-tenant | NestJS, Prisma, JWT+refresh, RLS, Swagger, Docker | ⬜ |
| 8 — Web | React (réutilise `@gp/shared` et les écrans) | ⬜ |
| 8 — Mobile | Expo/React Native + SQLite | ⬜ |

## Backlog Windows (ordre de priorité suggéré)
1. **Test sur un vrai poste Windows** : installation, impression ticket 80 mm, lecteur code-barres, désinstallation, mise en veille.
2. Signature de code + mise à jour automatique.
3. Fidélisation clients (points, paliers) — module annoncé, non implémenté.
4. Import/export CSV de produits et clients (migration depuis un autre logiciel).
5. Étiquettes code-barres (impression), tiroir-caisse ESC/POS, afficheur client.
6. Listes de prix multiples (`PriceList`), promotions avancées (2 achetés = 1 offert, paliers).
7. Multi-devises, ventes à crédit avec échéancier, relances clients.
8. Chiffrement de la base/sauvegardes, double authentification locale.
9. Messages d'erreur du cœur traduits en anglais/malgache (aujourd'hui en français).
10. Traduction malgache complète (`mg.ts` — squelette prêt).
11. Tests de charge (100 k produits / 1 M lignes), e2e UI supplémentaires.
