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
| Vol d'une session depuis une sauvegarde de la base | Seule l'empreinte SHA-256 du jeton est stockée | `auth` (jeton absent de la base) |
| Rejeu d'une session après déconnexion | Révocation côté serveur ; cookie effacé | `auth`, `platform` |
| Requête forgée depuis un autre site (CSRF) | `SameSite` + en-tête `X-CSRF-Token` (HMAC du jeton) + liste d'origines | `auth`, `platform` |
| Sondage du schéma par un anonyme | Contrôles d'accès **avant** la validation du corps | `auth` (ordre des contrôles) |
| Énumération de comptes à la connexion | Même réponse et même durée (vérification factice) | `auth`, `platform` |
| Force brute sur un mot de passe | Verrouillage après 5 échecs + limitation de débit par IP | `auth`, `platform` |
| Un hôtel confirme son propre paiement | Route réservée à la plateforme + contrainte SQL | `hotel-billing`, `saas-commercial` |
| Faux paiement « automatique » | Connecteur automatisé non activable sans intégration réelle (501 + CHECK SQL) | `platform`, `saas-commercial` |
| Clé de licence retrouvable | Montrée une seule fois ; empreinte seule stockée | `platform` |
| Console plateforme qui réécrit son journal | `UPDATE`/`DELETE` non accordés | `platform` |
| Accès conservé après fin d'essai / d'abonnement | État calculé par dates à chaque requête (ne dépend pas du cron) | `lifecycle` |
| Double facturation d'un renouvellement | Une seule facture ouverte par période | `lifecycle` |
| Double réservation sous requêtes simultanées | Chambre affectée à la création ; contrainte d'exclusion ; la seconde requête attend puis échoue | `reservations` (10 requêtes parallèles, un seul succès) |
| Création en double (double-clic, relance) | `Idempotency-Key` + verrou consultatif ; même clé et autre contenu refusés | `reservations`, `folios`, `restaurant` |
| Remboursements simultanés au-delà du paiement | Verrou du paiement d'origine dans le déclencheur | `folios` (5 en parallèle, 3 acceptés) |
| Modifier le montant d'une réservation déjà facturée | Refus 409 ; correction par avoir | `folios` |
| Escalade de droits par le personnel | On ne donne pas ce qu'on n'a pas ; on ne touche pas un compte plus puissant ; pas soi-même | `staff` |
| Prise de contrôle d'un compte partagé entre hôtels | `staff_set_temp_password` refuse un compte membre d'un autre établissement | `staff` |
| Mot de passe provisoire retrouvable | Affiché une fois (`no-store`), jamais journalisé, à changer (marquage en base) | `staff` |
| Fonction non incluse dans la formule utilisée via l'API | `hotelAuth({ feature })` → 403 `feature_not_in_plan` | `housekeeping`, `restaurant`, `finances`, `staff`, `reports` |
| Tableau de bord qui contourne les droits | Chaque bloc calculé seulement si la permission est détenue | `reports` |
| Injection de formule dans un export CSV | Cellules préfixées d'une apostrophe | `finances`, `reports`, `csv` |

## Couche API

* **Cookies** : `HttpOnly`, `Secure` + préfixe `__Host-` en production (la configuration refuse de démarrer en production sans `COOKIE_SECURE`), `SameSite=Lax` (hôtels) / `Strict` (plateforme). Cookies d'hôtel et de plateforme **distincts** : une session ne vaut jamais pour l'autre domaine.
* **En-têtes** (helmet) : CSP `default-src 'none'` pour l'API (une CSP dédiée, plus large, ne vaut que pour `/api/docs`), HSTS en production, `frame-ancestors 'none'`, `nosniff`, pas de `Referrer`.
* **Journaux** (pino) : cookies, `Authorization` et `X-CSRF-Token` masqués ; aucun mot de passe ni jeton n'est écrit dans l'audit (testé).
* **Erreurs** : format unique, messages français, jamais de pile d'appels ni de SQL ; l'erreur interne ne renvoie que `requestId`.
* **Mots de passe** : Argon2id ; politique minimale (10 caractères, lettre + chiffre, ni l'e-mail ni un mot de passe courant).
* **Pools** : un pool par rôle PostgreSQL ; une erreur sur une connexion inactive est journalisée au lieu d'arrêter le processus.

**Non fait, à traiter avant la mise en production** : double authentification (TOTP) des super-administrateurs, limitation
de débit partagée entre instances (Redis ou proxy), réinitialisation de mot de passe par e-mail (pas de fournisseur),
audit externe. Voir [api.md §9](api.md).

## Interface web

* Le jeton de session n'existe que dans un cookie `HttpOnly` : invisible du JavaScript (vérifié dans le navigateur : absent de `document.cookie`,
  de `localStorage` et `sessionStorage`). L'application ne lit que le cookie CSRF, qu'elle renvoie en en-tête.
* Une session expirée en cours d'usage vide tout le cache en mémoire avant la redirection : aucune donnée de l'ancienne session ne subsiste.
* « Précédent » après déconnexion ne ré-affiche rien (le cookie est supprimé, la garde d'accès renvoie à la connexion) — vérifié.
* Un compte d'établissement n'ouvre jamais la console (cookie, table et rôle distincts) ; l'annuaire de la console ne contient aucune donnée d'hôtel — vérifié.
* Isolation : deux établissements créés dans le navigateur ne voient ni les factures, ni les demandes, ni la licence l'un de l'autre — vérifié.
* Le texte d'une erreur affiché à l'écran vient du serveur (français, sans détail technique) ; l'écran d'erreur n'affiche que la référence de requête.

## Vérification des tests eux-mêmes (tests de mutation)

Les garde-fous ont été éprouvés en injectant volontairement des failles (table sans RLS, droit indu, politique trop
large, triggers retirés, contrainte de paiement supprimée) : les tests concernés **échouent bien** à chaque fois.

Phase 4 : six garde-fous de l'API ont été cassés un à un et les tests ont échoué à chaque fois — contrôle CSRF retiré
(3 échecs), déduplication des factures de renouvellement retirée (3), règlement tardif sans nouveau cycle (1), état d'accès
lu sur l'horloge SQL au lieu de celle de l'application (2), paiement déclaré créé « confirmé » (6), `hotel_id` omis du
journal d'audit d'une validation (1).
