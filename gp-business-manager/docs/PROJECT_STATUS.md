# PROJECT STATUS — GP Business Manager

_Dernière mise à jour : 2026-11-15 · Version 0.2.0 · **Périmètre livré : application Windows (hors ligne)**._

## Résumé
| Cible | État |
|---|---|
| **Application Windows installable** | ✅ Construite et empaquetée (`GP-Business-Manager-Setup-0.1.0.exe`, NSIS x64, ≈ 123 Mo). **Fonctionnelle sous Electron (Linux/Xvfb) avec la configuration de production ; installateur NON installé/testé sur un Windows réel.** |
| Backend NestJS + PostgreSQL + multi-tenant | ⬜ Non commencé (architecture documentée, ARCHITECTURE.md) |
| Synchronisation bidirectionnelle | 🟡 Préparée (outbox, UUID, tombstones, idempotence des ventes) — **aucun moteur de synchronisation** |
| Application Web | ⬜ Non commencée (à la demande de l'utilisateur : « Windows d'abord ») |
| Application mobile Android/iOS | ⬜ Non commencée |

## Fonctionnalités terminées (Windows)
Toutes ces fonctionnalités sont **reliées à une vraie base SQLite** et à de la vraie logique métier ; aucune donnée simulée n'est injectée.

- **Fondations** : Electron 45 + React 19 + TypeScript + Tailwind 4 ; SQLite embarqué (`node:sqlite`), migrations, transactions ; IPC sécurisé ; sauvegarde/restauration ; impression ticket/facture ; exports.
- **Authentification & droits** : comptes locaux (scrypt), verrouillage après 5 échecs, sessions, 5 rôles système + rôles personnalisés, 32 permissions vérifiées côté processus principal, journal d'audit immuable.
- **Tableau de bord** : CA HT net des retours, marge, ventes jour/mois, dépenses, résultat, trésorerie, soldes comptes/caisses, valeur du stock, dettes clients/fournisseurs, impayés, top produits, répartition des encaissements, alertes stock/péremption, graphique ; filtres période/caisse/utilisateur selon droits ; données financières masquées sans permission.
- **POS** : recherche instantanée, code-barres (scan + Entrée), panier, quantités décimales selon l'unité, remises ligne/ticket (plafond caissier), prix de gros/promotions, clients, paiements multiples/partiels, crédit (plafond), avances, rendu de monnaie, paniers en attente, ticket 80 mm, facture A4/PDF, retours/remboursements (espèces/mobile/avoir), historique, ouverture/clôture de caisse avec contrôle d'écart, raccourcis clavier. Ventes **atomiques et idempotentes**.
- **Produits** : catégories/sous-catégories, marques, unités, taxes, variantes (taille/couleur), SKU auto, multi-codes-barres, images, prix achat/détail/gros/promo datée, marges, historique des prix.
- **Stocks** : multi-entrepôts, entrées/sorties/pertes/casse/ajustements, transferts, inventaires (écarts régularisés), lots + péremption (FEFO), coût moyen pondéré, valorisation, seuils et ruptures, historique des mouvements.
- **Achats/fournisseurs** : fiches, bons de commande, réceptions partielles, frais d'approche répartis, dettes, échéances, paiements partiels, retours fournisseur (service + API ; pas d'écran dédié).
- **Clients** : fiches, historique, compte client, plafond, avances, règlement FIFO.
- **Finances** : comptes (espèces/banque/mobile), dépenses catégorisées, apports/prélèvements, virements internes, flux de trésorerie séparant CA / encaissements / apports / remboursements / dépenses / virements ; écart de caisse répercuté.
- **Rapports** : 12 rapports ; export **PDF, Excel, CSV** (CSV protégé contre l'injection de formules).
- **Administration** : utilisateurs, rôles, établissements/entrepôts/caisses, journal, sauvegardes.
- **Paramètres** : entreprise/logo, devise (MGA, EUR, USD, MUR, KMF, XOF, ZAR), fuseau, taxes, modes de paiement (MVola, Orange Money, Airtel Money…), numérotation, tickets/factures.
- **UI** : design sombre/clair (bleu nuit + or), FR/EN complets (587 libellés), responsive (≥ 1024 px optimisé ; menu rétractable).

## En cours
Rien en cours.

## Restant (Windows)
Voir ROADMAP.md (backlog). Principaux manques assumés :
- **Fidélisation clients** (points/paliers) : listée dans la spécification, **non implémentée** (le champ `loyalty_points` existe mais n'est ni alimenté ni utilisé).
- **Listes de prix multiples** (`PriceList`) : seuls détail/gros/promo existent.
- **Retours fournisseur** : pas d'écran (endpoint `purchases.returnToSupplier` testé en service seulement).
- Mise à jour automatique : **faite (0.2.0)** ; reste à valider sur un poste Windows avec une vraie release.
- Tiroir-caisse ESC/POS, étiquettes code-barres, import CSV produits/clients, relances clients, notifications (entité `Notification`), multi-devises simultanées, chiffrement de la base, signature de code.
- Messages d'erreur métier renvoyés par le cœur : **en français uniquement** (même quand l'interface est en anglais).
- Malgache : infrastructure prête (`mg.ts`, sélecteur), **dictionnaire quasi vide**.
- Rôle de **gestionnaire de plusieurs entreprises** dans une même installation : non prévu (une installation = une entreprise ; plusieurs entreprises = plusieurs profils/bases à terme).
- Réception/ouverture de **session de caisse par un autre utilisateur** : une session appartient à son caissier (un responsable peut clôturer).

## Bugs connus / limites
- Le **fond de caisse** n'est pas une écriture financière (c'est une base de comptage du tiroir) ; l'argent qui entre dans l'entreprise doit être saisi comme *Apport*. Un compte espèces peut donc afficher un solde inférieur au contenu physique du tiroir tant que le fond n'a pas été saisi en apport.
- Une dépense payée en espèces est refusée si le **solde du compte** (hors fond de caisse) est insuffisant — comportement voulu, mais peut surprendre en début d'exploitation (saisir un apport/solde d'ouverture).
- Les **vérifications hors ligne** (plafond de crédit, stock) seront limitées par l'absence des données des autres appareils une fois la synchronisation en place (voir ARCHITECTURE.md §5.3).
- Base SQLite **non chiffrée** (voir SECURITY.md).
- `node:sqlite` est encore marqué « expérimental » par Node ; l'avertissement n'apparaît que dans les tests Node.
- `npm audit` : 1 vulnérabilité modérée dans `minimatch` (dépendance **de build** d'electron-builder, non livrée).

## Tests
| Suite | Résultat |
|---|---|
| `@gp/shared` (Vitest) — argent, panier, règlement, retours, numérotation, permissions, i18n | ✅ **21 / 21** |
| Récupération de mot de passe (ligne de commande) — test e2e réel | ✅ |
| Mises à jour automatiques — détection/annonce testées avec un faux serveur de versions (2 e2e) | ✅ ; **téléchargement + installation réels : non testés** (nécessitent Windows + une release publiée) |
| `@gp/desktop` intégration (Vitest, SQLite réelle) — sécurité, ventes, retours, immuabilité, catalogue, stock/FEFO/inventaire, achats, caisse, finances/dashboard, exports | ✅ **30 / 30** |
| Typecheck TypeScript (strict) | ✅ 0 erreur |
| Audit de mise en page (écrans + fenêtres, 2 tailles d'écran) | ✅ 0 anomalie |
| E2E Playwright sur Electron (config **production**, CSP stricte) — 3 scénarios : (1) configuration → produit → scan → encaissement espèces → dashboard → historique → stock ; (2) tous les écrans + sous-onglets, thème sombre, anglais ; (3) vente à crédit partielle → retour → solde client → clôture avec écart → dépense | ✅ **3 / 3** (31 s) |
| Génération de l'installateur NSIS | ✅ `GP-Business-Manager-Setup-0.1.0.exe` (122 Mo) — SHA-256 `2447d5b825bc8a2a9524e71d2a094a9eb88096f649b12f6b59d534b34e614397` ; contenu vérifié **identique** (empreintes) au build testé en e2e |

Résultat e2e le plus récent : **3 / 3**, aucune erreur console ni violation de CSP.

### Tests échoués
Aucun à la date de mise à jour. Défauts trouvés par les tests e2e puis **corrigés** pendant le développement : (1) formulaire de dépense présélectionnant un compte à solde nul ; (2) écart de clôture de caisse non répercuté sur le solde du compte ; (3) **perte possible d'un scan de code-barres** lors de deux scans rapprochés ; (4) sélecteur de langue affichant la mauvaise langue ; (5) **fenêtres modales (ex. « Nouveau produit ») rognées par le haut sur écran moyen** — signalé par l'utilisateur, corrigé à la racine (affichage par portal).

### Non testé
- Installation et exécution sur **Windows réel** (SmartScreen, désinstallation, mise en veille, impression thermique, lecteur code-barres physique).
- Charge (≥ 100 k produits / ≥ 1 M lignes), accessibilité automatisée, tests visuels de régression.
- Sauvegarde/restauration via les boîtes de dialogue natives (logique `VACUUM INTO`/intégrité non couverte par e2e).
- Impression (ticket/PDF) via les dialogues natifs.

## Prochaine étape recommandée
1. **Installer le `.exe` sur un poste Windows** et dérouler la checklist (installation, premier lancement, une vente imprimée, clôture, sauvegarde, désinstallation) — je peux produire cette checklist.
2. Retour utilisateur sur l'ergonomie du POS.
3. Puis, au choix : fidélisation / import CSV / tiroir-caisse (finitions Windows) **ou** démarrage du backend NestJS + PostgreSQL + synchronisation (Phase 7), puis web et mobile.
