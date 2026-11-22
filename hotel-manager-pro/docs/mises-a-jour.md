# Mettre à jour le logiciel, et revenir en arrière

Règle d'or : **on ne modifie jamais Production directement**. Toute modification suit le chemin *votre ordinateur → Staging → Production*, et chaque étape est protégée par la vérification automatique (CI).

## 1. Une mise à jour courante (pas à pas)

Dans l'Invite de commandes, dossier `hotel-manager-pro` :

```bash
git switch staging
git pull
git switch -c feat/nom-court-de-la-modification
```

1. **Développez et testez chez vous** : `pnpm local:start`, `pnpm test`.
2. **Enregistrez et envoyez** :

```bash
git add -A
git commit -m "feat: ce que fait la modification"
git push -u origin feat/nom-court-de-la-modification
```

3. Sur GitHub : **Compare & pull request**, **base = `staging`**. Attendez la coche verte de la CI, puis **Merge**.
4. **Staging se met à jour** (migrations puis déploiement). Testez sur l'adresse de Staging, avec les données de démonstration (`pnpm api:seed-demo` si besoin).
5. Satisfait ? Nouvelle pull request **`staging` → `main`**, CI verte, **Merge**.
6. **Production** : l'action « Migrations de la base » démarre, fait une **sauvegarde automatique**, puis attend **votre approbation** (Actions → la ligne en attente → *Review deployments* → *Approve*). Après la migration, Production se déploie.
7. **Étiquetez la version** (point de retour en arrière) :

```bash
git switch main
git pull
git tag -a v1.1.0 -m "Description de la version"
git push origin v1.1.0
```

   GitHub publie une *Release* avec la liste des changements. Numérotation : `v1.2.3` — le dernier chiffre pour une correction, le chiffre du milieu pour une nouveauté, le premier pour un changement majeur.

## 2. Écrire une migration de base de données sans danger

Les migrations sont des fichiers SQL numérotés dans `packages/db/migrations/` (prochain numéro : `0023_…`).

- **Jamais modifier une migration déjà publiée** : sa somme de contrôle est vérifiée ; on **ajoute** un nouveau fichier.
- **Toujours compatible avec la version précédente du code** : c'est ce qui permet de revenir en arrière sans toucher à la base. Concrètement :
  - ajouter une colonne ou une table : sans souci (donnez-lui une valeur par défaut ou autorisez `NULL`) ;
  - supprimer ou renommer une colonne : **en deux versions** — la version N arrête de l'utiliser, la version N+1 (après stabilisation) la supprime ;
  - jamais de suppression de données dans une migration sans sauvegarde vérifiée juste avant.
- Les tests (`pnpm test`) créent des bases jetables : ils exécutent toutes les migrations à chaque fois.

## 3. Correction urgente (hotfix)

Même chemin, en plus court : branche depuis `main` (`git switch main && git pull && git switch -c fix/…`), pull request vers `staging` **puis** vers `main`. Ne contournez ni la CI ni Staging, même pour une « petite » correction.

## 4. Revenir en arrière

| Situation | Action | Durée |
|---|---|---|
| La nouvelle version se comporte mal en Production | Vercel → projet `hmp-production` → **Deployments** → le déploiement précédent → **Instant Rollback** (ou *Promote to Production*). Le site revient à l'ancienne version immédiatement. | Quelques secondes |
| Le défaut est dans Git | Pull request qui **annule** la modification : `git revert <commit>` puis envoi vers `staging`, puis `main`. L'historique reste lisible. | Minutes |
| Retrouver une ancienne version précise | `git switch --detach v1.0.0` pour la consulter ; pour la remettre en ligne, créez une branche depuis cette étiquette et passez par une pull request. | Minutes |
| Des **données** sont abîmées ou supprimées | Voir `docs/sauvegardes.md` (restauration à un instant donné, ou depuis la sauvegarde chiffrée). | Selon le cas |

**On ne « défait » jamais une migration.** Comme elles sont compatibles avec la version précédente, remettre l'ancien code suffit.

## 5. Mettre à jour les bibliothèques (sécurité)

Une fois par mois : `pnpm outdated`, mettez à jour par petits groupes, `pnpm test`, puis le chemin habituel Staging → Production. Les versions sont **figées** dans `pnpm-lock.yaml` : rien ne change sans que vous le décidiez.

## 6. Avant chaque mise en Production (liste rapide)

- [ ] CI verte sur la pull request vers `main`
- [ ] Testé sur Staging (parcours concernés)
- [ ] Sauvegarde récente (automatique avant migration) — jamais de migration de production le vendredi soir
- [ ] Migration compatible avec la version précédente
- [ ] Étiquette de version prévue
