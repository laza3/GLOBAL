# Lancer Hotel Manager Pro sur votre ordinateur Windows

Objectif : ouvrir le logiciel dans Google Chrome et le tester **sur votre PC**, avec une base de données de test qui n'existe que chez vous (rien n'est envoyé sur Internet). Comptez 20 à 30 minutes la première fois ; ensuite une seule commande suffit.

## Ce que contient le projet (en bref)

| Question | Réponse |
|---|---|
| Technologie | TypeScript partout. Interface : React 19 + Vite + Tailwind. Serveur (API) : Node.js 22 + Fastify. Base de données : PostgreSQL 16. |
| Dossier de l'application | `hotel-manager-pro/` (dans le dépôt `GLOBAL`, dont le reste est une vidéo sans rapport). `apps/web` = interface, `apps/api` = serveur, `packages/db` = tables de la base, `packages/shared` = code commun. |
| Gestionnaire de paquets | **pnpm** 10 (un seul `pnpm install` installe tout). |
| À installer sur le PC | Node.js 22, pnpm, PostgreSQL 16, Git, Google Chrome. Les bibliothèques du projet sont installées automatiquement par pnpm. |
| Base de données | PostgreSQL local. La commande `pnpm local:setup` crée la base `hmp_dev`, les tables, les comptes techniques et les forfaits d'exemple. |
| Variables d'environnement | Aucune à écrire à la main : `pnpm local:setup` génère le fichier `.env` (adresses de la base, mots de passe techniques, secret de sécurité). Il reste sur votre PC et n'est jamais publié. |

## Étape 1 — Installer les programmes

1. **Node.js 22** : https://nodejs.org → « Previous releases » (ou « Download Node.js » → choisir la version **22.x**) → installateur Windows `.msi`, options par défaut.
2. **Git** : https://git-scm.com/download/win → options par défaut.
3. **PostgreSQL 16** : https://www.postgresql.org/download/windows/ → « Download the installer » (EDB) → version **16**.
   - Gardez les composants proposés (PostgreSQL Server, Command Line Tools).
   - On vous demande un **mot de passe pour l'utilisateur `postgres`** : choisissez-en un et **notez-le**, il vous sera demandé à l'étape 5.
   - Port : laissez **5432**. À la fin, décochez « Stack Builder ».
4. **Google Chrome** (si ce n'est pas déjà fait).

## Étape 2 — Ouvrir l'Invite de commandes

Touche Windows, tapez `cmd`, Entrée. Utilisez **l'Invite de commandes** (pas PowerShell, qui bloque souvent les programmes Node par défaut).

Vérifiez les installations :

```bash
node -v
git --version
```

`node -v` doit afficher `v22.…`.

## Étape 3 — Installer pnpm

```bash
npm install -g pnpm@10.28.0
pnpm -v
```

## Étape 4 — Récupérer le projet et installer ses bibliothèques

```bash
cd /d %USERPROFILE%\Documents
git clone --depth 1 --branch claude/magical-hawking-t5z3k2 https://github.com/laza3/GLOBAL.git
cd GLOBAL\hotel-manager-pro
pnpm install
```

- Si le dépôt est privé, une fenêtre de connexion GitHub s'ouvre : connectez-vous.
- `pnpm install` dure 3 à 10 minutes. Des avertissements jaunes sont normaux ; une ligne rouge « ERR » ne l'est pas (envoyez-la moi).

## Étape 5 — Préparer la base de données (une seule fois)

```bash
pnpm local:setup
```

La commande vous demande :
1. le **mot de passe de `postgres`** (celui noté à l'étape 1). Une étoile `*` s'affiche à chaque touche tapée ; la commande laisse 3 essais ;
2. votre **e-mail, votre nom et un mot de passe** pour le compte *super-administrateur* (console de gestion de la plateforme). Vous pouvez appuyer sur Entrée pour passer et le créer plus tard.

Elle affiche des lignes `✔` puis « Terminé ». Elle peut être relancée sans risque : elle ne supprime rien.

## Étape 6 — Démarrer le logiciel

```bash
pnpm local:start
```

Attendez environ une minute : Chrome s'ouvre sur **http://127.0.0.1:5173**. Gardez la fenêtre noire ouverte tant que vous utilisez le logiciel.

## Étape 7 — Tester

- **Le plus simple : un hôtel de démonstration déjà rempli** (12 chambres, 6 clients fictifs, 6 réservations). Laissez la fenêtre de l'étape 6 ouverte, ouvrez une **deuxième** Invite de commandes et tapez :

```bash
cd /d %USERPROFILE%\Documents\GLOBAL\hotel-manager-pro
pnpm api:seed-demo
```

  La commande affiche un e-mail et un mot de passe (**notez-les**, ils ne sont affichés qu'une fois). Connectez-vous avec sur la **page d'accueil** `http://127.0.0.1:5173/connexion`. Cette commande refuse de s'exécuter sur une instance de production : les données fictives ne peuvent pas se mélanger aux vraies.

- **Hôtel de test** : sur la page d'accueil, « Créer un compte » (ou http://127.0.0.1:5173/inscription). Un établissement avec une période d'essai est créé ; vous arrivez dans la vue d'ensemble (chambres, réservations, calendrier, facturation, restaurant, rapports…).
- **Console super-administrateur** : http://127.0.0.1:5173/platform/connexion (**une autre page que l'accueil**) avec l'e-mail et le mot de passe de l'étape 5. Aucun établissement n'est nécessaire pour s'y connecter. Cette console gère les abonnements, paiements, licences et l'assistance ; elle ne montre volontairement pas l'intérieur d'un hôtel.
- Les paiements sont **validés manuellement** (aucun paiement automatique n'est simulé). Le « mot de passe oublié » par e-mail est indisponible tant qu'aucun serveur e-mail n'est configuré : c'est normal.

## Arrêter et relancer

- **Arrêter** : dans la fenêtre noire, `Ctrl + C` (si Windows demande « Terminer le programme de commandes (O/N) ? », tapez `O` puis Entrée).
- **Relancer un autre jour** (PostgreSQL démarre tout seul avec Windows) :

```bash
cd /d %USERPROFILE%\Documents\GLOBAL\hotel-manager-pro
pnpm local:start
```

- **Récupérer une nouvelle version du logiciel** :

```bash
cd /d %USERPROFILE%\Documents\GLOBAL\hotel-manager-pro
git pull
pnpm install
pnpm local:start
```

> **Installer le logiciel chez un client (hôtel sans Internet, plusieurs appareils, sauvegardes) ?** Ce guide-ci sert à votre propre ordinateur. Pour un client : [version-locale.md](version-locale.md).

## Dépannage

| Message ou problème | Solution |
|---|---|
| `'pnpm' n'est pas reconnu` | Fermez et rouvrez l'Invite de commandes, puis refaites l'étape 3. |
| PowerShell : « l'exécution de scripts est désactivée » | Utilisez l'Invite de commandes (étape 2). |
| `Mot de passe refusé pour « postgres »` | Relancez `pnpm local:setup` et saisissez le mot de passe choisi à l'installation de PostgreSQL. |
| Rien ne s'affiche quand je tape le mot de passe | Avec une ancienne version, la saisie était invisible : faites `git pull`. Ou, sans saisie : `set "HMP_PG_ADMIN_PASSWORD=votre_mot_de_passe"` puis `pnpm local:setup` (gardez les guillemets). |
| `PostgreSQL ne répond pas sur 127.0.0.1:5432` | Windows → « Services » → `postgresql-x64-16` → Démarrer. |
| `port … occupé` / l'API ne démarre pas | Un autre programme utilise le port 3000 ou 5173 : fermez-le (ou redémarrez le PC), puis `pnpm local:start`. |
| Chrome ne s'ouvre pas | Ouvrez Chrome et tapez `127.0.0.1:5173` dans la barre d'adresse. |
| Mauvais compte sur la page d'accueil | L'accueil `/connexion` est pour les comptes d'hôtel ; le super-administrateur se connecte sur `/platform/connexion`. |
| Repartir d'une base vide | Fermez le logiciel, supprimez le fichier `.env`, puis dans l'Invite de commandes : `"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "DROP DATABASE hmp_dev"` et recommencez l'étape 5. |

> Ces scripts ont été testés sous Linux (préparation, démarrage, inscription d'un hôtel et connexion à la console dans un vrai navigateur, arrêt propre). Ils n'ont pas pu être exécutés sous Windows dans l'environnement de développement : si un message d'erreur apparaît, copiez-le tel quel.
