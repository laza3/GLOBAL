# Interface web — architecture, règles et vérification

> État : **Phase 5 terminée**. L'interface couvre l'accès (inscription, connexion), l'espace de l'établissement (vue
> d'ensemble, paramètres, abonnement, factures, assistance, compte) et la **console du super-administrateur**. Les
> modules métier hôteliers (chambres, réservations…) arrivent aux phases suivantes : ils sont **signalés « Bientôt »,
> jamais simulés**.

Pile : React 19 · react-router 7 (routes chargées à la demande) · TanStack Query 5 · Tailwind 4 · Radix · Vite 8.
Le design system (verre, clair/sombre) est décrit dans [design-system.md](design-system.md) ; l'API dans [api.md](api.md).

## 1. Carte des écrans

| Zone | Routes |
|---|---|
| Public | `/connexion` · `/inscription` · `/conditions` · `/design` (banc d'essai du design system) |
| Établissement (session requise) | `/overview` · `/settings/hotel` · `/settings/subscription` · `/settings/invoices` · `/settings/support` · `/settings/account` · `/rooms` (+ `categories`, `rates`) · `/guests` · `/guests/:id` · `/reservations` · `/reservations/new` · `/reservations/:id` · modules à venir (`/calendar`, `/reception`, `/housekeeping`, `/restaurant`, `/billing`, `/finances`, `/staff`, `/reports`) |
| Console (session super-admin requise) | `/platform/connexion` · `/platform/dashboard` · `hotels` · `hotels/:id` · `subscriptions` · `payments` · `invoices` · `plans` · `licenses` · `support` · `settings` · `audit` |

* L'URL est la source de vérité : filtres, pages et panneaux ouverts (`?open=`, `?ticket=`, `?status=`) sont dans l'adresse
  → lien direct, bouton « précédent », rechargement sans perte.
* Mobile : barre d'onglets fixe (3 entrées + « Plus ») ; bureau : barre latérale repliable (état mémorisé).
* Palette de commandes `Ctrl/⌘ + K` ou `/` : navigation, réglages, thème, déconnexion.

## 2. Principes (vérifiés par le parcours de bout en bout)

1. **Honnêteté.** Un module non développé affiche *« bientôt disponible »* et ce qu'il fera ; le tableau de bord n'affiche
   **aucun** indicateur d'exploitation (occupation, revenus…) tant que les modules qui les produisent n'existent pas.
   Aucune donnée d'exemple, nulle part.
2. **Aucun paiement simulé.** L'hôtel *déclare* un paiement (« en attente de validation ») ; seule la plateforme le valide.
   La carte bancaire est visiblement non connectée. La facture reste « à régler » et la formule inchangée tant que la
   validation n'a pas eu lieu.
3. **Le serveur fait foi.** L'interface masque ce que le serveur refuserait (`useCan`), mais ne décide de rien :
   chaque règle (droits, quotas, états d'abonnement) est appliquée côté API et testée là-bas.
4. **Aucun secret côté navigateur.** Le jeton de session est dans un cookie `HttpOnly` (invisible du JavaScript, absent du
   stockage local) ; l'application ne lit que le cookie CSRF. Une clé de licence n'est affichée qu'une fois.
5. **Chaque action sensible demande un motif** (suspension, résiliation, rejet…) et dit ce qu'elle va faire ; le focus d'une
   confirmation destructive est sur le choix sûr.
6. **Toute erreur est dite en français, au bon endroit** : sous le champ concerné, ou en haut du formulaire. Une coupure
   réseau est annoncée comme telle (« Impossible de joindre le serveur »), avec un bouton pour réessayer.

## 3. Couche de données

* **Client HTTP** (`src/api/client.ts`) : cookies joints, en-tête `X-CSRF-Token` sur toute requête qui modifie l'état (cookie
  hôtel *ou* plateforme selon le périmètre), clé d'idempotence pour les paiements, erreurs normalisées (`ApiError`).
  Un `401 unauthenticated` en cours d'usage vide tout le cache et ramène à la connexion ; un 401 de connexion
  (mauvais mot de passe) n'est pas confondu avec une session expirée.
* **Indice de session** : sans cookie CSRF, l'application ne sonde pas le serveur (pas de 401 certain, pas d'erreur console).
* **TanStack Query** : une clé par ressource (`keys`, `pk`), `staleTime` 30 s, pas de nouvelle tentative sur une erreur
  « définitive » (4xx). Chaque mutation invalide précisément ce qu'elle a pu changer.
* **Formulaires** : validation avant envoi (e-mail, mot de passe — la **même règle** que le serveur, définie dans
  `@hmp/shared`), puis les erreurs du serveur sont rattachées à leur champ (`feedbackFrom`). Les montants se saisissent
  en unité usuelle et se convertissent en entiers de la plus petite unité (`parseMoneyInput`), jamais en flottants.

## 4. États d'accès affichés

Calculés par `@hmp/shared` (le même code que l'API) : bandeau d'**essai bientôt terminé** (≤ 5 jours), de **tolérance**
(échéance dépassée, accès complet jusqu'à une date dite), de **lecture seule** (avec la raison et l'action : choisir une
formule) ; écran dédié de **compte suspendu / fermé**, qui garde l'assistance joignable.

## 5. Performance

Chargement initial d'une page d'accès : ≈ 180 Ko de JavaScript compressé (React 66 · Radix 43 · routeur + requêtes 39 ·
application 13 · composants communs ≈ 20). **Chaque écran est un fragment chargé à la demande** (2 à 14 Ko compressés). La
bibliothèque de graphiques (Recharts, ≈ 127 Ko) n'est chargée que par `/design` — et par les futurs rapports — jamais par
les écrans actuels (le tableau de bord utilise des composants légers sans dépendance : anneau, jauge, barres).

## 6. Vérification

| Commande | Ce qu'elle prouve |
|---|---|
| `pnpm test` (web : 24 tests) | client HTTP (CSRF, erreurs, 401, réseau, idempotence), formats de dates et de montants, saisie des montants, retours de formulaire |
| `pnpm check:e2e` | **parcours réels** dans Chromium contre l'API et une base PostgreSQL jetables (rôles à moindre privilège) : inscription → configuration → choix de formule → facture → déclaration de paiement → validation par la plateforme → formule active ; assistance (la **note interne reste invisible** de l'hôtel) ; suspension / réactivation ; licence (clé montrée une fois) ; **isolation entre deux établissements** ; déconnexion ; changement de mot de passe |
| (inclus dans `check:e2e`) | **174 écrans et états** (pages, panneaux, fenêtres, palette) × 2 thèmes × 3 tailles (375 / 768 / 1440 px) : aucune violation **axe-core WCAG 2.1 A/AA**, aucun défilement horizontal, aucune erreur console |
| `pnpm check:ui` | le design system sur `/design` (contrastes mesurés, rendu, accessibilité, comportements) |

Les captures du dernier passage sont dans `apps/web/.shots/e2e` (non versionnées).

### Défauts trouvés par cette vérification (et corrigés)

* La barre d'onglets mobile n'était **pas réellement fixée** : la règle `.surface { position: relative }` (hors couche CSS)
  écrasait la classe `fixed` de Tailwind → décalage de 12 px et défilement horizontal. La règle est désormais dans une couche.
* Les tableaux larges défilaient sans être atteignables au clavier (axe `scrollable-region-focusable`) : la zone défilante
  est maintenant focalisable et nommée.
* Un nom accessible qui ne reprenait pas le texte visible (axe `label-content-name-mismatch`) sur les cartes de facture mobiles.
* Les panneaux d'une grille ne se rétrécissaient pas (largeur minimale automatique) : la fiche d'un établissement débordait
  de 325 px sur mobile.
* Un visiteur non connecté déclenchait une requête `/me` vouée au 401 (erreur dans la console) : remplacée par un indice de session.
* Le découpage du code embarquait la bibliothèque de graphiques dans le chargement initial (React dans le mauvais fragment) :
  regroupement corrigé, les graphiques sont de nouveau à la demande.

## 7. Textes légaux

Les **conditions d'utilisation** (`/conditions`) et la **politique de confidentialité** (`/confidentialite`) sont rédigées d'après le
fonctionnement réel du service (essai sans carte, paiement vérifié manuellement, lecture seule après échéance, isolation par
établissement, cookies strictement nécessaires, aucune donnée vendue). Elles ne contiennent aucune coordonnée écrite en dur : l'éditeur
renseigne le réglage **Société** de la console (nom, forme juridique, adresse, NIF/STAT, e-mail, téléphone) et ces informations
apparaissent dans les textes (`GET /api/v1/legal`).

Décisions prises (à modifier dans `apps/web/src/pages/legal/` si besoin) : conservation des données 90 jours après la fin du contrat puis
suppression ; journaux 12 mois maximum ; préavis de 30 jours pour toute modification importante ; responsabilité plafonnée aux 12 derniers
mois payés ; droit malgache et tribunaux d'Antananarivo ; référence à la loi n° 2014-038 sur la protection des données personnelles.
L'inscription enregistre la **version** (`LEGAL_VERSION` dans `@hmp/shared`) et la date d'acceptation de chaque utilisateur : à chaque
changement des textes, mettre à jour cette constante.

## 7bis. Réservations (interface)

* **`/reservations`** : liste filtrable (recherche par référence, nom, e-mail ou numéro de chambre ; état ; tri récentes / arrivée), pagination, solde et acompte attendu visibles.
* **`/reservations/new`** : on **cherche d'abord** (dates, personnes) ; chaque catégorie affiche ses chambres libres et le **prix exact du séjour** (le même calcul que le serveur : tarif propre à la chambre, saison, week-end), puis on ajoute une ou plusieurs chambres (attribution automatique ou choix de la chambre), le client (recherche ou création sans quitter la page), l'état (confirmée / en attente / **option** avec échéance), l'acompte et la remise. Une chambre déjà réservée sur ces nuits n'est **pas proposée**. L'envoi est protégé contre le double-clic (`Idempotency-Key` stable tant que le contenu ne change pas).
* **`/reservations/:id`** : chambres avec **prix nuit par nuit**, montants (taxes détaillées), historique complet, et seulement les actions que l'état de la réservation et vos droits permettent (confirmer, modifier, ajouter / modifier / annuler une chambre, non présenté, annuler avec motif). Si quelqu'un d'autre a modifié la réservation entre-temps, l'écran le dit et se rafraîchit.
* Le total affiché pendant la création est le **prix des nuits** ; les taxes éventuelles sont ajoutées par le serveur à l'enregistrement (le texte l'indique) — l'interface ne devine pas une taxe qu'elle ne connaît pas.

## 8. Limites connues (ce qui n'est PAS fait)

* **Pas d'internationalisation** : les textes sont en français dans les composants. L'anglais et le malgache viendront avec un
  catalogue de messages (le réglage de langue affiche « français uniquement »).
* **Modules à venir** : calendrier, réception, housekeeping, restaurant, facturation des clients, finances, personnel,
  rapports (suite de la Phase 6). Le tableau de bord d'exploitation
  (occupation, ADR, RevPAR…) viendra avec eux.
* **Pas de réinitialisation de mot de passe** ni d'invitation par e-mail (pas de fournisseur d'e-mail) ; l'écran de connexion le dit.
* **Un utilisateur membre de plusieurs établissements** ne dispose pas encore d'un sélecteur d'établissement (l'API le permet).
* **Pas de double authentification (TOTP)** pour les super-administrateurs.
* **Hors ligne** : l'indicateur reflète l'état réel du navigateur ; il n'existe ni file de synchronisation ni mode hors ligne.
* **Lecteur d'écran réel (VoiceOver, NVDA) non testé** : l'audit axe-core automatisé ne détecte qu'une partie des défauts.
  axe ne sait pas non plus mesurer le contraste sur fond translucide : c'est `check:contrast` (jetons, pire cas sous les halos)
  qui couvre ce point.
* **Tableaux de la fiche d'établissement** : sur mobile ils défilent horizontalement (zone focalisable) au lieu de se
  transformer en cartes, contrairement aux listes principales.
