# API — référence et règles

Documentation interactive : `GET /api/docs` (Swagger UI) et `GET /api/openapi.json`, générées depuis les schémas réels
des routes (une seule source : le code). Ce document explique les **règles** que le schéma OpenAPI ne dit pas.

Pile : Fastify 5 · zod 4 (messages en français) · pg · Argon2id. Préfixe `/api/v1`. Deux familles de routes, deux
pools PostgreSQL, deux types de session : **établissement** (hôtels) et **plateforme** (`/platform/*`, super-administrateur).

## 1. Démarrage

```bash
./scripts/setup-dev-db.sh                                  # base de développement + migrations
cp .env.example .env                                        # puis adapter (CSRF_SECRET : 32+ caractères aléatoires)
ADMIN_EMAIL=vous@exemple.mg ADMIN_NAME="Votre Nom" DATABASE_ADMIN_URL=… pnpm api:create-admin   # mot de passe saisi à l'invite
pnpm api:dev                                                # http://127.0.0.1:3000  (docs : /api/docs)
pnpm api:lifecycle                                          # à planifier toutes les heures (cron)
```

Il n'existe **aucun compte par défaut** ni route publique de création d'administrateur : la commande `create-admin` (accès
d'administration à la base requis) est la seule voie.

## 2. Conventions

* **Erreurs** : toujours `{ "error": { "code", "message", "details?", "requestId" } }`. `code` est stable (testable),
  `message` est en français et jamais technique ; aucune pile d'appels, aucun SQL, jamais. `requestId` relie une plainte
  utilisateur à une ligne de journal.
* **Montants** : entiers dans la plus petite unité de la devise (MGA, EUR, USD), jamais de flottant. Le serveur renvoie de
  vrais nombres JSON (les `bigint`/`numeric` PostgreSQL sont convertis).
* **Dates** : ISO 8601 en UTC. Fuseau de l'établissement par défaut : `Indian/Antananarivo`.
* **Pagination** : `?page=1&pageSize=25` (max 100) ; réponse `{ items, total, page, pageSize }`.
* **Idempotence** : `POST /billing/invoices/:id/payments` accepte `Idempotency-Key` ; rejouer la même clé renvoie le même résultat.
* **Aucune valeur « payé » stockée** : le solde et l'état de paiement d'une facture sont **calculés** par la base à partir des paiements confirmés.

## 3. Authentification et sessions

| | Établissement | Plateforme |
|---|---|---|
| Cookie de session | `hmp_session` (`__Host-` en production) | `hmp_platform_session` |
| Cookie CSRF (lisible par le JS) | `hmp_csrf` | `hmp_platform_csrf` |
| `SameSite` | `Lax` | `Strict` |
| Durée | 12 h (`SESSION_TTL_HOURS`) | 8 h (`PLATFORM_SESSION_TTL_HOURS`) |
| Limite de débit de connexion | 10/min/IP (`AUTH_RATE_LIMIT_MAX`) | 5/min/IP (`PLATFORM_AUTH_RATE_LIMIT_MAX`) |

* Jeton de session : 256 bits aléatoires ; **seule son empreinte SHA-256 est stockée** (une fuite de la base ne permet pas de rejouer une session).
* Mots de passe : **Argon2id** (m=19 MiB, t=2, p=1). Une vérification factice est faite pour un e-mail inconnu : même réponse, même durée → pas d'énumération de comptes.
* Verrouillage : 5 échecs (`auth.max_failed_attempts`) → compte verrouillé 15 min (`auth.lock_minutes`).
* **CSRF** : toute requête non-`GET` doit porter `X-CSRF-Token` = valeur du cookie CSRF (HMAC du jeton de session) **et** une `Origin` autorisée (`ALLOWED_ORIGINS`).
* **Ordre des contrôles** : origine (toute requête qui modifie l'état, même sans session) → session → CSRF → état de l'établissement et de l'abonnement → permission → *puis seulement* validation du corps. Un appel non autorisé reçoit 401/402/403 sans jamais apprendre la forme attendue du corps (testé).
* Un utilisateur peut appartenir à plusieurs établissements : `POST /auth/switch-hotel`.

## 4. Autorisations (établissement)

40 permissions `ressource:action` regroupées en 7 rôles système (propriétaire, directeur, réception, gouvernante,
restauration, comptable, lecture seule). Une route déclare la permission requise ; elle est appliquée **côté serveur**
(masquer un bouton n'est qu'un confort d'affichage). Les rôles et leur matrice sont dans `packages/shared/src/permissions.ts`.

## 5. États d'accès (abonnement)

`GET /me` renvoie `access.state`. Il est **calculé à chaque requête à partir des dates** (l'accès ne dépend pas de la bonne
exécution d'une tâche planifiée) :

| État | Quand | Effet |
|---|---|---|
| `full` | essai en cours, abonnement à jour, ou licence définitive active | tout |
| `grace` | abonnement **payant** échu depuis moins de `billing.grace_days` (7 j) | tout, avec bandeau d'avertissement |
| `read_only` | essai échu, abonnement échu au-delà de la tolérance, résilié, ou jamais souscrit | lecture + facturation SaaS, assistance, profil ; toute autre écriture → **402** |
| `blocked` | établissement suspendu ou fermé | tout refusé (403) sauf `GET /me`, assistance, déconnexion |

Un essai échu passe directement en `read_only` (la tolérance ne vaut que pour un abonnement payé). Les données ne sont **jamais** effacées.

Raisons renvoyées : `trial_expired` (essai échu, avant que la tâche ne l'enregistre), `subscription_expired`,
`subscription_required` (aucun abonnement en cours — c'est aussi la raison une fois l'expiration enregistrée),
`hotel_suspended`, `hotel_closed`, `grace_period`.

## 6. Parcours commercial

1. **Inscription** `POST /auth/register-hotel` : crée l'établissement, son propriétaire, les 7 rôles, les moyens d'encaissement, et — si l'essai est activé — un essai gratuit (14 jours par défaut ; configurable globalement `trial.default_days` et par forfait `trial_days`). Ouvre la session.
2. **Choix d'une formule** `POST /subscription/change-requests` : pour un forfait au tarif catalogue, la demande est approuvée automatiquement et une **facture** est émise. Pour un forfait sur devis (Enterprise), la demande reste en attente jusqu'à ce que la plateforme fixe un prix (`/platform/plan-change-requests/:id/approve`).
3. **Paiement** : l'hôtel **déclare** un paiement (`POST /billing/invoices/:id/payments` — moyen, référence, payeur). Le paiement est `awaiting_validation`. **Un hôtel ne peut jamais confirmer un paiement.**
4. **Validation** : la plateforme vérifie (relevé bancaire, SMS Mobile Money…) puis `POST /platform/payments/:id/validate` (ou `/reject` avec motif). Quand la facture est soldée, ses effets s'appliquent **une seule fois** (idempotent) : activation, changement de formule, renouvellement, réactivation, ou activation de licence.
5. **Renouvellement** : la tâche de cycle de vie émet la facture de la période suivante 7 jours avant l'échéance (`billing.renewal_invoice_days`), **une seule** par période, même si la tâche tourne toutes les heures.

Règles de calcul de période :

* paiement avant ou pendant la tolérance → la période suit l'ancienne échéance (le cycle de facturation est conservé) ;
* paiement **après expiration** → nouvelle période qui démarre le jour du règlement (pas de période perdue, pas de période offerte). L'ancien abonnement reste dans l'historique.

### Moyens de paiement — architecture extensible, **aucun paiement simulé**

Chaque moyen (`mvola`, `orange_money`, `airtel_money`, `bank_transfer`, `card`, …) est un *connecteur* avec un mode :

* `manual` : consignes affichées au client (numéro à créditer, RIB), saisie de la référence, **validation humaine**. Disponible dès aujourd'hui.
* `automated` : paiement confirmé par un événement signé d'un prestataire. **Aucun prestataire n'est connecté** : `card` reste désactivé, et toute tentative d'activation → **501 `provider_not_connected`**. Une contrainte de la base interdit d'ailleurs d'activer un connecteur automatisé sans intégration réelle. Aucun bouton « Payer » ne peut donc créer un faux paiement réussi.

Ajouter un prestataire = implémenter un connecteur (création du paiement, vérification de la signature du webhook) ; le reste (factures, validation, effets, journal) est inchangé.

### Textes légaux

`GET /legal` (public) → `{ version, company }` : version des conditions en vigueur et coordonnées de l'éditeur (réglage `company.profile`).
L'inscription enregistre `users.terms_version` et `users.terms_accepted_at`.

### Utilisation des quotas

`GET /hotel/usage` → `{ rooms: { count, max }, users: { count, max } }` : consommation réelle de CET établissement face aux limites de sa
formule (`max = null` : illimité). Alimente la jauge du tableau de bord.

## 7. Console plateforme (`/platform/*`)

Chaque action est inscrite dans `platform_audit_logs` (ajout seul : même le rôle plateforme n'a pas `UPDATE`/`DELETE`), avec l'administrateur, l'adresse IP, l'établissement concerné et le détail.

| Domaine | Routes |
|---|---|
| Accès | `POST /platform/auth/login`, `POST /platform/auth/logout`, `GET /platform/me` |
| Tableau de bord | `GET /platform/stats` (établissements par statut, abonnements, essais bientôt échus, conversion, désabonnements, impayés, paiements à valider, MRR/ARR **par devise**, encaissé du mois, tickets) |
| Établissements | `GET /platform/hotels`, `GET /platform/hotels/:id` (fiche : abonnements, factures, paiements, licences, demandes, tickets, audit — **jamais** de données hôtelières), `POST …/suspend` (motif obligatoire), `POST …/reactivate` |
| Forfaits | `GET/POST /platform/plans`, `PATCH /platform/plans/:id`, `POST /platform/plans/:id/prices` (l'ancien tarif est conservé dans l'historique ; les abonnements en cours gardent leur prix figé) |
| Abonnements | `GET /platform/subscriptions`, `POST /platform/hotels/:id/subscription/activate` (manuel, motif obligatoire, prix/remise libres), `POST /platform/hotels/:id/trial/grant`, `POST /platform/subscriptions/:id/extend-trial`, `…/cancel` (à l'échéance ou immédiate), `…/renew` |
| Demandes de changement | `GET /platform/plan-change-requests`, `POST …/:id/approve`, `POST …/:id/reject` |
| Factures SaaS | `GET/POST /platform/invoices` (brouillon ou émise ; taxe configurable), `GET …/:id`, `POST …/:id/issue` (numéro `FS-AAAA-NNNNNN` sans trou), `POST …/:id/void`, `POST …/:id/payments` (paiement reçu directement : référence obligatoire hors espèces, jamais au-delà du solde) |
| Paiements | `GET /platform/payments`, `POST …/:id/validate`, `POST …/:id/reject` |
| Moyens de paiement | `GET /platform/payment-connectors`, `PATCH /platform/payment-connectors/:code` |
| Licences définitives | `GET /platform/licenses`, `POST /platform/hotels/:id/licenses` (clé **montrée une seule fois**, seule l'empreinte est stockée), `POST /platform/licenses/:id/{revoke,suspend,reinstate,extend-maintenance}` |
| Réglages | `GET /platform/settings`, `PATCH /platform/settings/:key` — seules les clés connues, validées : `trial.enabled`, `trial.default_days`, `trial.default_plan_code`, `billing.grace_days`, `billing.invoice_due_days`, `billing.tax_rate_bps`, `billing.default_currency`, `billing.renewal_invoice_days`, `billing.auto_approve_plan_changes`, `auth.max_failed_attempts`, `auth.lock_minutes`, `company.profile` |
| Support | `GET /platform/tickets`, `GET/PATCH /platform/tickets/:id`, `POST …/:id/messages` (réponse publique ou **note interne** invisible de l'hôtel) |
| Exploitation | `GET /platform/audit-logs` (filtre `action`, pagination, `total`), `POST /platform/jobs/lifecycle` |

### Licence définitive

Une licence **prime** sur l'abonnement (`source = license`), n'a pas de date de fin d'usage, et porte ses propres limites
(chambres, utilisateurs, fonctions). La **maintenance/support** est une échéance distincte (`maintenance_until`) : une
maintenance échue ne coupe pas l'usage, elle désactive le support (`supportActive = false`). Vendue avec facture
(`invoice: true`), la licence reste `pending` jusqu'au règlement validé. Suspension : réversible ; révocation : définitive.
Le journal `license_events` garde chaque acte.

## 7bis. Modules métier de l'établissement

Toutes les routes ci-dessous exigent une session d'établissement et la permission indiquée ; en lecture seule (abonnement échu) seules les
lectures passent. Chaque écriture est inscrite au journal d'audit de l'établissement.

### Chambres (`rooms:read` / `rooms:manage`)

| Route | Rôle |
|---|---|
| `GET/POST /rooms/categories`, `PATCH /rooms/categories/:id` | catégories (code unique par établissement, tarif de base) ; une catégorie se désactive, elle ne se supprime pas |
| `GET /rooms` (`categoryId`, `status`, `q`, `archived`), `POST /rooms`, `POST /rooms/bulk`, `PATCH /rooms/:id`, `POST /rooms/:id/archive` · `/restore` | chambres avec leur **état du jour dérivé** (disponible, réservée aujourd'hui, occupée, à nettoyer, en nettoyage, maintenance, hors service) ; la création en série est « tout ou rien » |
| `GET/POST /rooms/rates`, `PATCH/DELETE /rooms/rates/:id` | périodes tarifaires (saisons) par catégorie |
| `GET /rooms/pricing?categoryId&roomId&checkIn&checkOut` | devis nuit par nuit : exactement ce que les réservations factureront |

* **Limite de la formule** appliquée par la base (402 `room_limit_reached`), y compris en série (rien n'est créé) et à la restauration d'une chambre archivée.
* **Concurrence optimiste** : `PATCH /rooms/:id` exige `version` ; une modification obsolète → 409 `version_conflict`.
* **Archivage** refusé (409) tant qu'un séjour ou un blocage est à venir (« à venir » = jour de l'établissement, dans son fuseau).
* **Règle de prix d'une nuit** (`@hmp/shared`, testée) : 1) le tarif propre à la chambre remplace tout ; 2) sinon la période de la catégorie qui couvre la nuit — priorité la plus haute, puis la plus courte, puis la plus récente — avec le tarif **week-end** (nuits du vendredi et du samedi) s'il existe ; 3) sinon le tarif de base de la catégorie. Le séjour minimal est celui de la période de la **nuit d'arrivée**. Les montants sont dans la devise de l'établissement, en entiers de la plus petite unité.
* Les réservations existantes ne sont **jamais recalculées** quand un tarif change : leur prix est figé nuit par nuit à l'enregistrement.

### Clients (`guests:read` / `guests:manage` / `guests:read_id_document` / `guests:export`)

| Route | Rôle |
|---|---|
| `GET /guests` (`q`, `vip`, `tag`, `sort`, `page`, `pageSize`) | recherche par nom, e-mail ou téléphone (« 034 00 000 00 », « +261 34 00 000 00 » et « 340000000 » désignent le même numéro) |
| `GET /guests/duplicates`, `POST /guests` | doublons probables (même téléphone normalisé ; même nom et même date de naissance si connue) → 409 `possible_duplicate` avec les candidats, sauf `confirmDuplicate: true` ; un **e-mail** déjà pris est toujours refusé (409 `guest_email_taken`) |
| `GET /guests/:id`, `PATCH /guests/:id` | fiche (coordonnées, notes, pièces masquées, séjours, statistiques) ; modification avec `version` |
| `POST /guests/:id/notes` | notes en **ajout seul** (aucune route ne les modifie ni ne les supprime) |
| `POST/DELETE /guests/:id/documents`, `GET …/documents/:docId/reveal` | pièces d'identité : numéro chiffré **AES-256-GCM** (IV aléatoire, altération détectée), seuls les 4 derniers caractères sont lisibles ; la lecture complète exige `guests:read_id_document`, répond `Cache-Control: no-store` et est **journalisée** (sans le numéro) |
| `POST /guests/:id/merge` | fusion d'un doublon (rien n'est supprimé ni déplacé : l'historique est réuni à la lecture) |
| `POST /guests/:id/anonymize` (`confirm: true`) | droit à l'effacement : données personnelles, pièces et notes effacées, la ligne et les séjours restent ; **refusé** tant qu'un séjour est en cours ou à venir (fonction SQL étroite `anonymize_guest`) |
| `GET /guests/export.csv` | export Excel (séparateur `;`, BOM UTF-8), **injection de formule neutralisée**, fiches anonymisées et fusionnées exclues, journalisé |

La clé de chiffrement est `ENCRYPTION_KEY` (32 octets en base64, `openssl rand -base64 32`) : **obligatoire en production**, dérivée en développement. La perdre
rend les numéros de pièces illisibles : la sauvegarder séparément de la base.

## 8. Cycle de vie des abonnements

`pnpm api:lifecycle` (cron horaire) ou `POST /platform/jobs/lifecycle` :

| Transition | Condition |
|---|---|
| `trialing → expired` | `trial_ends_at` dépassé |
| `active/past_due → cancelled` | résiliation à l'échéance demandée et échéance passée |
| `active → past_due` | échéance dépassée, non renouvelée |
| `past_due → expired` | tolérance écoulée |
| facture de renouvellement | échéance dans ≤ 7 jours, facturation automatique, pas de résiliation prévue, **aucune facture ouverte** pour la période |

Idempotente et sans effet de bord hors base. Les **droits d'usage** ne dépendent pas d'elle (voir §5).

## 9. Limites connues (ce qui n'est PAS fait)

* **Interface** : la console plateforme et l'espace client (abonnement, factures, paiement, support) existent depuis la Phase 5 — voir [web.md](web.md).
* **Aucune passerelle de paiement connectée** (MVola, Orange Money, Airtel Money, carte) : validation manuelle uniquement ; les brancher exige des contrats marchands et des clés.
* **Pas d'envoi d'e-mails ni de SMS** : pas de réinitialisation de mot de passe par e-mail, pas de rappels de renouvellement, pas de notification de ticket. Nécessite un fournisseur.
* **Pas de double authentification (TOTP)** pour les super-administrateurs (la colonne existe, le parcours n'est pas écrit) : à faire avant une mise en production.
* **Limitation de débit en mémoire** : correcte pour une instance ; derrière plusieurs instances, la limite se répartit (à passer sur Redis ou sur le proxy).
* **PDF de facture non généré** (les données sont complètes ; le gabarit PDF viendra avec la facturation hôtelière).
* **Plan changé pendant qu'une facture de renouvellement est ouverte** : l'ancienne facture reste payable ; elle doit être annulée à la main (`…/void`). Cas rare, à automatiser plus tard.
* **Aucun module métier hôtelier** (chambres, réservations, clients…) : Phases 6 et suivantes. Les routes `/_test/*` n'existent que dans les tests.
* Prix des forfaits : **valeurs d'exemple** (Starter 80 000 / Business 180 000 / Premium 350 000 Ar par mois, Enterprise sur devis) ; à fixer avec le propriétaire du produit depuis la console. Taxe SaaS : 0 % par défaut, à valider avec un comptable.
