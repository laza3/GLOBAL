# Hotel Manager Pro — Architecture

> État : **Phase 2 terminée** (fondations de la base de données, couche SaaS commerciale incluse).
> Ce document décrit ce qui **existe et est testé** ; la section « Limites » dit ce qui ne l'est pas encore.

## 1. Principe : un seul logiciel, des centaines d'établissements

Une seule application et une seule base PostgreSQL servent tous les établissements (multi-tenant « schéma partagé »).
Chaque ligne métier porte `hotel_id`. L'isolation ne repose **pas** sur la discipline de l'API : elle est imposée par
la base, à trois niveaux indépendants.

| Niveau | Mécanisme | Ce qu'il empêche |
|---|---|---|
| Lignes | Sécurité par ligne PostgreSQL (RLS) : `hotel_id = app_hotel_id()` sur toutes les tables | Lire/écrire les données d'un autre hôtel, même avec une requête SQL fautive |
| Références | Clés étrangères **composites** `(hotel_id, id)` | Rattacher une ligne d'un hôtel à celle d'un autre (même en contournant la RLS) |
| Droits | 3 rôles PostgreSQL (`hmp_app`, `hmp_platform`, `hmp_owner`), droits par colonne | La console plateforme lisant les clients ; l'API lisant les hash de mots de passe |

Sans contexte d'établissement, `app_hotel_id()` vaut `NULL` : **aucune ligne n'est visible** (échec fermé).
Le contexte est posé par transaction (`set_config(..., true)`) et ne peut pas fuiter vers une requête suivante.

Trois garde-fous automatiques (`test/security-structure.test.ts`) échouent si une future migration oublie la RLS,
accorde un droit trop large ou crée une clé étrangère non composite.

## 2. Modèle de données (63 tables)

| Domaine | Tables principales |
|---|---|
| Plateforme | `platform_admins`, `platform_settings`, `currencies`, `payment_connectors`, `payment_connector_credentials`, `platform_audit_logs` |
| Offre commerciale | `plans`, `plan_prices`, `subscriptions`, `subscription_events`, `plan_change_requests` |
| Facturation SaaS | `saas_invoices`, `saas_invoice_lines`, `saas_payments` |
| Licences | `licenses`, `license_events` |
| Support | `support_tickets`, `support_messages` |
| Établissement | `hotels`, `hotel_settings`, `users`, `memberships`, `roles`, `role_permissions`, `departments`, `sessions`, `audit_logs`, `files`, `notifications`, `idempotency_keys`, `hotel_counters` |
| Hébergement | `room_categories`, `rooms`, `room_photos`, `rate_periods`, `tax_rules`, `payment_methods`, `exchange_rates` |
| CRM | `guests`, `guest_documents` (numéros chiffrés), `guest_notes` |
| Réservations | `reservations`, `reservation_rooms`, `reservation_room_nights`, `room_allocations` |
| Facturation hôtel | `folios`, `folio_charges`, `invoices`, `invoice_lines`, `payments` |
| Opérations | `hk_tasks`, `maintenance_requests`, `menu_categories`, `products`, `menus`, `menu_items`, `dining_tables`, `orders`, `order_items`, `expense_categories`, `expenses` |

Fil rouge : **réservation → séjours (chambre + dates) → folio (charges + paiements) → factures.**

## 3. Invariants garantis par la base (et prouvés par un test)

| Invariant | Mécanisme |
|---|---|
| Jamais deux réservations de la même chambre aux mêmes dates | `EXCLUDE USING gist` sur `room_allocations` ; allocations **dérivées** de `reservation_rooms` par trigger (pas de second chemin d'écriture) ; séjours et blocs de maintenance partagent la contrainte ; testé avec 12 réservations simultanées |
| Départ le 15 + arrivée le 15 autorisés | Intervalles `[arrivée, départ)` |
| Statut d'une chambre jamais désynchronisé | Occupée / réservée / disponible / hors service / maintenance sont **dérivés** (vue `room_status_today`) ; seul l'état de ménage est stocké |
| Aucune facture « payée » sans transaction | Pas de champ « payé » : calculé depuis les paiements **confirmés** (`folio_balances`, `invoice_balances`, `saas_invoice_balances`) |
| Grand livre des paiements en ajout seul | Pas de `DELETE`, montants immuables (trigger) ; correction = remboursement |
| Remboursement ≤ paiement d'origine | Verrou + trigger (testé en concurrence) |
| Facture émise immuable | Trigger : seule l'annulation motivée est possible ; correction par avoir ; avoirs ≤ facture |
| Numérotation sans trou | Compteurs transactionnels (`next_hotel_counter`, `next_platform_counter`) : un `ROLLBACK` ne laisse aucun trou |
| Prix figé | Prix par nuit copié dans `reservation_room_nights` ; changer un tarif ne réécrit rien |
| Argent exact | Entiers dans la plus petite unité de la devise, jamais de flottants |
| Limites de forfait/licence non contournables | Triggers sur `rooms` et `memberships` (avec verrou consultatif contre les créations simultanées) |
| Fuseau valide | `Indian/Antananarivo` (voir §8) ; un identifiant invalide est refusé à la saisie |

## 4. Couche commerciale SaaS

### Forfaits et tarifs
`plans` : Starter, Business, Premium, Enterprise (sur devis). Limites (`max_rooms`, `max_users`, `NULL` = illimité) et
fonctionnalités (`features` : drapeaux). Tarifs dans `plan_prices` : un seul tarif **actif** par (forfait, périodicité,
devise) ; modifier un tarif = désactiver l'ancien et en créer un nouveau. Les abonnements existants gardent le prix copié
à la souscription. **Les prix de départ sont des valeurs d'exemple** à fixer depuis la console.

### Abonnements
Un seul abonnement « vivant » (`trialing`, `active`, `past_due`) par établissement (index unique partiel) ; les
précédents forment l'historique, complété par `subscription_events` (ajout seul). Mensuel ou annuel.
Essai gratuit configurable : `platform_settings` (`trial.enabled`, `trial.default_days`, `trial.default_plan_code`),
surchargeable par forfait (`plans.trial_days`). Seule la fonction `start_trial()` permet à un hôtel de créer **son**
abonnement ; toute autre écriture est réservée à la plateforme.

### Droits d'usage effectifs
Vue `hotel_entitlements` : **licence active > abonnement > aucun**. `is_current` est calculé à partir des dates : une
échéance dépassée n'ouvre plus de droits même si la tâche de bascule d'état n'a pas encore tourné.

### Licence définitive
Table `licenses` : droit d'usage **perpétuel** d'une édition pour **un** établissement, limites et fonctionnalités
figées. La couverture de maintenance (mises à jour, support) est distincte : `maintenance_until`, exposée par
`license_support_active`. La clé n'est stockée que sous forme d'empreinte.

### Paiements SaaS — aucun paiement simulé
* Aucun connecteur n'est actif au départ. `payment_connectors` impose par contraintes : un connecteur *automatisé* ne
  peut être activé que s'il est réellement `connected` (fournisseur + date de connexion renseignés).
* Un paiement `confirmed` exige **soit** une validation humaine (`validated_by_admin_id`), **soit** un événement
  prestataire (`provider_event_id`, unique : rejeu impossible).
* L'hôtel peut **déclarer** un paiement (référence de transaction obligatoire pour virement/Mobile Money) ; il ne peut
  jamais le confirmer (politique RLS + droits par colonne).
* MVola, Orange Money, Airtel Money, virement : modes **manuels** (le client paie hors plateforme, la plateforme
  vérifie et valide). La carte bancaire est un connecteur **automatisé** : inactif tant qu'aucun prestataire n'est branché.

### Support
`support_tickets` / `support_messages`. Les **notes internes** (`is_internal`) sont invisibles de l'hôtel (RLS) et un
hôtel ne peut pas poster dans le ticket d'un autre (clé composite).

### Revenus récurrents
Vue `platform_mrr`, **par devise** (aucune conversion supposée) : abonnements `active` et `past_due`, annuel ÷ 12,
remises déduites ; essais, résiliés et expirés exclus. ARR = MRR × 12.

## 5. Flux principaux

**Inscription d'un établissement** (une transaction, rôle `hmp_app`, contexte = identifiants qu'elle s'apprête à créer) :
`hotels` → `hotel_settings` → `start_trial()` → `users` → `roles` (propriétaire) → `memberships`.
Le premier compte est toujours autorisé (même sans abonnement) ; les limites s'appliquent ensuite.

**Connexion** : sans contexte d'établissement, via `auth_find_user(email)` (seule voie d'accès au hash du mot de passe).

**Paiement d'un abonnement** : la plateforme émet la facture SaaS (numérotation sans trou) → l'hôtel effectue le
virement/transfert Mobile Money et déclare la référence → la plateforme valide → la facture est « payée » (calculé).

## 6. KPI hôteliers (formules retenues)

| Indicateur | Formule |
|---|---|
| Taux d'occupation | nuits vendues ÷ nuits disponibles |
| ADR | revenu hébergement ÷ nuits vendues |
| RevPAR | revenu hébergement ÷ nuits disponibles (= ADR × occupation) |
| Durée moyenne de séjour | nuits vendues ÷ nombre de séjours |
| Taux d'annulation | réservations annulées ÷ réservations créées sur la période |

Nuits disponibles = chambres actives × nuits − nuits en bloc (maintenance / hors service). Cette convention varie dans
le secteur ; elle est volontairement explicite. Revenu **enregistré** (par nuit/consommation), **encaissé** (paiements
confirmés) et **dû** (solde) sont trois notions distinctes. *(Calculs implémentés en Phase 5/6j.)*

## 7. Codes d'erreur métier (SQLSTATE `HM001`, message = code stable)

`charge_already_invoiced`, `credit_exceeds_invoice`, `credit_note_invalid_target`, `hotel_not_eligible`,
`hotel_not_found`, `invalid_timezone`, `invoice_immutable`, `invoice_not_deletable`, `invoice_not_found`,
`invoice_not_payable`, `invoice_status_transition_invalid`, `invoice_totals_mismatch`, `invoice_without_lines`,
`payment_currency_mismatch`, `payment_immutable`, `payment_not_deletable`, `payment_status_transition_invalid`,
`plan_not_available`, `refund_currency_mismatch`, `refund_exceeds_payment`, `refund_invalid_target`,
`room_limit_reached`, `stay_allocation_is_derived`, `tenant_context_missing`, `trial_already_used`, `trial_disabled`,
`user_limit_reached`. Autres erreurs traduites par `dbErrorCode()` : `room_not_available` (exclusion), `forbidden`,
`unique_violation`, `foreign_key_violation`, `check_violation`.

## 8. Écart avec le cahier des charges

Le cahier des charges cite le fuseau `Africa/Antananarivo`. **Cet identifiant n'existe pas** dans la base IANA
(PostgreSQL et les navigateurs le rejettent). Le bon identifiant de Madagascar est **`Indian/Antananarivo`** (UTC+3,
sans heure d'été), utilisé partout.

## 8bis. Couche API (Phase 4)

```
Navigateur ──cookie HttpOnly + X-CSRF-Token──▶ Fastify (apps/api)
                                                ├─ plugins/auth      origine → session → CSRF → état d'accès → permission
                                                ├─ modules/*         routes minces : validation zod, appel de service, réponse
                                                ├─ services/*        règles commerciales (facturation SaaS, cycle de vie, sessions)
                                                └─ db.ts             deux pools : hmp_app (RLS) et hmp_platform (console)
```

* **Le SQL reste la source de vérité** : l'API ne ré-implémente aucune règle d'intégrité (chevauchement, immutabilité,
  limites, paiements) ; elle traduit les erreurs `HM001` de la base en codes stables et en messages français.
* **Une transaction par requête**, avec le contexte d'établissement posé en début de transaction (cf. security-model.md).
* **Un seul calcul d'état d'accès**, dans `@hmp/shared`, utilisé par l'API et (à venir) par l'interface : l'écran ne peut
  pas afficher un droit que le serveur refuserait.
* L'horloge de l'application (`deps.now`) fait foi pour les états d'accès et le cycle de vie ; les tests la pilotent
  pour traverser fin d'essai, tolérance et expiration sans toucher aux données.
* Détail des routes, règles et limites : [api.md](api.md).

## 9. Limites actuelles (ce qui n'est PAS fait)

* **API prête, interface non** : l'API (authentification, abonnements, console plateforme) est écrite et testée ; les écrans de la console et de l'espace client, puis tous les modules métier hôteliers, viennent aux Phases 5 et suivantes.
* **Tâche de cycle de vie des abonnements** : écrite et testée (`pnpm api:lifecycle`, à planifier toutes les heures). Les droits d'usage sont calculés par dates, donc corrects même si la tâche ne tourne pas ; `platform_mrr` se fie au statut enregistré et exige donc qu'elle tourne.
* **Aucune passerelle de paiement n'est connectée** (MVola, Orange Money, Airtel Money, carte) : validation manuelle
  uniquement. Les brancher exige des contrats marchands et des clés que ce projet n'a pas.
* Envoi d'e-mails / SMS non implémenté (nécessitera un fournisseur).
* Sauvegardes : scripts et restauration testée prévus en Phase 11.
* Non testé sur un PostgreSQL managé (la migration 0001 crée des rôles et des extensions).
* Taxes : configurables ; le taux de TVA des factures SaaS est à `0` par défaut, à valider avec un comptable.
