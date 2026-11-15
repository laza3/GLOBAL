# CONTRIBUTING

## Démarrage
```bash
npm install
npm run desktop:dev      # Vite + Electron en développement
npm test && npm run typecheck
```

## Règles du projet (non négociables)
1. **Aucune logique métier dupliquée** : les règles partagées vont dans `packages/shared`.
2. **Pas de flottants pour l'argent ni les quantités** (entiers : unité mineure / millièmes).
3. **Toute opération métier = une transaction** ; une écriture financière = une écriture de trésorerie.
4. **Ne jamais modifier/supprimer une écriture validée** : écriture inverse. Les triggers l'imposent.
5. **Permissions dans `core/api.ts`**, jamais seulement dans l'UI.
6. **SQL paramétré uniquement.**
7. **Tout nouveau comportement sensible a un test d'intégration** (`apps/desktop/tests`) ; `npm test` et `npm run typecheck` doivent passer.
8. **Textes d'interface** : écrire le français dans `t("…")` et ajouter la traduction dans `packages/shared/src/i18n/en.ts` (le test i18n vérifie les variables).
9. Pas de données factices en production ; les données de démonstration doivent rester dans un environnement de développement identifié.
10. Documenter toute décision technique importante dans `docs/ARCHITECTURE.md` (§7).

## Ajouter un endpoint
1. Fonction métier dans `core/<module>.ts` (dans `db.tx`).
2. Déclarer dans `core/api.ts` : permission + schéma Zod + appel.
3. Test d'intégration.
4. `npm run docs:api -w @gp/desktop` pour régénérer `docs/API.md`.
5. Côté UI : `useQ('mon.endpoint', params)` / `useM(…)` (typés automatiquement).

## Ajouter une migration
Ajouter un objet `{ id: N+1, name, sql }` dans `MIGRATIONS` (`core/schema.ts`). Ne **jamais** modifier une migration déjà publiée.

## Ajouter une langue
Créer `packages/shared/src/i18n/<code>.ts` (`{ texte français → traduction }`), l'enregistrer dans `DICTIONARIES` et `LOCALES`.
