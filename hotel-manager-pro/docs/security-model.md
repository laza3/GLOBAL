# Modèle de sécurité de la base

## Rôles PostgreSQL

| Rôle | Utilisé par | Peut | Ne peut jamais |
|---|---|---|---|
| `hmp_owner` | Migrations uniquement (`NOLOGIN`, non superuser) | Posséder les objets ; exécuter les fonctions `SECURITY DEFINER` | Se connecter |
| `hmp_app` | L'API, requêtes d'un établissement | Lire/écrire **les données de l'hôtel courant** (RLS) ; lire le catalogue ; déclarer un paiement, ouvrir un ticket | Lire le hash d'un mot de passe, un abonnement d'un autre hôtel, les tables plateforme, supprimer un paiement ou un journal |
| `hmp_platform` | La console super-administrateur | Gérer forfaits, abonnements, factures SaaS, licences, support, suspension ; lire l'annuaire agrégé | Lire un client, une réservation, une chambre, un paiement d'hôtel, modifier le profil d'un hôtel |

Aucun rôle applicatif n'est superuser, `BYPASSRLS` ni propriétaire d'objet. Chaque fonction `SECURITY DEFINER`
appartient à `hmp_owner` (jamais à un superuser) et fige son `search_path`.

## Protocole de contexte

Chaque requête métier s'exécute dans **une transaction** :

```ts
withTenant(pool, { hotelId, userId }, async (tx) => { /* requêtes */ })
```

`set_config('app.hotel_id', …, true)` ne vit que le temps de la transaction. Les identifiants sont validés (UUID) avant
d'atteindre la base. Sans contexte : aucune ligne. La console plateforme utilise `withPlatform`, et la connexion
`withoutTenant` + `auth_find_user()`.

**Inscription** : il n'existe pas encore d'hôtel ni d'utilisateur ; l'API génère leurs identifiants, les pose comme
contexte, puis insère. Les politiques `id = app_hotel_id()` / `id = app_user_id()` n'autorisent alors que la création de
*cet* hôtel et de *cet* utilisateur.

## Déploiement : rôles et chaînes de connexion

```sql
-- 1. 1re migration (0001) : compte pouvant créer des rôles et des extensions (superuser ou CREATEROLE)
-- 2. Les migrations suivantes s'exécutent sous hmp_owner (le migrateur fait SET LOCAL ROLE hmp_owner)
ALTER ROLE hmp_app      LOGIN PASSWORD '<secret fort A>';   -- DATABASE_URL_APP
ALTER ROLE hmp_platform LOGIN PASSWORD '<secret fort B>';   -- DATABASE_URL_PLATFORM
```

L'API ouvre **deux pools distincts** (un par rôle). En production la bascule `SET ROLE` n'est pas utilisée : elle ne sert
qu'aux tests, où la connexion est superuser.

## Menaces couvertes et tests correspondants

| Menace | Défense | Test |
|---|---|---|
| Lecture des données d'un autre hôtel | RLS sur les 63 tables ; échec fermé sans contexte | `tenant-isolation` (lectures, 9 tables sans contexte) |
| Écriture / suppression chez un autre hôtel | `USING` + `WITH CHECK` ; `UPDATE hotel_id` refusé | `tenant-isolation` (écritures) |
| Référence croisée (élévation via un rôle d'un autre hôtel) | Clés composites `(hotel_id, id)` | `tenant-isolation` + garde-fou structurel |
| Fuite du contexte entre requêtes (pool) | Contexte transactionnel | `tenant-isolation` (connexion unique réutilisée) |
| Injection via l'identifiant de contexte | Validation UUID | `tenant-isolation` |
| Vol de hash de mot de passe | Droit par colonne ; `auth_find_user()` | `security-structure`, `tenant-isolation` |
| Compromission de la console plateforme → données clients | Aucun droit sur les tables métier | `security-structure` (23 tables), `tenant-isolation` |
| Hôte qui s'octroie un abonnement / une licence / se réactive | Écritures réservées ; colonnes de statut non modifiables | `tenant-isolation`, `saas-commercial` |
| Paiement SaaS falsifié | CHECK « validation réelle » ; hôte sans droit de confirmer ; rejeu bloqué | `saas-commercial` |
| Double réservation | Contrainte d'exclusion ; testé sous concurrence | `reservations` |
| Falsification comptable (modifier un paiement/une facture) | Grand livre en ajout seul ; factures immuables | `billing` |
| Dépassement de limites par contournement de l'API | Triggers + verrous consultatifs | `licensing-limits-support` |
| Note interne exposée à l'hôtel | RLS `NOT is_internal` | `licensing-limits-support` |

## Vérification des tests eux-mêmes (tests de mutation)

Les garde-fous ont été éprouvés en injectant volontairement des failles (table sans RLS, droit indu, politique trop
large, triggers retirés, contrainte de paiement supprimée) : les tests concernés **échouent bien** à chaque fois.
