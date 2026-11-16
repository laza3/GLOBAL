# CHANGELOG

## 0.4.0 — (en préparation) Version web / téléphone — étape 1 (en ligne)
- **Serveur web** `apps/server` (`@gp/server`) : même cœur métier que l'application Windows, accessible par navigateur (ordinateur et téléphone). API `POST /api/call` et `/api/system`, site statique, sauvegarde quotidienne, arrêt propre.
- **Cœur métier extrait** dans `packages/core` (`@gp/core`) : utilisé à l'identique par Windows et par le serveur (aucun changement de comportement ; 44 tests desktop inchangés).
- **Interface adaptée au téléphone** : les tableaux deviennent des fiches empilées, pastille « En ligne / Hors ligne », champ « Code d'installation » à la première configuration, site **installable** (PWA : manifeste, icônes, service worker qui ne met jamais les données en cache).
- **Sécurité web** : session dans un cookie `HttpOnly` + `SameSite=Strict` (jamais lisible par la page), en-tête anti-CSRF obligatoire, CSP stricte, limite de tentatives de connexion par adresse (en plus du verrouillage par compte), corps de requête limité, code d'installation pour créer la première entreprise, pas de restauration ni de dossier de données exposés.
- **Déploiement** : `Dockerfile`, `deploy/docker-compose.yml` + Caddy (HTTPS automatique), workflow `gp-web.yml`.
- **Corrigé (Windows et web)** : après le changement du mot de passe temporaire, les écrans déjà ouverts (ex. caisse) restaient en erreur jusqu'à un rechargement → toutes les données sont rechargées.
- **Limite assumée de cette étape** : le site web **exige Internet** ; l'application Windows reste autonome avec **ses propres données** (non partagées avec le serveur). Le partage hors ligne entre appareils est l'étape 2 (synchronisation).

## 0.3.1 — 2026-11-16
Identique à 0.3.0 (la release 0.3.0 a été publiée incomplète par erreur d'outil de publication ; la publication est désormais en un seul envoi).

## 0.3.0 — 2026-11-16
- **Réinitialiser les données** (Administration → Réinitialisation, administrateur uniquement, mot de passe + phrase de confirmation) : efface le contenu de gestion (produits, stocks, clients, fournisseurs, ventes, achats, caisses, dépenses, trésorerie, numérotation) ; **conserve** comptes/rôles, paramètres, boutiques/entrepôts/caisses, modes de paiement, taxes, journal. Copie de sécurité automatique avant l'effacement (sauf si l'administrateur supprime aussi les sauvegardes). Une seule transaction ; triggers d'immuabilité rétablis.
- **Suppression de comptes** par l'administrateur : suppression définitive si le compte n'a aucune activité, **archivage** sinon (historique conservé, connexion impossible, identifiant réutilisable). Impossible de se supprimer soi-même ou de supprimer le dernier administrateur. Migration `003`.
- Nouveau profil **Responsable des ventes** ; « Caissier » devient **Vendeur / Vendeuse** (bases existantes mises à jour automatiquement, droits personnalisés conservés).
- **Limitation à une boutique** : un compte rattaché à une boutique (sans la permission `branch.all`) ne voit et n'agit que sur sa boutique (caisses, entrepôts, stock, ventes).
- **Mot de passe temporaire** : un compte créé par l'administrateur doit changer son mot de passe à la première connexion (blocage côté serveur tant que ce n'est pas fait).
- Écran « Créer un compte » : description du profil, choix de la boutique ; nouvelle migration `002`.

## 0.2.0 — 2026-11-16
### Ajouté
- **Mises à jour automatiques** (GitHub Releases) : pastille « Version X disponible », carte dans *Administration → Sauvegardes*, sauvegarde automatique avant installation, réservé aux utilisateurs `settings.manage`.
- **Mot de passe oublié** : `--reset-password=… [--user=…]` + aide sur l'écran de connexion.
- Workflows GitHub Actions : build Windows + tests sous Windows ; publication d'une version en brouillon.
### Corrigé
- Fenêtres modales rognées/décentrées (affichage par portal) ; scans de codes-barres rapprochés ; formulaire de dépense ; écart de caisse répercuté sur le compte ; sélecteur de langue.

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
